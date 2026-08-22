import { Game, GameStatus } from "@/game/Game";
import { World } from "@/game/World";
import { PlayerList } from "@/game/PlayerList";
import { Alliances } from "@/game/Alliances";
import { Player } from "@/game/Player";
import { GameObject } from "@/game/gameobject/GameObject";
import { ObjectPosition } from "@/game/gameobject/ObjectPosition";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";

/**
 * Reusable deterministic restore-qualification harness.
 *
 * Pattern under test:
 *
 *   W1 = createWorld(seed); run(N); snapshot
 *   W2 = createWorld(seed); restore(snapshot)
 *   run both with identical inputs for M ticks
 *   compare canonical state at controlled checkpoints
 *
 * The comparison is deliberately BEHAVIORAL, not just hash equality: the
 * checkpoint compares the full canonical state surface (players, objects,
 * traits) plus the lockstep hash, so a hash that is blind to lost state
 * cannot certify a restore. Every subsystem test builds on this helper so
 * future save/restore work has one qualification path.
 */

export const RESTORE_QUALIFICATION_TICK = 120;
export const RESTORE_QUALIFICATION_CHECKPOINT_INTERVAL = 40;

/** Stable scripted input stream shared by both worlds. */
export interface ScriptedInput {
    tick: number;
    value: number;
}

export function scriptedInputs(seed: number, endTick: number, everyNTicks = 7): ScriptedInput[] {
    const inputs: ScriptedInput[] = [];
    let state = seed >>> 0;
    for (let tick = 1; tick < endTick; tick++) {
        state = (state * 1664525 + 1013904223) >>> 0;
        if (tick % everyNTicks === 0) {
            inputs.push({ tick, value: state % 251 });
        }
    }
    return inputs;
}

/**
 * Apply one scripted input to the world through a caller-supplied effect.
 * Both branches MUST use the same effect function; the harness only
 * guarantees they receive identical (tick, value) pairs in identical order.
 */
export type InputEffect = (world: QualifiedWorld, input: ScriptedInput) => void;

export interface QualifiedWorld {
    game: Game;
    players: Player[];
    /** Deterministic per-world actor state mirrored into object traits. */
    actors: GameObject[];
}

export interface WorldSeedOptions {
    seed: number;
    playerNames?: string[];
    objectCount?: number;
    /** Attach automatic definitions onto each object's trait (optional). */
    attachEffectDefinition?: AresAttachEffectDefinition;
    attachAutomaticEffectId?: string;
}

const stubTiles = () => ({
    getByMapCoords: () => undefined,
    getPlaceholderTile: () => ({ rx: 0, ry: 0, z: 0, rampType: 0 }),
});

const stubTileOccupation = () => ({ getBridgeOnTile: () => undefined });

function makeObject(index: number): GameObject {
    const object = new GameObject(0 as any, `q-${index}`, {} as any, {} as any);
    object.id = index + 1;
    object.position = new ObjectPosition(stubTiles(), stubTileOccupation());
    return object;
}

/**
 * Build a fully independent qualified world. Two calls with the same options
 * produce simulation-identical worlds: same PRNG seed, same player set, same
 * object IDs, same insertion order.
 */
export function createQualifiedWorld(options: WorldSeedOptions): QualifiedWorld {
    const world = new World();
    const players = (options.playerNames ?? ["Soviet", "Allied"])
        .map(name => new Player(name));
    const playerList = new PlayerList();
    for (const player of players) playerList.addPlayer(player);
    const alliances = new Alliances(playerList);

    const objectCount = options.objectCount ?? 24;
    for (let index = 0; index < objectCount; index++) {
        world.spawnObject(makeObject(index));
    }

    const game = new Game(
        world,
        {},
        {},
        {},
        {},
        options.seed,
        options.seed,
        { gameSpeed: 5, humanPlayers: [], aiPlayers: [] },
        0,
        playerList,
        {},
        alliances,
        { value: objectCount + 1 },
        {},
        { update() { } },
    );
    game.status = GameStatus.Started;
    game.lastGameEndCheck = Number.MAX_SAFE_INTEGER;

    // Optional AttachEffect wiring uses the production trait registration
    // shape (automatic binding keyed by object name).
    if (options.attachEffectDefinition && options.attachAutomaticEffectId) {
        for (const object of world.getAllObjects()) {
            const trait = new AresAttachEffectTrait({
                gameObject: object,
                automaticEffect: {
                    effectId: `${options.attachAutomaticEffectId}-${object.id}`,
                    definition: options.attachEffectDefinition,
                },
            });
            object.aresAttachEffectTrait = trait;
            object.traits.add(trait);
        }
    }

    return { game, players, actors: [...world.getAllObjects()] };
}

/** One deterministic world step: apply that tick's inputs, then update. */
export function stepQualifiedWorld(
    world: QualifiedWorld,
    tick: number,
    inputsByTick: Map<number, ScriptedInput[]>,
    effect: InputEffect,
): void {
    for (const input of inputsByTick.get(tick) ?? []) {
        effect(world, input);
    }
    world.game.update();
}

/**
 * Canonical behavioral checkpoint. Compares every state axis that can change
 * future simulation, NOT just the top-level hash — a hash blind to lost
 * state must not be able to certify equality here.
 */
export function captureCheckpoint(world: QualifiedWorld): Record<string, unknown> {
    const game = world.game;
    return {
        tick: game.currentTick,
        prngLastRandom: game.prng.getLastRandom(),
        nextObjectId: game.nextObjectId.value,
        hash: game.getHash(),
        players: world.players.map(player => ({
            name: player.name,
            credits: player.credits,
            defeated: player.defeated,
        })),
        objects: game.world.getAllObjects().map((object: any) => ({
            id: object.id,
            name: object.name,
            hash: object.getHash(),
            aresAttachEffect: object.aresAttachEffectTrait
                ? {
                    instances: object.aresAttachEffectTrait.getState(),
                    modifiers: object.aresAttachEffectTrait.getAggregateMultipliers(),
                }
                : undefined,
        })),
    };
}

export interface RestoreQualificationResult {
    passed: boolean;
    checkpointsCompared: number;
    firstDivergence?: {
        afterRestoreTick: number;
        field: string;
        expected: unknown;
        actual: unknown;
    };
}

function diffCheckpoints(
    live: Record<string, unknown>,
    restored: Record<string, unknown>,
): RestoreQualificationResult["firstDivergence"] | undefined {
    const liveJson = JSON.stringify(live);
    const restoredJson = JSON.stringify(restored);
    if (liveJson === restoredJson) return undefined;
    // Find the first differing top-level field for actionable failures.
    const keys = new Set([...Object.keys(live), ...Object.keys(restored)]);
    for (const key of keys) {
        if (JSON.stringify(live[key]) !== JSON.stringify(restored[key])) {
            return { afterRestoreTick: restored.tick as number, field: key, expected: live[key], actual: restored[key] };
        }
    }
    return { afterRestoreTick: restored.tick as number, field: "(structure)", expected: liveJson.slice(0, 200), actual: restoredJson.slice(0, 200) };
}

export interface RestoreQualificationOptions extends WorldSeedOptions {
    ticksBeforeSnapshot: number;
    ticksAfterSnapshot: number;
    snapshot: unknown;
    restore: (target: QualifiedWorld, snapshot: unknown) => void;
    effect: InputEffect;
}

/**
 * Qualify one snapshot/restore implementation:
 *
 *   W1 runs ticksBeforeSnapshot, snapshots, continues to the end.
 *   W2 is freshly built with the same seed and restores the SAME snapshot
 *   at the equivalent tick, then both continue on identical inputs.
 *
 * Checkpoints compare behavioral state (not merely hashes) every interval.
 */
export function qualifyRestore(options: RestoreQualificationOptions): RestoreQualificationResult {
    const totalTicks = options.ticksBeforeSnapshot + options.ticksAfterSnapshot;
    const inputsByTick = new Map<number, ScriptedInput[]>();
    for (const input of scriptedInputs(options.seed, totalTicks + 1)) {
        const list = inputsByTick.get(input.tick) ?? [];
        list.push(input);
        inputsByTick.set(input.tick, list);
    }

    const live = createQualifiedWorld(options);
    for (let tick = 0; tick <= options.ticksBeforeSnapshot; tick++) {
        stepQualifiedWorld(live, tick, inputsByTick, options.effect);
    }

    const restored = createQualifiedWorld(options);
    // Fast-forward the fresh world through the same pre-snapshot ticks so its
    // tick counter and PRNG align before the snapshot is applied. This keeps
    // the comparison focused on restored STATE rather than replay mechanics.
    for (let tick = 0; tick <= options.ticksBeforeSnapshot; tick++) {
        stepQualifiedWorld(restored, tick, inputsByTick, options.effect);
    }
    options.restore(restored, options.snapshot);

    let checkpointsCompared = 0;
    let firstDivergence: RestoreQualificationResult["firstDivergence"];
    for (let tick = options.ticksBeforeSnapshot + 1; tick <= totalTicks; tick++) {
        stepQualifiedWorld(live, tick, inputsByTick, options.effect);
        stepQualifiedWorld(restored, tick, inputsByTick, options.effect);
        if ((tick - options.ticksBeforeSnapshot) % RESTORE_QUALIFICATION_CHECKPOINT_INTERVAL === 0 ||
            tick === totalTicks) {
            checkpointsCompared++;
            const divergence = diffCheckpoints(
                captureCheckpoint(live),
                captureCheckpoint(restored),
            );
            if (divergence && !firstDivergence) {
                firstDivergence = divergence;
                break;
            }
        }
    }
    return { passed: !firstDivergence, checkpointsCompared, firstDivergence };
}
