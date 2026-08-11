/**
 * Pure Ares EMP rule helpers.
 *
 * Ares stores EMP as a per-Techno frame counter.  Keeping the counter math
 * outside of the object trait makes the documented cap/stacking semantics
 * testable without constructing a full map.
 */

import { ObjectType } from "@/engine/type/ObjectType";

export interface AresEmpImmunityInputs {
    type: ObjectType;
    powered: boolean;
    power: number;
    radar: boolean;
    spySat: boolean;
    hasSuperWeapon: boolean;
    undeploysInto: boolean;
    powersUnit: boolean;
    gapGenerator: boolean;
    sensors: boolean;
    sensorArray: boolean;
    laserFencePost: boolean;
    cyborg: boolean;
    organic: boolean;
}

/** Ares TypeImmune only protects a same-owner techno that can fire EMP. */
export function isAresEmpTypeImmune(target: any, sourceOwner: any): boolean {
    if (!target?.rules?.typeImmune || !sourceOwner || target.owner !== sourceOwner) {
        return false;
    }
    const weapons = target.armedTrait?.getWeapons?.() ?? [
        target.primaryWeapon,
        target.secondaryWeapon,
    ];
    return weapons.some((weapon: any) => (weapon?.warhead?.rules?.empDuration ?? 0) !== 0);
}

/** Implements Ares' documented default ImmuneToEMP decision. */
export function defaultAresEmpImmunity(input: AresEmpImmunityInputs): boolean {
    if (input.type === ObjectType.Building) {
        const consumesPower = input.powered && input.power < 0;
        const hasEmpSensitiveFunction = consumesPower ||
            input.radar ||
            input.spySat ||
            input.hasSuperWeapon ||
            input.undeploysInto ||
            input.powersUnit ||
            input.gapGenerator ||
            input.sensors ||
            input.sensorArray ||
            input.laserFencePost;
        return !hasEmpSensitiveFunction;
    }
    if (input.type === ObjectType.Infantry) {
        return !input.cyborg;
    }
    return input.organic;
}

/**
 * Parses [TechnoType]EMP.Threshold.
 *
 * Ares uses the negative in-air sentinel by default.  The runtime destruction
 * check is intentionally separate from this parser; the value must survive
 * rule loading even while that later capability is being integrated.
 */
export function parseAresEmpThreshold(raw: string | undefined): number {
    const value = raw?.trim().toLocaleLowerCase("en-US");
    if (!value) {
        return -1;
    }
    if (value === "yes") {
        return 1;
    }
    if (value === "no") {
        return 0;
    }
    if (value === "inair") {
        return -1;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : -1;
}

/** Returns whether the current EMP counter crosses a Techno threshold. */
export function aresEmpThresholdExceeded(
    threshold: number,
    remainingFrames: number,
    isInAir: boolean,
    isParachuting = false,
): boolean {
    const normalizedThreshold = Math.trunc(threshold);
    const remaining = Math.max(0, Math.trunc(remainingFrames));
    if (normalizedThreshold === 0 || remaining <= Math.abs(normalizedThreshold)) {
        return false;
    }
    return normalizedThreshold > 0 || (isInAir && !isParachuting);
}

/**
 * A Techno whose EMP counter or warp-out state is active cannot perform
 * factory/spawner/superweapon manager work.  Keep this predicate shared so
 * each manager applies the same operational boundary.
 */
export function isAresEmpOperational(techno: any): boolean {
    return !techno?.empTrait?.isUnderEMP?.() &&
        !techno?.warpedOutTrait?.isActive?.();
}

/**
 * Applies Ares' EMP.Duration/EMP.Cap counter rules.
 *
 * EMP.Modifier only affects positive durations.  Negative durations are the
 * documented removal/clearing form and are not scaled by the target's
 * modifier.
 */
export function resolveAresEmpCounter(
    currentFrames: number,
    durationFrames: number,
    capFrames: number,
    modifier = 1,
): number {
    const current = Math.max(0, Math.trunc(currentFrames));
    const duration = Math.trunc(durationFrames);
    const cap = Math.trunc(capFrames);

    if (duration > 0) {
        const effectiveDuration = Math.max(0, Math.trunc(duration * modifier));
        if (cap > 0) {
            // A counter already above the cap is not reduced by a capped EMP.
            return current > cap
                ? current
                : Math.min(current + effectiveDuration, cap);
        }
        if (cap === 0) {
            return current + effectiveDuration;
        }
        // Negative caps use Ares' legacy "set unless already longer" form.
        return Math.max(current, effectiveDuration);
    }

    if (duration < 0) {
        if (cap === 0) {
            return 0;
        }
        const reduced = Math.max(0, current + duration);
        return cap > 0 ? Math.min(reduced, cap) : reduced;
    }

    return current;
}
