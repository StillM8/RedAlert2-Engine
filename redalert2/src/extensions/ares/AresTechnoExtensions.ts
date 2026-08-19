/**
 * Data-only Ares TechnoType extensions used by shared runtime paths.
 *
 * This module deliberately stops at normalized rules data. It does not decide
 * which passenger is active, resolve a provider against a house, or perform
 * player input/runtime actions itself.
 */

export type AresIniValue = string | string[];

export interface AresTechnoSectionLike {
    entries: ReadonlyMap<string, AresIniValue>;
}

export interface AresIfvModeRules {
    /** Passenger-selected IFV mode. Vanilla's 0-based default is explicit. */
    ifvMode: number;
    /** Entries are keyed by the 1-based WeaponX number. */
    weaponTurretIndexes: Map<number, number>;
    /** Optional CSF labels keyed by the 1-based WeaponX number. */
    weaponUiNames: Map<number, string>;
    /** Explicit per-IFV repair voice; undefined means use the caller's fallback chain. */
    voiceIfvRepair?: string;
}

export interface AresPoweredByRules {
    /** BuildingType IDs, retaining authored casing after whitespace normalization. */
    providers: string[];
    /** Ares defines comma-separated PoweredBy entries as alternatives, never AND. */
    relation: "any";
}

export interface AresManualControlRules {
    /** Prevents player-selected direct attack/force-fire cursor actions only. */
    noManualFire: boolean;
    /** Parsed for the dedicated self-GuardArea cursor path; runtime support is separate. */
    noSelfGuardArea: boolean;
}

export interface AresTechnoExtensions {
    /** Per-Techno Ares parachute animation override. */
    parachuteAnim?: string;
    ifv: AresIfvModeRules;
    poweredBy: AresPoweredByRules;
    manualControl: AresManualControlRules;
}

export const DEFAULT_ARES_IFV_MODE = 0;
export const DEFAULT_ARES_WEAPON_TURRET_INDEX = -1;

function keyName(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function firstScalar(value: AresIniValue | undefined): string | undefined {
    const scalar = Array.isArray(value) ? value[0] : value;
    if (typeof scalar !== "string") return undefined;
    const result = scalar.trim();
    return result || undefined;
}

function findEntry(section: AresTechnoSectionLike, expectedKey: string): AresIniValue | undefined {
    const expected = keyName(expectedKey);
    let result: AresIniValue | undefined;
    for (const [key, value] of section.entries) {
        if (keyName(key) === expected) result = value;
    }
    return result;
}

function parseInteger(value: string | undefined, defaultValue: number): number {
    if (value === undefined || !/^[+-]?\d+$/.test(value)) return defaultValue;
    const result = Number(value);
    return Number.isSafeInteger(result) ? result : defaultValue;
}

function parseBool(value: string | undefined, defaultValue = false): boolean {
    if (value === undefined) return defaultValue;
    const normalized = value.trim().toLocaleLowerCase("en-US");
    if (["yes", "true", "1", "on"].includes(normalized)) return true;
    if (["no", "false", "0", "off"].includes(normalized)) return false;
    return defaultValue;
}

function parseTurretIndex(value: string | undefined): number {
    const parsed = parseInteger(value, DEFAULT_ARES_WEAPON_TURRET_INDEX);
    return parsed < 0 ? DEFAULT_ARES_WEAPON_TURRET_INDEX : parsed;
}

function parseIndexedEntries(
    section: AresTechnoSectionLike,
    pattern: RegExp,
): Map<number, AresIniValue> {
    const result = new Map<number, AresIniValue>();
    for (const [key, value] of section.entries) {
        const match = key.trim().match(pattern);
        if (!match) continue;
        const index = Number(match[1]);
        if (!Number.isSafeInteger(index) || index < 1) continue;
        // Later entries win, matching the normal INI override direction while
        // retaining deterministic behavior for case-variant duplicate keys.
        result.set(index, value);
    }
    return result;
}

function parseCommaList(value: AresIniValue | undefined): string[] {
    if (value === undefined) return [];
    const values = (Array.isArray(value) ? value : [value])
        .flatMap(item => item.split(","))
        .map(item => item.trim())
        .filter(Boolean);
    // Ares stores a vector and does not make case-folded IDs part of the data
    // contract. Preserve authored order, spelling, and even duplicates; the
    // OR membership check gives duplicates no additional runtime meaning.
    return values;
}

export function getAresWeaponTurretIndex(
    rules: AresIfvModeRules,
    weaponNumber: number,
): number {
    return rules.weaponTurretIndexes.get(weaponNumber) ?? DEFAULT_ARES_WEAPON_TURRET_INDEX;
}

export function parseAresIfvModeRules(section: AresTechnoSectionLike): AresIfvModeRules {
    const weaponTurretIndexes = new Map<number, number>();
    for (const [index, value] of parseIndexedEntries(section, /^WeaponTurretIndex(\d+)$/i)) {
        weaponTurretIndexes.set(index, parseTurretIndex(firstScalar(value)));
    }

    const weaponUiNames = new Map<number, string>();
    for (const [index, value] of parseIndexedEntries(section, /^WeaponUIName(\d+)$/i)) {
        const label = firstScalar(value);
        if (label !== undefined) weaponUiNames.set(index, label);
    }

    const voiceIfvRepair = firstScalar(findEntry(section, "VoiceIFVRepair"));
    return {
        ifvMode: parseInteger(firstScalar(findEntry(section, "IFVMode")), DEFAULT_ARES_IFV_MODE),
        weaponTurretIndexes,
        weaponUiNames,
        ...(voiceIfvRepair === undefined ? {} : { voiceIfvRepair }),
    };
}

export function parseAresPoweredByRules(section: AresTechnoSectionLike): AresPoweredByRules {
    return {
        providers: parseCommaList(findEntry(section, "PoweredBy")),
        relation: "any",
    };
}

export function parseAresManualControlRules(section: AresTechnoSectionLike): AresManualControlRules {
    return {
        noManualFire: parseBool(firstScalar(findEntry(section, "NoManualFire"))),
        noSelfGuardArea: parseBool(firstScalar(findEntry(section, "NoSelfGuardArea"))),
    };
}

export function resolveAresParachuteAnim(
    rules: Pick<AresTechnoExtensions, 'parachuteAnim'> | undefined,
    fallback: string,
    countryAnim?: string,
    sideAnim?: string,
): string {
    return rules?.parachuteAnim?.trim() ||
        countryAnim?.trim() ||
        sideAnim?.trim() ||
        fallback;
}

export function parseAresTechnoExtensions(section: AresTechnoSectionLike): AresTechnoExtensions {
    const parachuteAnim = firstScalar(findEntry(section, 'Parachute.Anim'));
    return {
        ...(parachuteAnim === undefined ? {} : { parachuteAnim }),
        ifv: parseAresIfvModeRules(section),
        poweredBy: parseAresPoweredByRules(section),
        manualControl: parseAresManualControlRules(section),
    };
}
