import { describe, expect, test } from "bun:test";
import { decideAresChronoPrison } from "@/extensions/ares/AresChronoPrisonRuntime";
import type {
    AresChronoPrisonAttackerSnapshot,
    AresChronoPrisonRuntimeInput,
    AresChronoPrisonTargetSnapshot,
} from "@/extensions/ares/AresChronoPrisonRuntime";
import type { AresChronoPrisonWeaponRules } from "@/extensions/ares/AresChronoPrisons";

const weapon: AresChronoPrisonWeaponRules = {
    abductor: true,
    temporal: false,
    changeOwner: true,
    abductBelowPercent: 0.75,
    maxHealth: 1000,
};

const target: AresChronoPrisonTargetSnapshot = {
    passengerCapable: true,
    health: 750,
    healthPercent: 0.75,
    size: 1,
    immuneToAbduction: false,
};

const attacker: AresChronoPrisonAttackerSnapshot = {
    sizeLimit: 2,
    passengerCapacity: 4,
    occupiedPassengerCapacity: 1,
};

function input(overrides: Partial<AresChronoPrisonRuntimeInput> = {}): AresChronoPrisonRuntimeInput {
    return { weapon, target, attacker, ...overrides };
}

describe("Ares Chrono Prison runtime decisions", () => {
    test("accepts an eligible target at the exact health threshold and returns owner-transfer intent", () => {
        const decision = decideAresChronoPrison(input());

        expect(decision).toEqual({
            eligible: true,
            reason: "eligible",
            fallbackToConventionalDamage: false,
            fallbackToTemporalErase: false,
            waitForTemporalErasure: false,
            changeOwner: true,
        });
    });

    test("rejects immune, unhealthy, over-health, oversized, and full-hold targets without mutation", () => {
        const originalTarget = structuredClone(target);
        expect(decideAresChronoPrison(input({ target: { ...target, immuneToAbduction: true } })).reason)
            .toBe("immune-to-abduction");
        expect(decideAresChronoPrison(input({ target: { ...target, healthPercent: 0.8 } })).reason)
            .toBe("health-threshold");
        expect(decideAresChronoPrison(input({ target: { ...target, health: 1001 } })).reason)
            .toBe("max-health");
        expect(decideAresChronoPrison(input({ target: { ...target, size: 3 } })).reason)
            .toBe("size-limit");
        expect(decideAresChronoPrison(input({ attacker: { ...attacker, occupiedPassengerCapacity: 4 } })).reason)
            .toBe("passenger-capacity");
        expect(target).toEqual(originalTarget);
    });

    test("honors target eligibility and Iron Curtain gates", () => {
        expect(decideAresChronoPrison(input({ target: { ...target, passengerCapable: false } }))).toMatchObject({
            eligible: false,
            reason: "invalid-target",
            fallbackToConventionalDamage: true,
        });
        expect(decideAresChronoPrison(input({ target: { ...target, warheadCanAffect: false } })).reason)
            .toBe("warhead-cannot-affect");
        expect(decideAresChronoPrison(input({ target: { ...target, ironCurtained: true } })).reason)
            .toBe("iron-curtained");
    });

    test("defers temporal abductors until temporal erase and requires a temporal warhead", () => {
        const temporalWeapon = { ...weapon, temporal: true };
        expect(decideAresChronoPrison(input({ weapon: temporalWeapon }))).toMatchObject({
            eligible: false,
            reason: "temporal-warhead-required",
            fallbackToConventionalDamage: true,
            waitForTemporalErasure: false,
        });
        expect(decideAresChronoPrison(input({ weapon: temporalWeapon, warheadIsTemporal: true }))).toMatchObject({
            eligible: false,
            reason: "awaiting-temporal-erasure",
            fallbackToConventionalDamage: false,
            fallbackToTemporalErase: true,
            waitForTemporalErasure: true,
        });
        expect(decideAresChronoPrison(input({
            weapon: temporalWeapon,
            warheadIsTemporal: true,
            phase: "temporal-erasure",
        })).eligible).toBe(true);
    });

    test("defers temporal eligibility gates and preserves normal erase when abduction fails", () => {
        const temporalWeapon = { ...weapon, temporal: true };
        const waiting = decideAresChronoPrison(input({
            weapon: temporalWeapon,
            warheadIsTemporal: true,
            target: { ...target, immuneToAbduction: true, healthPercent: 0.9 },
        }));
        expect(waiting).toMatchObject({
            eligible: false,
            reason: "awaiting-temporal-erasure",
            fallbackToConventionalDamage: false,
            fallbackToTemporalErase: true,
            waitForTemporalErasure: true,
        });

        const failedAtErase = decideAresChronoPrison(input({
            weapon: temporalWeapon,
            warheadIsTemporal: true,
            phase: "temporal-erasure",
            target: { ...target, healthPercent: 0.9 },
        }));
        expect(failedAtErase).toEqual({
            eligible: false,
            reason: "health-threshold",
            fallbackToConventionalDamage: false,
            fallbackToTemporalErase: true,
            waitForTemporalErasure: false,
            changeOwner: false,
        });
    });

    test("suppresses owner transfer for psionics-immune targets", () => {
        const decision = decideAresChronoPrison(input({ target: { ...target, psionicsImmune: true } }));
        expect(decision.eligible).toBe(true);
        expect(decision.changeOwner).toBe(false);
    });

    test("rejects malformed normalized weapon thresholds instead of allowing abduction", () => {
        const decision = decideAresChronoPrison(input({
            weapon: { ...weapon, abductBelowPercent: Number.NaN },
        }));
        expect(decision).toMatchObject({
            eligible: false,
            reason: "invalid-weapon",
            fallbackToConventionalDamage: true,
        });
    });
});
