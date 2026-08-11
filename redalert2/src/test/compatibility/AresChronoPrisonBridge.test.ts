import { describe, expect, test } from "bun:test";
import {
    buildAresChronoPrisonAttackerSnapshot,
    buildAresChronoPrisonTargetSnapshot,
    decideAresChronoPrisonFromFacts,
    type AresChronoPrisonAttackerFacts,
    type AresChronoPrisonBridgeInput,
    type AresChronoPrisonTargetFacts,
} from "@/extensions/ares/AresChronoPrisonBridge";
import type { AresChronoPrisonWeaponRules } from "@/extensions/ares/AresChronoPrisons";

const weapon: AresChronoPrisonWeaponRules = {
    abductor: true,
    temporal: false,
    changeOwner: true,
    abductBelowPercent: 0.75,
    maxHealth: 1000,
};

const targetFacts: AresChronoPrisonTargetFacts = {
    passengerCapable: true,
    health: 750,
    maxHealth: 1000,
    size: 1,
    immuneToAbduction: false,
};

const attackerFacts: AresChronoPrisonAttackerFacts = {
    sizeLimit: 2,
    passengerCapacity: 4,
    occupiedPassengerCapacity: 1,
};

function input(overrides: Partial<AresChronoPrisonBridgeInput> = {}): AresChronoPrisonBridgeInput {
    return { weapon, target: targetFacts, attacker: attackerFacts, ...overrides };
}

describe("Ares Chrono Prison structural integration bridge", () => {
    test("builds detached snapshots and delegates an eligible decision", () => {
        const targetSnapshot = buildAresChronoPrisonTargetSnapshot(targetFacts);
        const attackerSnapshot = buildAresChronoPrisonAttackerSnapshot(attackerFacts);

        expect(targetSnapshot).toEqual({
            passengerCapable: true,
            health: 750,
            healthPercent: 0.75,
            size: 1,
            immuneToAbduction: false,
            psionicsImmune: undefined,
            ironCurtained: undefined,
            warheadCanAffect: undefined,
        });
        expect(attackerSnapshot).toEqual(attackerFacts);
        expect(targetSnapshot).not.toBe(targetFacts);
        expect(attackerSnapshot).not.toBe(attackerFacts);
        expect(decideAresChronoPrisonFromFacts(input())).toEqual({
            eligible: true,
            reason: "eligible",
            fallbackToConventionalDamage: false,
            fallbackToTemporalErase: false,
            waitForTemporalErasure: false,
            changeOwner: true,
        });
    });

    test("preserves temporal waiting and erase fallback decisions", () => {
        const temporalWeapon = { ...weapon, temporal: true };
        const source = input({
            weapon: temporalWeapon,
            warheadIsTemporal: true,
            target: { ...targetFacts, immuneToAbduction: true, health: 900 },
        });
        const original = structuredClone(source);

        expect(decideAresChronoPrisonFromFacts(source)).toMatchObject({
            eligible: false,
            reason: "awaiting-temporal-erasure",
            fallbackToConventionalDamage: false,
            fallbackToTemporalErase: true,
            waitForTemporalErasure: true,
        });
        expect(decideAresChronoPrisonFromFacts({
            ...source,
            phase: "temporal-erasure",
            target: { ...source.target, immuneToAbduction: false, health: 900 },
        })).toEqual({
            eligible: false,
            reason: "health-threshold",
            fallbackToConventionalDamage: false,
            fallbackToTemporalErase: true,
            waitForTemporalErasure: false,
            changeOwner: false,
        });
        expect(source).toEqual(original);
    });

    test("rejects unusable health facts safely without mutating caller data", () => {
        const malformedTarget = { ...targetFacts, maxHealth: 0 };
        const before = structuredClone(malformedTarget);

        expect(decideAresChronoPrisonFromFacts(input({ target: malformedTarget }))).toMatchObject({
            eligible: false,
            reason: "invalid-target",
            fallbackToConventionalDamage: true,
            fallbackToTemporalErase: false,
        });
        expect(malformedTarget).toEqual(before);
    });
});
