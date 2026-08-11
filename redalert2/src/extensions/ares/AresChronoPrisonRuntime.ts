import {
    type AresChronoPrisonTechnoRules,
    type AresChronoPrisonWeaponRules,
} from "@/extensions/ares/AresChronoPrisons";

/** The two points at which Ares can evaluate an abductor weapon. */
export type AresChronoPrisonPhase = "impact" | "temporal-erasure";

export type AresChronoPrisonDecisionReason =
    | "not-abductor"
    | "invalid-weapon"
    | "invalid-target"
    | "immune-to-abduction"
    | "warhead-cannot-affect"
    | "iron-curtained"
    | "temporal-warhead-required"
    | "awaiting-temporal-erasure"
    | "health-threshold"
    | "max-health"
    | "size-limit"
    | "passenger-capacity"
    | "eligible";

/**
 * Read-only facts supplied by the future weapon/warhead integration hook.
 * The adapter deliberately receives snapshots and never mutates the source
 * game objects.
 */
export interface AresChronoPrisonTargetSnapshot {
    /** Antares only abducts a FootClass/passenger-capable target. */
    passengerCapable: boolean;
    health: number;
    /** Current health divided by maximum health, normalized to 0..1. */
    healthPercent: number;
    size: number;
    immuneToAbduction: boolean;
    /** Includes ImmuneToPsionics and the PSIONICSIMMUNE veteran ability. */
    psionicsImmune?: boolean;
    ironCurtained?: boolean;
    /** Defaults to true when the host has no separate warhead predicate. */
    warheadCanAffect?: boolean;
}

export interface AresChronoPrisonAttackerSnapshot {
    /** TechnoType.SizeLimit. */
    sizeLimit: number;
    /** TechnoType.Passengers, represented as total passenger-size capacity. */
    passengerCapacity: number;
    /** Current passenger size already occupying the hold. */
    occupiedPassengerCapacity: number;
}

export interface AresChronoPrisonRuntimeInput {
    weapon: AresChronoPrisonWeaponRules;
    target: AresChronoPrisonTargetSnapshot;
    attacker: AresChronoPrisonAttackerSnapshot;
    techno?: Pick<AresChronoPrisonTechnoRules, "immuneToAbduction">;
    /** Whether the weapon's Warhead has Temporal=yes. */
    warheadIsTemporal?: boolean;
    phase?: AresChronoPrisonPhase;
}

export interface AresChronoPrisonRuntimeDecision {
    eligible: boolean;
    reason: AresChronoPrisonDecisionReason;
    /** Conventional damage remains responsible for a rejected abduction. */
    fallbackToConventionalDamage: boolean;
    /** A failed Abductor.Temporal attempt leaves the normal erase path intact. */
    fallbackToTemporalErase: boolean;
    /** True only while a valid Abductor.Temporal hit awaits temporal erase. */
    waitForTemporalErasure: boolean;
    /** Owner transfer is a post-success decision, never an object mutation. */
    changeOwner: boolean;
}

const REJECTED: Pick<AresChronoPrisonRuntimeDecision, "eligible" | "fallbackToConventionalDamage" | "fallbackToTemporalErase" | "waitForTemporalErasure" | "changeOwner"> = {
    eligible: false,
    fallbackToConventionalDamage: true,
    fallbackToTemporalErase: false,
    waitForTemporalErasure: false,
    changeOwner: false,
};

function rejected(reason: Exclude<AresChronoPrisonDecisionReason, "eligible">): AresChronoPrisonRuntimeDecision {
    return { ...REJECTED, reason };
}

function rejectedAfterTemporalErase(
    reason: Exclude<AresChronoPrisonDecisionReason, "eligible">,
): AresChronoPrisonRuntimeDecision {
    return {
        ...REJECTED,
        reason,
        fallbackToConventionalDamage: false,
        fallbackToTemporalErase: true,
    };
}

function validFinite(value: number): boolean {
    return Number.isFinite(value);
}

/**
 * Pure Ares/Antares Chrono Prison decision adapter.
 *
 * It answers whether the abductor may consume a target and what the next
 * integration step should do. It does not remove, insert, damage, transfer,
 * or otherwise mutate any game object.
 */
export function decideAresChronoPrison(
    input: AresChronoPrisonRuntimeInput,
): AresChronoPrisonRuntimeDecision {
    const { weapon, target, attacker } = input;
    const phase = input.phase ?? "impact";

    if (!weapon.abductor) return rejected("not-abductor");
    if (!validFinite(weapon.abductBelowPercent) || weapon.abductBelowPercent < 0 || weapon.abductBelowPercent > 1
        || !validFinite(weapon.maxHealth) || weapon.maxHealth < 0
        || !Number.isSafeInteger(weapon.maxHealth)) {
        return rejected("invalid-weapon");
    }
    if (!validFinite(target.health) || !validFinite(target.healthPercent)
        || !validFinite(target.size) || target.health < 0 || target.healthPercent < 0 || target.healthPercent > 1
        || target.size < 0) {
        return rejected("invalid-target");
    }

    // Ares defers all abduction eligibility checks for Abductor.Temporal until
    // the target's temporal erase. A failed attempt then lets that erase happen
    // normally instead of falling back to conventional weapon damage.
    const temporalEraseAttempt = weapon.temporal && phase === "temporal-erasure";
    const rejectEligibility = (reason: Exclude<AresChronoPrisonDecisionReason, "eligible">) =>
        temporalEraseAttempt ? rejectedAfterTemporalErase(reason) : rejected(reason);

    if (weapon.temporal) {
        if (input.warheadIsTemporal !== true) return rejected("temporal-warhead-required");
        if (phase !== "temporal-erasure") {
            return {
                eligible: false,
                reason: "awaiting-temporal-erasure",
                fallbackToConventionalDamage: false,
                fallbackToTemporalErase: true,
                waitForTemporalErasure: true,
                changeOwner: false,
            };
        }
    }

    if (!target.passengerCapable) return rejectEligibility("invalid-target");
    if (target.immuneToAbduction || input.techno?.immuneToAbduction === true) {
        return rejectEligibility("immune-to-abduction");
    }
    if (target.warheadCanAffect === false) return rejectEligibility("warhead-cannot-affect");
    if (target.ironCurtained === true) return rejectEligibility("iron-curtained");

    // Antares uses <= semantics: a target exactly at the configured health
    // threshold is eligible; only a healthier target is rejected.
    if (target.healthPercent > weapon.abductBelowPercent) return rejectEligibility("health-threshold");
    if (weapon.maxHealth > 0 && target.health > weapon.maxHealth) return rejectEligibility("max-health");
    if (!validFinite(attacker.sizeLimit) || !validFinite(attacker.passengerCapacity)
        || !validFinite(attacker.occupiedPassengerCapacity)
        || attacker.sizeLimit < 0 || attacker.passengerCapacity < 0
        || attacker.occupiedPassengerCapacity < 0) {
        return rejectEligibility("passenger-capacity");
    }
    if (target.size > attacker.sizeLimit) return rejectEligibility("size-limit");
    if (target.size > attacker.passengerCapacity - attacker.occupiedPassengerCapacity) {
        return rejectEligibility("passenger-capacity");
    }

    return {
        eligible: true,
        reason: "eligible",
        fallbackToConventionalDamage: false,
        fallbackToTemporalErase: false,
        waitForTemporalErasure: false,
        changeOwner: weapon.changeOwner && target.psionicsImmune !== true,
    };
}
