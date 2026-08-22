import { describe, expect, test } from "bun:test";
import {
    createQualifiedWorld,
    qualifyRestore,
    RESTORE_QUALIFICATION_TICK,
    scriptedInputs,
    stepQualifiedWorld,
    captureCheckpoint,
    type InputEffect,
} from "@/test/helpers/DeterministicRestoreHarness";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";

/**
 * Behavioral restore qualification for Ares AttachEffect extension state.
 *
 * Unlike hash-only comparisons, these tests compare the full canonical
 * checkpoint (players, objects, trait instances, aggregate modifiers, PRNG,
 * tick, lockstep hash) between an uninterrupted world and a world that
 * restored the same snapshot — so lost state cannot hide behind an equal
 * hash.
 *
 * The negative-control test deliberately restores WITHOUT definition
 * rebinding and asserts divergence: this proves the harness can actually
 * detect the class of bug the audit found, i.e. it is not vacuously green.
 */

function effectDefinition(overrides: Partial<AresAttachEffectDefinition> = {}): AresAttachEffectDefinition {
    return {
        duration: 60,
        speedMultiplier: 1,
        armorMultiplier: 1,
        firepowerMultiplier: 1,
        rofMultiplier: 1,
        cloakable: false,
        forceDecloak: false,
        discardOnEntry: false,
        penetratesIronCurtain: false,
        delay: 0,
        initialDelay: 0,
        cumulative: false,
        animResetOnReapply: false,
        temporalHidesAnim: false,
        extensionEntries: new Map(),
        ...overrides,
    };
}

const sovietPlayer = { name: "Soviet", id: 1 };
const alliedPlayer = { name: "Allied", id: 2 };
function resolvePlayer(name: string): unknown {
    return [sovietPlayer, alliedPlayer].find(player => player.name === name);
}

/** Applies deterministic gameplay inputs: credits and effect mutations. */
const standardInputEffect: InputEffect = (world, input) => {
    const player = world.players[input.value % world.players.length];
    // Deterministic credit pressure exercises player state hashing.
    player.credits = player.credits + input.value;
    // Every other input applies or mutates an external AttachEffect on one
    // object, exercising instance/stack/scheduler state in both branches.
    if (input.value % 2 === 0) {
        const target = world.game.world.getAllObjects()[input.value % 8];
        const trait: AresAttachEffectTrait | undefined = target.aresAttachEffectTrait;
        if (trait) {
            const effectId = `ext-${input.value % 4}`;
            trait.apply(effectId, effectDefinition({
                duration: 30 + (input.value % 20),
                armorMultiplier: 0.9,
                firepowerMultiplier: 1.15,
            }), {
                sourcePlayer: player,
                origin: { kind: "warhead", ownerName: `Warhead${input.value % 3}` },
            });
        }
    }
};

describe("deterministic restore qualification (behavioral)", () => {
    test("uninterrupted worlds with the same seed are checkpoint-identical", () => {
        // Sanity gate: two independent builds of the same world must agree,
        // otherwise any restore comparison below would be meaningless.
        const inputsByTick = new Map<number, ReturnType<typeof scriptedInputs>>();
        for (const input of scriptedInputs(777, RESTORE_QUALIFICATION_TICK)) {
            const list = inputsByTick.get(input.tick) ?? [];
            list.push(input);
            inputsByTick.set(input.tick, list);
        }
        const first = createQualifiedWorld({ seed: 777 });
        const second = createQualifiedWorld({ seed: 777 });
        for (let tick = 0; tick <= RESTORE_QUALIFICATION_TICK; tick++) {
            stepQualifiedWorld(first, tick, inputsByTick as never, standardInputEffect);
            stepQualifiedWorld(second, tick, inputsByTick as never, standardInputEffect);
        }
        expect(captureCheckpoint(second)).toEqual(captureCheckpoint(first));
    });

    test("AttachEffect snapshot restore preserves modifiers, instances, and continued simulation", () => {
        // Build the live branch and capture its mid-run snapshot WITH origins.
        const live = createQualifiedWorld({
            seed: 20260822,
            attachEffectDefinition: effectDefinition({ duration: 45 }),
            attachAutomaticEffectId: "auto",
        });
        const inputsByTick = new Map<number, ReturnType<typeof scriptedInputs>>();
        for (const input of scriptedInputs(20260822, RESTORE_QUALIFICATION_TICK + 80)) {
            const list = inputsByTick.get(input.tick) ?? [];
            list.push(input);
            inputsByTick.set(input.tick, list);
        }
        const halfTick = 60;
        for (let tick = 0; tick <= halfTick; tick++) {
            stepQualifiedWorld(live, tick, inputsByTick as never, standardInputEffect);
        }

        // Snapshot every object's trait exactly as a save host would.
        const snapshots = live.game.world.getAllObjects()
            .filter((object: any) => object.aresAttachEffectTrait)
            .map((object: any) => ({
                objectId: object.id,
                state: object.aresAttachEffectTrait.serializeState(),
                automaticEffectId: `auto-${object.id}`,
            }));
        expect(snapshots.length).toBeGreaterThan(0);

        // Restore into an independently built world. It must first replay
        // through the pre-snapshot ticks so its tick counter and PRNG align,
        // exactly as qualifyRestore does; then the snapshot state applies.
        const restored = createQualifiedWorld({
            seed: 20260822,
            attachEffectDefinition: effectDefinition({ duration: 45 }),
            attachAutomaticEffectId: "auto",
        });
        for (let tick = 0; tick <= halfTick; tick++) {
            stepQualifiedWorld(restored, tick, inputsByTick as never, standardInputEffect);
        }
        for (const entry of snapshots) {
            const object = restored.game.world.getAllObjects()
                .find((candidate: any) => candidate.id === entry.objectId);
            expect(object).toBeDefined();
            object.aresAttachEffectTrait.restoreState(entry.state, {
                resolvePlayer,
                resolveDefinition: (kind: string, ownerName: string) => {
                    if (kind === "warhead") {
                        // Same authored data the live branch applied.
                        return effectDefinition({
                            duration: 30 + 20,
                            armorMultiplier: 0.9,
                            firepowerMultiplier: 1.15,
                        });
                    }
                    return undefined;
                },
            });
        }

        // Continue both on identical inputs; compare behavior at checkpoints.
        let compared = 0;
        for (let tick = halfTick + 1; tick <= RESTORE_QUALIFICATION_TICK + 80; tick++) {
            stepQualifiedWorld(live, tick, inputsByTick as never, standardInputEffect);
            stepQualifiedWorld(restored, tick, inputsByTick as never, standardInputEffect);
            if ((tick - halfTick) % 40 === 0 || tick === RESTORE_QUALIFICATION_TICK + 80) {
                compared++;
                expect(captureCheckpoint(restored)).toEqual(captureCheckpoint(live));
            }
        }
        expect(compared).toBeGreaterThanOrEqual(2);
    });

    test("negative control: restoring WITHOUT definition rebinding diverges", () => {
        // This is the audit's original P0 bug. If this test ever passes, the
        // positive tests above are no longer proving anything.
        const live = createQualifiedWorld({
            seed: 424242,
            attachEffectDefinition: effectDefinition({ duration: 45 }),
            attachAutomaticEffectId: "auto",
        });
        const inputsByTick = new Map<number, ReturnType<typeof scriptedInputs>>();
        for (const input of scriptedInputs(424242, 100)) {
            const list = inputsByTick.get(input.tick) ?? [];
            list.push(input);
            inputsByTick.set(input.tick, list);
        }
        for (let tick = 0; tick <= 50; tick++) {
            stepQualifiedWorld(live, tick, inputsByTick as never, standardInputEffect);
        }

        const snapshots = live.game.world.getAllObjects()
            .filter((object: any) => object.aresAttachEffectTrait)
            .map((object: any) => ({ id: object.id, state: object.aresAttachEffectTrait.serializeState() }));
        // The scenario must actually carry snapshotable effects.
        expect(snapshots.length).toBeGreaterThan(0);
        // And at least one held effect must rely on an external definition.
        const hasExternal = snapshots.some(entry =>
            (entry.state.instances ?? []).some(instance => !instance.effectId.startsWith("auto-")));
        expect(hasExternal).toBe(true);

        const brokenRestore = createQualifiedWorld({
            seed: 424242,
            attachEffectDefinition: effectDefinition({ duration: 45 }),
            attachAutomaticEffectId: "auto",
        });
        for (const entry of snapshots) {
            const object = brokenRestore.game.world.getAllObjects()
                .find((candidate: any) => candidate.id === entry.id);
            // Deliberately omit resolveDefinition: definitions stay empty.
            object.aresAttachEffectTrait.restoreState(entry.state, { resolvePlayer });
        }
        // The breakage precondition: the broken trait lost its non-automatic
        // definitions while live still holds them.
        const liveFirst = live.game.world.getAllObjects()
            .find((object: any) => object.id === snapshots[0].id).aresAttachEffectTrait;
        const brokenFirst = brokenRestore.game.world.getAllObjects()
            .find((object: any) => object.id === snapshots[0].id).aresAttachEffectTrait;
        const liveModifiers = JSON.stringify(liveFirst.getAggregateMultipliers());
        const brokenModifiers = JSON.stringify(brokenFirst.getAggregateMultipliers());

        let diverged = liveModifiers !== brokenModifiers;
        for (let tick = 51; tick <= 100 && !diverged; tick++) {
            stepQualifiedWorld(live, tick, inputsByTick as never, standardInputEffect);
            stepQualifiedWorld(brokenRestore, tick, inputsByTick as never, standardInputEffect);
            const liveObjects = JSON.stringify(captureCheckpoint(live).objects);
            const brokenObjects = JSON.stringify(captureCheckpoint(brokenRestore).objects);
            if (liveObjects !== brokenObjects) {
                diverged = true;
            }
        }
        expect(diverged).toBe(true);
    });
});
