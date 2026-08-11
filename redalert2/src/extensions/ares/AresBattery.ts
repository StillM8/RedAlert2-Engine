/**
 * Standalone implementation of Antares' Ares 3.0p1 Battery superweapon
 * state. Antares stores the active battery contribution on the owning house
 * and applies its KeepOnline/Overpower lists to buildings while the charge
 * drain is active. The TypeScript runtime keeps the same semantic state on
 * the owner's PowerTrait instead of introducing a Windows-house extension.
 */

export interface AresBatteryDefinitionLike {
    extensionType?: string;
    batteryPower?: number;
    batteryKeepOnline?: readonly string[];
    batteryOverpower?: readonly string[];
}

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

export function isAresBatteryDefinition(value: AresBatteryDefinitionLike | undefined): boolean {
    return value?.extensionType?.toLocaleLowerCase("en-US") === "battery";
}

/**
 * Applies/removes one Battery handler's house-side effects. The guard on the
 * SuperWeapon instance mirrors Antares' one Activate/one Deactivate pair and
 * prevents repeated UI/network callbacks from stacking power more than once.
 */
export function setAresBatteryActiveForWeapon(
    weapon: any,
    active: boolean,
    world?: any,
): boolean {
    if (!isAresBatteryDefinition(weapon?.rules?.ares)) return false;

    if (active) {
        if (weapon.aresBatteryActive === true) return false;
        weapon.aresBatteryActive = true;
        weapon.owner?.powerTrait?.activateAresBattery?.(weapon.rules.ares, world);
        return true;
    }

    if (weapon.aresBatteryActive !== true) return false;
    weapon.aresBatteryActive = false;
    weapon.owner?.powerTrait?.deactivateAresBattery?.(weapon.rules.ares, world);
    return true;
}

/** Case-insensitive building-type matching used by Battery.KeepOnline/Overpower. */
export function aresBatteryMatchesBuildingType(
    building: any,
    typeNames: Iterable<string> | undefined,
): boolean {
    const name = building?.rules?.name ?? building?.name;
    if (typeof name !== "string" || !typeNames) return false;
    const expected = normalize(name);
    for (const typeName of typeNames) {
        if (typeof typeName === "string" && normalize(typeName) === expected) return true;
    }
    return false;
}
