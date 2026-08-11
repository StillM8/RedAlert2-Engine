/**
 * Normalized Ares Chrono Prison / Abductor data.
 *
 * This adapter is intentionally separate from WeaponRules and TechnoRules:
 * those classes do not yet model the abduction effect or passenger-turret
 * presentation. It is therefore safe to parse the data now without making
 * ordinary RA2/YR rules behave as if the effect were implemented.
 */

export interface AresChronoPrisonSection {
    entries: Map<string, string | string[]>;
}

export interface AresChronoPrisonWeaponRules {
    /** Weapon.Abductor; defaults to no. */
    abductor: boolean;
    /** Weapon.Abductor.Temporal; defaults to no. */
    temporal: boolean;
    /** Weapon.Abductor.Anim; absent means no animation. */
    animation?: string;
    /** Weapon.Abductor.ChangeOwner; defaults to no. */
    changeOwner: boolean;
    /** Weapon.Abductor.AbductBelowPercent, normalized to 0..1; defaults to 1. */
    abductBelowPercent: number;
    /** Weapon.Abductor.MaxHealth; 0 disables the health ceiling. */
    maxHealth: number;
}

export interface AresChronoPrisonTechnoRules {
    /** TechnoType.PassengerTurret; defaults to no. */
    passengerTurret: boolean;
    /** TechnoType.ImmuneToAbduction; defaults to no. */
    immuneToAbduction: boolean;
}

const DEFAULT_WEAPON_RULES: AresChronoPrisonWeaponRules = {
    abductor: false,
    temporal: false,
    changeOwner: false,
    abductBelowPercent: 1,
    maxHealth: 0,
};

const DEFAULT_TECHNO_RULES: AresChronoPrisonTechnoRules = {
    passengerTurret: false,
    immuneToAbduction: false,
};

function normalizeKey(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function getEntry(section: AresChronoPrisonSection, key: string): string | string[] | undefined {
    const expected = normalizeKey(key);
    for (const [actualKey, value] of section.entries) {
        if (normalizeKey(actualKey) === expected) return value;
    }
    return undefined;
}

function getScalar(section: AresChronoPrisonSection, key: string): string | undefined {
    const value = getEntry(section, key);
    if (Array.isArray(value)) return value.length === 1 ? value[0]?.trim() || undefined : undefined;
    return value?.trim() || undefined;
}

function parseBoolean(section: AresChronoPrisonSection, key: string, defaultValue: boolean): boolean {
    const value = getScalar(section, key)?.toLocaleLowerCase("en-US");
    if (value === undefined) return defaultValue;
    if (["yes", "true", "1", "on"].includes(value)) return true;
    if (["no", "false", "0", "off"].includes(value)) return false;
    return defaultValue;
}

function parseAnimation(section: AresChronoPrisonSection): string | undefined {
    const value = getScalar(section, "Abductor.Anim");
    return value && value.length > 0 ? value : undefined;
}

/**
 * Parse an Ares percentage without allowing an out-of-range value to become
 * an unsafe runtime rule. A suffixed value such as 75% is converted to 0.75;
 * an unsuffixed value must already be a fraction in the inclusive 0..1 range.
 */
function parseFraction(
    section: AresChronoPrisonSection,
    key: string,
    defaultValue: number,
): number {
    const raw = getScalar(section, key);
    if (raw === undefined) return defaultValue;

    const hasPercentSuffix = raw.endsWith("%");
    const numericText = hasPercentSuffix ? raw.slice(0, -1).trim() : raw;
    const value = Number(numericText);
    const normalized = hasPercentSuffix ? value / 100 : value;
    return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1
        ? normalized
        : defaultValue;
}

function parseNonNegativeInteger(
    section: AresChronoPrisonSection,
    key: string,
    defaultValue: number,
): number {
    const raw = getScalar(section, key);
    if (raw === undefined || !/^[+]?\d+$/.test(raw)) return defaultValue;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : defaultValue;
}

/**
 * Parse the documented [Weapon] Abductor settings. No abduction effect is
 * performed here; this returns data for a future effect/runtime integration.
 */
export function parseAresChronoPrisonWeapon(
    section: AresChronoPrisonSection,
): AresChronoPrisonWeaponRules {
    return {
        abductor: parseBoolean(section, "Abductor", DEFAULT_WEAPON_RULES.abductor),
        temporal: parseBoolean(section, "Abductor.Temporal", DEFAULT_WEAPON_RULES.temporal),
        animation: parseAnimation(section),
        changeOwner: parseBoolean(section, "Abductor.ChangeOwner", DEFAULT_WEAPON_RULES.changeOwner),
        abductBelowPercent: parseFraction(
            section,
            "Abductor.AbductBelowPercent",
            DEFAULT_WEAPON_RULES.abductBelowPercent,
        ),
        maxHealth: parseNonNegativeInteger(section, "Abductor.MaxHealth", DEFAULT_WEAPON_RULES.maxHealth),
    };
}

/**
 * Parse the documented [TechnoType] settings which participate in the
 * Chrono Prison data contract. Both flags default to no.
 */
export function parseAresChronoPrisonTechno(
    section: AresChronoPrisonSection,
): AresChronoPrisonTechnoRules {
    return {
        passengerTurret: parseBoolean(section, "PassengerTurret", DEFAULT_TECHNO_RULES.passengerTurret),
        immuneToAbduction: parseBoolean(section, "ImmuneToAbduction", DEFAULT_TECHNO_RULES.immuneToAbduction),
    };
}
