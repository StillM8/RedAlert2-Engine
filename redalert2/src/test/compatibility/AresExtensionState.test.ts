import { describe, expect, test } from "bun:test";
import {
    restoreAresAttachEffectExtensionState,
    serializeAresAttachEffectExtensionState,
} from "@/extensions/ares/AresAttachEffectState";
import {
    restoreAresSuperWeaponExtensionState,
    serializeAresSuperWeaponExtensionState,
} from "@/extensions/ares/AresSuperWeaponState";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import { SuperWeapon, SuperWeaponStatus } from "@/game/SuperWeapon";

describe("Ares deterministic extension state", () => {
    test("serializes and restores superweapon charge state atomically", () => {
        const source = serializeAresSuperWeaponExtensionState({
            status: SuperWeaponStatus.Draining,
            chargeTicks: 120,
            shotsFired: 4,
            chargeDrainRatio: 1.5,
            virtualChargeSinceTick: 900,
            aresBatteryActive: true,
        });
        expect(source).toEqual({
            version: 1,
            status: SuperWeaponStatus.Draining,
            chargeTicks: 120,
            shotsFired: 4,
            chargeDrainRatio: 1.5,
            virtualChargeSinceTick: 900,
            aresBatteryActive: true,
        });

        const target = {
            status: SuperWeaponStatus.Ready,
            chargeTicks: 1,
            shotsFired: 0,
            chargeDrainRatio: 1,
            virtualChargeSinceTick: undefined as number | undefined,
            aresBatteryActive: false,
        };
        restoreAresSuperWeaponExtensionState(target, source);
        expect(target).toEqual({
            status: source.status,
            chargeTicks: source.chargeTicks,
            shotsFired: source.shotsFired,
            chargeDrainRatio: source.chargeDrainRatio,
            virtualChargeSinceTick: source.virtualChargeSinceTick,
            aresBatteryActive: source.aresBatteryActive,
        });

        const before = { ...target };
        expect(() => restoreAresSuperWeaponExtensionState(target, {
            ...source,
            chargeTicks: -1,
        })).toThrow();
        expect(target).toEqual(before);
    });

    test("round-trips the SuperWeapon host boundary", () => {
        const owner = { superWeaponsTrait: { getAresShotsFired: () => 0 } };
        const weapon = new SuperWeapon("BatterySpecial", {
            rechargeTime: 10,
            ares: { extensionType: "GenericWarhead" },
        }, owner);
        (weapon as any).status = SuperWeaponStatus.Draining;
        (weapon as any).chargeTicks = 42;
        (weapon as any).shotsFired = 3;
        (weapon as any).chargeDrainRatio = 2;
        const snapshot = weapon.serializeAresState();

        (weapon as any).status = SuperWeaponStatus.Ready;
        (weapon as any).chargeTicks = 0;
        (weapon as any).shotsFired = 0;
        weapon.restoreAresState(snapshot);
        expect(weapon.serializeAresState()).toEqual(snapshot);
    });

    test("restored charge drain continues identically from a dirty SuperWeapon", () => {
        const rules = {
            rechargeTime: 1,
            ares: { extensionType: "GenericWarhead" },
        };
        const makeWeapon = () => new SuperWeapon("Drain", rules, { credits: 0 });
        const source = makeWeapon();
        source.rechargeTicks = 100;
        source.chargeTicks = 0;
        source.status = SuperWeaponStatus.Ready;
        expect(source.startChargeDrain(2)).toBe(true);
        const game = { events: { dispatch: () => undefined } };
        for (let tick = 0; tick < 17; tick++) source.update(game);
        const snapshot = JSON.parse(JSON.stringify(source.serializeAresState()));

        const restored = makeWeapon();
        restored.rechargeTicks = 100;
        restored.chargeTicks = 1;
        restored.status = SuperWeaponStatus.Charging;
        restored.restoreAresState(snapshot);
        expect(restored.serializeAresState()).toEqual(snapshot);
        expect(restored.getHash()).toBe(source.getHash());

        for (let tick = 0; tick < 100; tick++) {
            source.update(game);
            restored.update(game);
            expect(restored.serializeAresState()).toEqual(source.serializeAresState());
            expect(restored.getHash()).toBe(source.getHash());
        }
    });

    test("restores AttachEffect instances and automatic scheduling as one unit", () => {
        const state = serializeAresAttachEffectExtensionState({
            instances: [{ effectId: "armor", remainingFrames: 12, discardOnEntry: true }],
            automaticPhase: "waiting-renewal",
            automaticRemainingDelay: 3,
        });
        const target = {
            instances: [],
            automaticPhase: "inactive" as const,
            automaticRemainingDelay: 0,
            animationDamage: new Map(),
            definitions: new Map(),
        };
        restoreAresAttachEffectExtensionState(target, state);
        expect(target).toEqual({
            instances: state.instances,
            automaticPhase: state.automaticPhase,
            automaticRemainingDelay: state.automaticRemainingDelay,
            animationDamage: new Map(),
            definitions: new Map(),
        });

        const trait = new AresAttachEffectTrait();
        trait.restoreState(state);
        expect(trait.serializeState()).toEqual(state);
        expect(() => trait.restoreState({ ...state, instances: [{ ...state.instances[0], remainingFrames: -2 }] }))
            .toThrow();
        expect(trait.serializeState()).toEqual(state);
    });

    test("rebinds definitions from recorded origins during restore", () => {
        const state = serializeAresAttachEffectExtensionState({
            instances: [{ effectId: "slow", remainingFrames: 20, discardOnEntry: false }],
            automaticPhase: "inactive",
            automaticRemainingDelay: 0,
            origins: [{ effectId: "slow", kind: "warhead", ownerName: "CryoBeam" }],
        });
        const trait = new AresAttachEffectTrait();
        trait.restoreState(state, {
            resolveDefinition: (kind, ownerName) =>
                kind === "warhead" && ownerName === "CryoBeam"
                    ? { speedMultiplier: 0.5 }
                    : undefined,
        });
        // The restored trait contributes the rebound definition's modifier.
        expect(trait.getAggregateMultipliers().speed).toBeCloseTo(0.5, 10);
        // Re-snapshotting keeps the origin for a later restore generation.
        expect(trait.serializeState().origins).toEqual([
            { effectId: "slow", kind: "warhead", ownerName: "CryoBeam" },
        ]);

        // An unresolvable origin leaves the effect present but contributing
        // nothing — identical to a live trait with no applied definition.
        const inertTrait = new AresAttachEffectTrait();
        inertTrait.restoreState(state, { resolveDefinition: () => undefined });
        expect(inertTrait.getState()).toHaveLength(1);
        expect(new AresAttachEffectTrait().getAggregateMultipliers())
            .toEqual(inertTrait.getAggregateMultipliers());
    });

    test("AttachEffect codec restores transactionally when a later resolver throws", () => {
        const target = {
            instances: [{ effectId: "old", remainingFrames: 9, discardOnEntry: false }],
            automaticPhase: "active" as const,
            automaticRemainingDelay: 4,
            animationDamage: new Map([
                ["old", [{ accumulator: 0.5, frameAccumulator: 0.25, sourcePlayer: { id: 7 } }]],
            ]),
            definitions: new Map([["old", { speedMultiplier: 0.8 }]]),
        };
        const before = {
            instances: target.instances.map(instance => ({ ...instance })),
            automaticPhase: target.automaticPhase,
            automaticRemainingDelay: target.automaticRemainingDelay,
            animationDamage: [...target.animationDamage.entries()],
            definitions: [...target.definitions.entries()],
        };
        const state = serializeAresAttachEffectExtensionState({
            instances: [
                { effectId: "first", remainingFrames: 10, discardOnEntry: false },
                { effectId: "second", remainingFrames: 11, discardOnEntry: false },
            ],
            automaticPhase: "waiting-renewal",
            automaticRemainingDelay: 3,
            origins: [
                { effectId: "first", kind: "warhead", ownerName: "First" },
                { effectId: "second", kind: "warhead", ownerName: "Second" },
            ],
        });
        let calls = 0;
        expect(() => restoreAresAttachEffectExtensionState(target, state, {
            strict: true,
            resolveDefinition: () => {
                if (calls++ === 0) return { speedMultiplier: 0.9 };
                throw new Error("resolver failed on second origin");
            },
        })).toThrow(/second origin/);
        expect(target.instances).toEqual(before.instances);
        expect(target.automaticPhase).toBe(before.automaticPhase);
        expect(target.automaticRemainingDelay).toBe(before.automaticRemainingDelay);
        expect([...target.animationDamage.entries()]).toEqual(before.animationDamage);
        expect([...target.definitions.entries()]).toEqual(before.definitions);
    });

    test("round-trips pending animation damage accumulation through the snapshot", () => {
        // Two stacked occurrences of the same effect each keep their own
        // partial damage accumulator.
        const state = serializeAresAttachEffectExtensionState({
            instances: [
                { effectId: "burn", remainingFrames: 30, discardOnEntry: false },
                { effectId: "burn", remainingFrames: 30, discardOnEntry: false },
            ],
            automaticPhase: "active",
            automaticRemainingDelay: 0,
            animationDamage: [
                { effectId: "burn", occurrence: 0, accumulator: 12.5, frameAccumulator: 3.25 },
                { effectId: "burn", occurrence: 1, accumulator: 0.5, frameAccumulator: 0 },
            ],
        });
        expect(state.animationDamage).toHaveLength(2);

        const trait = new AresAttachEffectTrait();
        trait.restoreState(state);
        expect(trait.serializeState()).toEqual(state);

        const rejected = {
            ...state,
            animationDamage: [{ ...state.animationDamage![0], accumulator: -1 }],
        };
        expect(() => trait.restoreState(rejected)).toThrow();
        expect(trait.serializeState()).toEqual(state);

        // A snapshot without pending damage stays free of the optional field.
        const clean = serializeAresAttachEffectExtensionState({
            instances: [{ effectId: "armor", remainingFrames: 5, discardOnEntry: false }],
            automaticPhase: "active",
            automaticRemainingDelay: 0,
        });
        expect("animationDamage" in clean).toBe(false);
    });
});
