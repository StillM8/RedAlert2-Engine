/**
 * Pure combat-consumer decisions for Ares AttachEffect modifiers.
 *
 * The aggregate input has the same shape returned by
 * AresAttachEffectTrait.getAggregateMultipliers(). This adapter deliberately
 * does not mutate a GameObject, weapon, reload timer, or movement service.
 */

export interface AresAttachEffectCombatValues {
    speed: number;
    armor: number;
    firepower: number;
    rof: number;
}

export type AresAttachEffectCombatField = keyof AresAttachEffectCombatValues;

/** Partial so callers can omit an aggregate and receive neutral 1.0 values. */
export type AresAttachEffectAggregateInput = Partial<Readonly<AresAttachEffectCombatValues>>;

export interface AresAttachEffectCombatDecision {
    /** Sanitized base values copied from the caller. */
    base: AresAttachEffectCombatValues;
    /** Active AttachEffect products, defaulting to 1.0 per field. */
    multipliers: AresAttachEffectCombatValues;
    /** Effective values after applying the aggregate products. */
    effective: AresAttachEffectCombatValues;
    /** Fields whose aggregate multiplier is not neutral. */
    changedFields: readonly AresAttachEffectCombatField[];
    isNeutral: boolean;
}

/**
 * Resolve the deterministic combat values for the currently active effects.
 *
 * Ares applies the SpeedMultiplier, ArmorMultiplier, FirepowerMultiplier, and
 * ROFMultiplier values multiplicatively. ROF is returned as a decision only;
 * the caller owns the documented reload-timer timing behavior.
 */
export function resolveAresAttachEffectCombat(
    base: Partial<Readonly<AresAttachEffectCombatValues>> = {},
    aggregate: AresAttachEffectAggregateInput = {},
): AresAttachEffectCombatDecision {
    const normalizedBase = normalizeValues(base, 1);
    const multipliers = normalizeValues(aggregate, 1);
    const effective = {
        speed: multiplySafely(normalizedBase.speed, multipliers.speed),
        armor: multiplySafely(normalizedBase.armor, multipliers.armor),
        firepower: multiplySafely(normalizedBase.firepower, multipliers.firepower),
        rof: multiplySafely(normalizedBase.rof, multipliers.rof),
    };
    const changedFields = (Object.keys(multipliers) as AresAttachEffectCombatField[])
        .filter(field => multipliers[field] !== 1);

    return {
        base: normalizedBase,
        multipliers,
        effective,
        changedFields,
        isNeutral: changedFields.length === 0,
    };
}

function normalizeValues(
    values: Partial<Readonly<AresAttachEffectCombatValues>>,
    fallback: number,
): AresAttachEffectCombatValues {
    return {
        speed: finiteOr(values.speed, fallback),
        armor: finiteOr(values.armor, fallback),
        firepower: finiteOr(values.firepower, fallback),
        rof: finiteOr(values.rof, fallback),
    };
}

function finiteOr(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function multiplySafely(base: number, multiplier: number): number {
    const result = base * multiplier;
    return Number.isFinite(result) ? result : base;
}
