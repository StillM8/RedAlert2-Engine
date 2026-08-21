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
        };
        restoreAresAttachEffectExtensionState(target, state);
        expect(target).toEqual({
            instances: state.instances,
            automaticPhase: state.automaticPhase,
            automaticRemainingDelay: state.automaticRemainingDelay,
            animationDamage: new Map(),
        });

        const trait = new AresAttachEffectTrait();
        trait.restoreState(state);
        expect(trait.serializeState()).toEqual(state);
        expect(() => trait.restoreState({ ...state, instances: [{ ...state.instances[0], remainingFrames: -2 }] }))
            .toThrow();
        expect(trait.serializeState()).toEqual(state);
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
