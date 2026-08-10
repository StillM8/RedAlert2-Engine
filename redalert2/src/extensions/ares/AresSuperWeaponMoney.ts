/**
 * Ares' launch-time superweapon transaction.
 *
 * Antares checks CanTransactMoney before launching and applies Money.Amount
 * only after the type-specific activation succeeds.  The standalone engine
 * has no HouseClass transaction API, so this small pure service owns the
 * equivalent non-negative-credit rule and leaves effect dispatch to the
 * superweapon trait.
 */
export interface AresMoneyOwner {
    credits: number;
}

/** Ares stores Money.Amount as an integer. Invalid/omitted values are zero. */
export function normalizeAresSuperWeaponMoney(value: number | undefined): number {
    return Number.isFinite(value) ? Math.trunc(value as number) : 0;
}

/**
 * Negative values are charges and require enough credits. Positive values
 * are grants and can always be applied to a valid non-negative balance.
 */
export function canAresSuperWeaponTransactMoney(
    credits: number,
    amount: number | undefined,
): boolean {
    const normalizedCredits = Number.isFinite(credits) ? credits : 0;
    const normalizedAmount = normalizeAresSuperWeaponMoney(amount);
    if (normalizedCredits < 0) return false;
    return normalizedAmount >= 0 || normalizedCredits >= -normalizedAmount;
}

/** Apply Money.Amount after the launch has passed validation. */
export function applyAresSuperWeaponMoney(
    owner: AresMoneyOwner,
    amount: number | undefined,
): boolean {
    const normalizedAmount = normalizeAresSuperWeaponMoney(amount);
    if (!canAresSuperWeaponTransactMoney(owner.credits, normalizedAmount)) return false;

    const nextCredits = owner.credits + normalizedAmount;
    if (!Number.isFinite(nextCredits) || nextCredits < 0) return false;
    owner.credits = nextCredits;
    return true;
}
