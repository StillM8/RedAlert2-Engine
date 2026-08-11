import {
    decideAresChronoPrison,
    type AresChronoPrisonAttackerSnapshot,
    type AresChronoPrisonRuntimeDecision,
    type AresChronoPrisonRuntimeInput,
    type AresChronoPrisonTargetSnapshot,
} from "@/extensions/ares/AresChronoPrisonRuntime";
import type {
    AresChronoPrisonTechnoRules,
    AresChronoPrisonWeaponRules,
} from "@/extensions/ares/AresChronoPrisons";

/**
 * Read-only facts an integration hook may collect from a target object.
 * `maxHealth` is used only to construct the normalized health percentage;
 * the bridge does not retain or mutate the supplied object.
 */
export interface AresChronoPrisonTargetFacts {
    readonly passengerCapable: boolean;
    readonly health: number;
    readonly maxHealth: number;
    readonly size: number;
    readonly immuneToAbduction: boolean;
    readonly psionicsImmune?: boolean;
    readonly ironCurtained?: boolean;
    readonly warheadCanAffect?: boolean;
}

/** Read-only passenger-hold facts collected by an integration hook. */
export interface AresChronoPrisonAttackerFacts {
    readonly sizeLimit: number;
    readonly passengerCapacity: number;
    readonly occupiedPassengerCapacity: number;
}

export interface AresChronoPrisonBridgeInput {
    readonly weapon: AresChronoPrisonWeaponRules;
    readonly target: AresChronoPrisonTargetFacts;
    readonly attacker: AresChronoPrisonAttackerFacts;
    readonly techno?: Readonly<Pick<AresChronoPrisonTechnoRules, "immuneToAbduction">>;
    readonly warheadIsTemporal?: boolean;
    readonly phase?: AresChronoPrisonRuntimeInput["phase"];
}

function getHealthPercent(health: number, maxHealth: number): number {
    return Number.isFinite(health) && Number.isFinite(maxHealth) && maxHealth > 0
        ? health / maxHealth
        : Number.NaN;
}

/** Creates a detached, structural target snapshot for the decision adapter. */
export function buildAresChronoPrisonTargetSnapshot(
    facts: AresChronoPrisonTargetFacts,
): AresChronoPrisonTargetSnapshot {
    return {
        passengerCapable: facts.passengerCapable,
        health: facts.health,
        healthPercent: getHealthPercent(facts.health, facts.maxHealth),
        size: facts.size,
        immuneToAbduction: facts.immuneToAbduction,
        psionicsImmune: facts.psionicsImmune,
        ironCurtained: facts.ironCurtained,
        warheadCanAffect: facts.warheadCanAffect,
    };
}

/** Creates a detached, structural attacker snapshot for the decision adapter. */
export function buildAresChronoPrisonAttackerSnapshot(
    facts: AresChronoPrisonAttackerFacts,
): AresChronoPrisonAttackerSnapshot {
    return {
        sizeLimit: facts.sizeLimit,
        passengerCapacity: facts.passengerCapacity,
        occupiedPassengerCapacity: facts.occupiedPassengerCapacity,
    };
}

/**
 * Bridges caller-supplied object facts into the pure Chrono Prison decision.
 * The result contains only intent and fallback flags; no source object is
 * changed, captured, or passed into the decision adapter.
 */
export function decideAresChronoPrisonFromFacts(
    input: AresChronoPrisonBridgeInput,
): AresChronoPrisonRuntimeDecision {
    return decideAresChronoPrison({
        weapon: input.weapon,
        target: buildAresChronoPrisonTargetSnapshot(input.target),
        attacker: buildAresChronoPrisonAttackerSnapshot(input.attacker),
        techno: input.techno === undefined
            ? undefined
            : { immuneToAbduction: input.techno.immuneToAbduction },
        warheadIsTemporal: input.warheadIsTemporal,
        phase: input.phase,
    });
}
