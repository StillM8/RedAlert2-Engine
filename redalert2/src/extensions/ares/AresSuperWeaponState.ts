import type { SuperWeaponStatus } from "@/game/SuperWeapon";

/**
 * Versioned state owned by one Ares superweapon instance.
 *
 * Rules, owners, and effect objects stay outside this value.  A save/replay
 * host can associate the value with the authored superweapon name and restore
 * it without serializing live engine objects or invoking UI code.
 */
export const ARES_SUPER_WEAPON_STATE_VERSION = 1 as const;

export interface AresSuperWeaponExtensionState {
    readonly version: typeof ARES_SUPER_WEAPON_STATE_VERSION;
    readonly status: SuperWeaponStatus;
    readonly chargeTicks: number;
    readonly shotsFired: number;
    readonly chargeDrainRatio: number;
    readonly virtualChargeSinceTick?: number;
    readonly aresBatteryActive: boolean;
}

export interface AresSuperWeaponStateSource {
    readonly status: SuperWeaponStatus | number;
    readonly chargeTicks: number;
    readonly shotsFired: number;
    readonly chargeDrainRatio: number;
    readonly virtualChargeSinceTick?: number;
    readonly aresBatteryActive: boolean;
}

export interface AresSuperWeaponStateTarget {
    status: number;
    chargeTicks: number;
    shotsFired: number;
    chargeDrainRatio: number;
    virtualChargeSinceTick?: number;
    aresBatteryActive: boolean;
}

function nonNegativeInteger(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`Invalid Ares superweapon state: ${field} must be a non-negative integer`);
    }
    return value as number;
}

function statusValue(value: unknown): SuperWeaponStatus {
    const normalized = nonNegativeInteger(value, "status");
    if (normalized > 3) {
        throw new Error(`Invalid Ares superweapon state: unsupported status ${normalized}`);
    }
    return normalized as SuperWeaponStatus;
}

function positiveNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid Ares superweapon state: ${field} must be positive`);
    }
    return value;
}

function optionalTick(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    return nonNegativeInteger(value, "virtualChargeSinceTick");
}

/** Creates a deterministic JSON-safe Ares superweapon snapshot. */
export function serializeAresSuperWeaponExtensionState(
    source: AresSuperWeaponStateSource,
): AresSuperWeaponExtensionState {
    const virtualChargeSinceTick = optionalTick(source.virtualChargeSinceTick);
    return {
        version: ARES_SUPER_WEAPON_STATE_VERSION,
        status: statusValue(source.status),
        chargeTicks: nonNegativeInteger(source.chargeTicks, "chargeTicks"),
        shotsFired: nonNegativeInteger(source.shotsFired, "shotsFired"),
        chargeDrainRatio: positiveNumber(source.chargeDrainRatio, "chargeDrainRatio"),
        ...(virtualChargeSinceTick === undefined ? {} : { virtualChargeSinceTick }),
        aresBatteryActive: source.aresBatteryActive === true,
    };
}

function assertStateObject(state: unknown): asserts state is {
    version: unknown;
    status: unknown;
    chargeTicks: unknown;
    shotsFired: unknown;
    chargeDrainRatio: unknown;
    virtualChargeSinceTick?: unknown;
    aresBatteryActive: unknown;
} {
    if (typeof state !== "object" || state === null) {
        throw new Error("Invalid Ares superweapon state: expected an object");
    }
}

/**
 * Restores a validated snapshot atomically.  The target is not changed when
 * validation fails, which is important when a malformed multiplayer/save
 * payload is rejected by the host.
 */
export function restoreAresSuperWeaponExtensionState(
    target: AresSuperWeaponStateTarget,
    state: unknown,
): void {
    assertStateObject(state);
    if (state.version !== ARES_SUPER_WEAPON_STATE_VERSION) {
        throw new Error(`Unsupported Ares superweapon state version: ${String(state.version)}`);
    }
    if (typeof state.aresBatteryActive !== "boolean") {
        throw new Error("Invalid Ares superweapon state: aresBatteryActive must be boolean");
    }
    const normalized = serializeAresSuperWeaponExtensionState({
        status: statusValue(state.status),
        chargeTicks: nonNegativeInteger(state.chargeTicks, "chargeTicks"),
        shotsFired: nonNegativeInteger(state.shotsFired, "shotsFired"),
        chargeDrainRatio: positiveNumber(state.chargeDrainRatio, "chargeDrainRatio"),
        virtualChargeSinceTick: optionalTick(state.virtualChargeSinceTick),
        aresBatteryActive: state.aresBatteryActive,
    });
    target.status = normalized.status;
    target.chargeTicks = normalized.chargeTicks;
    target.shotsFired = normalized.shotsFired;
    target.chargeDrainRatio = normalized.chargeDrainRatio;
    target.virtualChargeSinceTick = normalized.virtualChargeSinceTick;
    target.aresBatteryActive = normalized.aresBatteryActive;
}
