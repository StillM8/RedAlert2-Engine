import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { Rules } from "@/game/rules/Rules";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import { MoveTrait, MoveState } from "@/game/gameobject/trait/MoveTrait";
import { TntChargeTrait } from "@/game/gameobject/trait/TntChargeTrait";
import {
    captureExtensionState,
    restoreExtensionState,
    EXTENSION_STATE_SNAPSHOT_VERSION,
    type ExtensionStateSnapshot,
} from "@/game/state/ExtensionStateSnapshot";

/**
 * Contract tests for the extension-state snapshot walk: stable collection
 * order, codec dispatch with caller-supplied contexts, transactional strict
 * validation (no partial application), and JSON-safe payloads. The per-codec
 * restore semantics stay covered by their own suites.
 */

function stubTrait(): AresAttachEffectTrait {
    const trait = Object.create(AresAttachEffectTrait.prototype) as any;
    trait.serialized = { hp: 5 };
    trait.calls = [] as unknown[];
    trait.serializeState = () => trait.serialized;
    trait.validateState = (state: unknown) => {
        if (!state || typeof state !== "object") throw new Error("invalid attach state");
    };
    trait.restoreState = (state: unknown, context?: unknown) => {
        trait.calls.push({ state, context });
    };
    return trait as AresAttachEffectTrait;
}

function makeWeapon(name: string) {
    return {
        name,
        rules: { name },
        calls: [] as unknown[],
        serializeAresState: () => ({ charge: name.length }),
        validateAresState: (state: unknown) => {
            if (!state || typeof state !== "object") throw new Error("invalid superweapon state");
        },
        restoreAresState: (state: unknown, world?: unknown) => {
            (weaponCalls as unknown[]).push({ name, state, world });
        },
    };
}

const weaponCalls: unknown[] = [];
const productionCalls: unknown[] = [];
const animationCalls: unknown[] = [];

function makeObjectTechLevelRules(entries: Array<{ name: string; type: ObjectType }>): any {
    const rules = Object.create(Rules.prototype) as any;
    rules.buildingRules = new Map(entries.filter(entry => entry.type === ObjectType.Building).map(entry => [entry.name, entry]));
    rules.infantryRules = new Map(entries.filter(entry => entry.type === ObjectType.Infantry).map(entry => [entry.name, entry]));
    rules.vehicleRules = new Map(entries.filter(entry => entry.type === ObjectType.Vehicle).map(entry => [entry.name, entry]));
    rules.aircraftRules = new Map(entries.filter(entry => entry.type === ObjectType.Aircraft).map(entry => [entry.name, entry]));
    rules.objectTechLevelOverrides = new Map();
    return rules;
}

function makePlayer(index: number, weapons: any[]) {
    return {
        playerListIndex: index,
        superWeaponsTrait: { getAll: () => weapons },
        production: {
            captureState: () => ({ queue: index }),
            validateDeterministicState: (state: unknown) => {
                if (!state || typeof state !== "object") throw new Error("invalid production state");
            },
            restoreDeterministicState: (state: unknown, context?: unknown) => {
                productionCalls.push({ index, state, context });
            },
        },
    };
}

function makeGame() {
    const traitA = stubTrait();
    const traitB = stubTrait();
    const objectB = { id: 2, traits: { getAll: () => [traitB] } };
    const objectA = { id: 1, traits: { getAll: () => [traitA] } };
    // Deliberately unsorted input: the walk must impose canonical order.
    const game = {
        playerList: { getAll: () => [makePlayer(0, [makeWeapon("Zeta"), makeWeapon("Alpha")]), makePlayer(1, [])] },
        world: { getAllObjects: () => [objectB, objectA] },
        getObjectById: (id: number) => [objectB, objectA].find((object) => object.id === id),
        aresAnimationDamageRuntime: {
            captureState: () => ({ instances: [] }),
            validateState: (state: unknown) => {
                if (!state || typeof state !== "object") throw new Error("invalid animation state");
            },
            restoreState: (state: unknown, context?: unknown) => {
                animationCalls.push({ state, context });
            },
        },
    };
    return { game, traitA, traitB };
}

function resetCalls(): void {
    weaponCalls.length = 0;
    productionCalls.length = 0;
    animationCalls.length = 0;
}

describe("extension state snapshot walk", () => {
    test("capture walks every subsystem in canonical order", () => {
        const { game } = makeGame();
        const snapshot = captureExtensionState(game);

        expect(snapshot.version).toBe(EXTENSION_STATE_SNAPSHOT_VERSION);
        expect(snapshot.players.map((entry) => entry.playerListIndex)).toEqual([0, 1]);
        expect(snapshot.players[0].superWeapons.map((entry) => entry.name)).toEqual(["Alpha", "Zeta"]);
        expect(snapshot.players[1].superWeapons).toEqual([]);
        expect(snapshot.players[0].productionState).toEqual({ queue: 0 });
        expect(snapshot.attachEffects.map((entry) => entry.objectId)).toEqual([1, 2]);
        expect(snapshot.animationDamageState).toEqual({ instances: [] });

        // Capturing twice yields an identical payload (stable ordering).
        expect(captureExtensionState(game)).toEqual(snapshot);
    });

    test("restore dispatches each codec with caller-supplied contexts", () => {
        resetCalls();
        const source = makeGame();
        const snapshot = captureExtensionState(source.game);
        const { game, traitA, traitB } = makeGame();

        restoreExtensionState(game, snapshot, {
            productionContext: { mode: "strict" },
            attachEffectContext: { definitions: 1 },
            superWeaponWorld: { world: true },
        });

        expect(productionCalls).toMatchObject([
            { index: 0, state: { queue: 0 }, context: { mode: "strict" } },
            { index: 1, state: { queue: 1 }, context: { mode: "strict" } },
        ]);
        expect(weaponCalls.map((call: any) => call.name)).toEqual(["Alpha", "Zeta"]);
        expect((weaponCalls[0] as any).world).toEqual({ world: true });
        expect((traitA as any).calls).toMatchObject([{ state: { hp: 5 }, context: { definitions: 1 } }]);
        expect((traitB as any).calls).toMatchObject([{ state: { hp: 5 }, context: { definitions: 1 } }]);
        expect(animationCalls).toMatchObject([{ state: { instances: [] } }]);
    });

    test("strict restore rejects unresolved references before mutating anything", () => {
        const { game, traitA } = makeGame();
        const snapshot = captureExtensionState(game);

        const brokenPlayer: ExtensionStateSnapshot = {
            ...snapshot,
            players: [...snapshot.players, { playerListIndex: 9, superWeapons: [] }],
        };
        const brokenWeapon: ExtensionStateSnapshot = {
            ...snapshot,
            players: snapshot.players.map((entry) =>
                entry.playerListIndex === 0
                    ? { ...entry, superWeapons: [...entry.superWeapons, { name: "Missing", state: {} }] }
                    : entry),
        };
        const brokenObject: ExtensionStateSnapshot = {
            ...snapshot,
            attachEffects: [...snapshot.attachEffects, { objectId: 99, state: {} }],
        };

        for (const broken of [brokenPlayer, brokenWeapon, brokenObject]) {
            resetCalls();
            (traitA as any).calls.length = 0;
            expect(() => restoreExtensionState(game, broken, { strict: true })).toThrow(/unresolved/i);
            // Transactional: not a single codec may have been applied.
            expect(productionCalls).toEqual([]);
            expect(weaponCalls).toEqual([]);
            expect(animationCalls).toEqual([]);
            expect((traitA as any).calls).toEqual([]);
        }
    });

    test("permissive restore skips unresolved references and restores the rest", () => {
        resetCalls();
        const { game } = makeGame();
        const snapshot = captureExtensionState(game);
        const broken: ExtensionStateSnapshot = {
            ...snapshot,
            players: [...snapshot.players, { playerListIndex: 9, superWeapons: [{ name: "Missing", state: {} }] }],
            attachEffects: [...snapshot.attachEffects, { objectId: 99, state: {} }],
        };

        restoreExtensionState(game, broken);

        expect(productionCalls).toHaveLength(2);
        expect(weaponCalls.map((call: any) => call.name)).toEqual(["Alpha", "Zeta"]);
        expect(animationCalls).toHaveLength(1);
    });

    test("captures and restores move and tnt object state", () => {
        const rules = {
            deathBomb: false,
            destroysBridges: true,
            detachable: true,
            damage: 100,
            delay: 20,
            warhead: "IvanWH",
            flickerRate: 2,
            canDetonateTimeBomb: true,
            canDetonateDeathBomb: true,
            detonateOnSell: true,
        };
        const makeObject = (id: number, player: any, attackerId: number) => {
            const object: any = { id, traits: { getAll: () => [] } };
            object.moveTrait = new MoveTrait(object, {});
            object.tntChargeTrait = new TntChargeTrait();
            object.tntChargeTrait.setCharge(20, 5, {
                player,
                obj: { id: attackerId },
            }, rules);
            object.traits.getAll = () => [object.moveTrait, object.tntChargeTrait];
            return object;
        };
        const sourcePlayer = makePlayer(0, []);
        const sourceAttacker = { id: 4 };
        const sourceObject = makeObject(3, sourcePlayer, sourceAttacker.id);
        sourceObject.moveTrait.setDisabled(true);
        sourceObject.moveTrait.setChronoAftereffectLocked(true);
        sourceObject.moveTrait.moveState = MoveState.Moving;
        const sourceGame = {
            playerList: { getAll: () => [sourcePlayer] },
            world: { getAllObjects: () => [sourceObject, sourceAttacker] },
        };
        const snapshot = JSON.parse(JSON.stringify(captureExtensionState(sourceGame)));
        expect(snapshot.moveStates).toEqual([{ objectId: 3, state: sourceObject.moveTrait.captureState() }]);
        expect(snapshot.tntChargeStates).toEqual([{ objectId: 3, state: sourceObject.tntChargeTrait.captureState() }]);

        resetCalls();
        const targetPlayer = makePlayer(0, []);
        const targetAttacker = { id: 4 };
        const targetObject = makeObject(3, targetPlayer, targetAttacker.id);
        const targetGame = {
            playerList: { getAll: () => [targetPlayer] },
            world: { getAllObjects: () => [targetObject, targetAttacker] },
        };
        restoreExtensionState(targetGame, snapshot, { strict: true });

        expect(targetObject.moveTrait.captureState()).toEqual(snapshot.moveStates[0].state);
        expect(targetObject.moveTrait.isChronoAftereffectLocked()).toBe(true);
        expect(targetObject.tntChargeTrait.captureState()).toEqual(snapshot.tntChargeStates[0].state);
        expect(targetObject.tntChargeTrait.getChargeOwner()).toBe(targetPlayer);
    });

    test("validates every nested payload before applying any codec", () => {
        resetCalls();
        const { game } = makeGame();
        const player = game.playerList.getAll()[0];
        const tnt = new TntChargeTrait();
        tnt.setCharge(10, 2, { player }, {
            deathBomb: false,
            destroysBridges: true,
            detachable: true,
            damage: 50,
            delay: 10,
            warhead: "IvanWH",
            flickerRate: 1,
            canDetonateTimeBomb: true,
            canDetonateDeathBomb: true,
            detonateOnSell: true,
        });
        const object = { id: 8, tntChargeTrait: tnt, traits: { getAll: () => [] } };
        const existingObjects = game.world.getAllObjects();
        game.world.getAllObjects = () => [...existingObjects, object];
        const state = tnt.captureState();
        const snapshot = captureExtensionState(game);
        snapshot.tntChargeStates = [{ objectId: 8, state: { ...state, bombRules: { ...state.bombRules, damage: "bad" } } }];

        expect(() => restoreExtensionState(game, snapshot, { strict: true })).toThrow(/tnt charge state/);
        expect(productionCalls).toEqual([]);
        expect(weaponCalls).toEqual([]);
        expect(animationCalls).toEqual([]);
    });

    test("rejects unsupported snapshot versions and malformed payloads", () => {
        const { game } = makeGame();
        expect(() => restoreExtensionState(game, { version: 2, players: [], attachEffects: [] }))
            .toThrow(/version/i);
        expect(() => restoreExtensionState(game, null)).toThrow(/object/i);
        expect(() => restoreExtensionState(game, { version: 1, players: {}, attachEffects: [] }))
            .toThrow(/arrays/i);
    });

    test("snapshot survives a JSON round-trip", () => {
        resetCalls();
        const source = makeGame();
        const snapshot = captureExtensionState(source.game);
        const revived = JSON.parse(JSON.stringify(snapshot)) as ExtensionStateSnapshot;
        const { game } = makeGame();

        restoreExtensionState(game, revived, { strict: true });
        expect(productionCalls).toHaveLength(2);
        expect(weaponCalls).toHaveLength(2);
        expect(animationCalls).toHaveLength(1);
    });

    test("round-trips and hashes canonical object tech level override state", () => {
        const sourceRules = makeObjectTechLevelRules([
            { name: "E1", type: ObjectType.Infantry },
            { name: "SHARED", type: ObjectType.Infantry },
            { name: "SHARED", type: ObjectType.Vehicle },
        ]);
        const initialHash = sourceRules.getObjectTechLevelOverrideHash();
        sourceRules.restoreObjectTechLevelOverrideState({
            version: 1,
            overrides: [
                { objectType: ObjectType.Vehicle, technoTypeName: "SHARED", techLevel: 8 },
                { objectType: ObjectType.Infantry, technoTypeName: "E1", techLevel: 0 },
                { objectType: ObjectType.Infantry, technoTypeName: "SHARED", techLevel: 2 },
            ],
        }, true);
        const sourceGame: any = {
            rules: sourceRules,
            playerList: { getAll: () => [] },
            world: { getAllObjects: () => [] },
            triggers: { captureState: () => undefined },
        };
        const snapshot = JSON.parse(JSON.stringify(captureExtensionState(sourceGame))) as ExtensionStateSnapshot;
        expect(snapshot.objectTechLevelState?.overrides).toEqual([
            { objectType: ObjectType.Infantry, technoTypeName: "E1", techLevel: 0 },
            { objectType: ObjectType.Infantry, technoTypeName: "SHARED", techLevel: 2 },
            { objectType: ObjectType.Vehicle, technoTypeName: "SHARED", techLevel: 8 },
        ]);
        expect(sourceRules.getObjectTechLevelOverrideHash()).not.toBe(initialHash);

        const targetRules = makeObjectTechLevelRules([
            { name: "E1", type: ObjectType.Infantry },
            { name: "SHARED", type: ObjectType.Infantry },
            { name: "SHARED", type: ObjectType.Vehicle },
        ]);
        const targetGame = { ...sourceGame, rules: targetRules };
        restoreExtensionState(targetGame, snapshot, { strict: true });

        expect(targetRules.captureObjectTechLevelOverrideState()).toEqual(sourceRules.captureObjectTechLevelOverrideState());
        expect(targetRules.getObjectTechLevelOverrideHash()).toBe(sourceRules.getObjectTechLevelOverrideHash());
    });

    test("strict object tech level restore rejects unresolved and duplicate identities transactionally", () => {
        const sourceRules = makeObjectTechLevelRules([{ name: "E1", type: ObjectType.Infantry }]);
        sourceRules.setObjectTechLevelOverride("E1", 0);
        const sourceGame: any = {
            rules: sourceRules,
            playerList: { getAll: () => [] },
            world: { getAllObjects: () => [] },
        };
        const snapshot = captureExtensionState(sourceGame);
        const targetRules = makeObjectTechLevelRules([{ name: "E1", type: ObjectType.Infantry }]);
        targetRules.setObjectTechLevelOverride("E1", 3);
        const targetGame: any = {
            rules: targetRules,
            playerList: { getAll: () => [] },
            world: { getAllObjects: () => [] },
        };
        const before = targetRules.captureObjectTechLevelOverrideState();

        const unresolved: any = structuredClone(snapshot);
        unresolved.objectTechLevelState.overrides.push({
            objectType: ObjectType.Vehicle,
            technoTypeName: "GHOST",
            techLevel: 1,
        });
        expect(() => restoreExtensionState(targetGame, unresolved, { strict: true })).toThrow(/unresolved/i);
        expect(targetRules.captureObjectTechLevelOverrideState()).toEqual(before);

        const duplicate: any = structuredClone(snapshot);
        duplicate.objectTechLevelState.overrides.push({ ...duplicate.objectTechLevelState.overrides[0] });
        expect(() => restoreExtensionState(targetGame, duplicate, { strict: true })).toThrow(/duplicate/i);
        expect(targetRules.captureObjectTechLevelOverrideState()).toEqual(before);

        const invalidVersion: any = structuredClone(snapshot);
        invalidVersion.objectTechLevelState.version = 2;
        expect(() => restoreExtensionState(targetGame, invalidVersion, { strict: true })).toThrow(/version/i);
        expect(targetRules.captureObjectTechLevelOverrideState()).toEqual(before);
    });
});
