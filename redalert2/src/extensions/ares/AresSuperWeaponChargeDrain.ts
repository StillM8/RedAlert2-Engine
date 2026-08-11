/**
 * Pure Ares charge-drain timing helpers.
 *
 * Antares keeps the active drain timer in the same recharge timer used by a
 * normal superweapon. Starting a charge-drain weapon converts the available
 * charge into active time (`recharge * ratio`); stopping it converts the
 * remaining active time back into the charge still required to recharge.
 */

export type AresChargeDrainState = "charging" | "ready" | "draining";

export interface AresChargeDrainTransition {
    state: AresChargeDrainState;
    timerTicks: number;
}

export function normalizeAresChargeToDrainRatio(value: number | undefined, fallback = 1): number {
    const normalized = Number.isFinite(value) ? Number(value) : fallback;
    return normalized > 0 ? normalized : fallback > 0 ? fallback : 1;
}

export function getAresChargeDrainDuration(rechargeTicks: number, ratio: number): number {
    const duration = Math.trunc(Math.max(0, rechargeTicks) * normalizeAresChargeToDrainRatio(ratio));
    // Ares documents a non-zero ratio. Keep malformed/very small values from
    // creating a zero-tick active state that disappears before effects see it.
    return Math.max(1, duration);
}

export function startAresChargeDrain(rechargeTicks: number, ratio: number): AresChargeDrainTransition {
    return {
        state: "draining",
        timerTicks: getAresChargeDrainDuration(rechargeTicks, ratio),
    };
}

export function stopAresChargeDrain(
    rechargeTicks: number,
    remainingDrainTicks: number,
    ratio: number,
): AresChargeDrainTransition {
    const normalizedRecharge = Math.max(0, Math.trunc(rechargeTicks));
    const normalizedRatio = normalizeAresChargeToDrainRatio(ratio);
    const remaining = Math.max(0, remainingDrainTicks);
    const chargeTicks = Math.max(0, Math.min(
        normalizedRecharge,
        Math.trunc(normalizedRecharge - remaining / normalizedRatio),
    ));
    return {
        state: chargeTicks > 0 ? "charging" : "ready",
        timerTicks: chargeTicks,
    };
}

export function isAresChargeDrainMoneyDue(
    remainingDrainTicks: number,
    drainDelay: number | undefined,
): boolean {
    const delay = Number.isFinite(drainDelay) ? Math.trunc(drainDelay as number) : 0;
    return remainingDrainTicks > 0 && delay > 0 && remainingDrainTicks % delay === 0;
}
