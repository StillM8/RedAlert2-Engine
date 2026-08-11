import type { IniSection } from "@/data/IniSection";

/** The owner selectors accepted by Ares' advanced-rubble settings. */
export type AresRubbleOwner = "default" | "civilian" | "special" | "neutral";

/**
 * A normalized advanced-rubble transition.
 *
 * A destroyed strength of `0` is Ares' full-strength sentinel (the documented
 * default); an intact strength of `-1` means 1% of the recovered type's
 * Strength. A later runtime consumer can resolve those values using the
 * target type's actual Strength.
 */
export interface AresRubbleTransition {
    target?: string;
    remove: boolean;
    owner: AresRubbleOwner;
    strength: number;
    animation?: string;
}

export interface AresUrbanCombatBuildingRules {
    /** Fraction in [0, 1]. Defaults to 0. */
    passThrough: number;
    /** Fraction in [0, 1] of passed-through attacks that kill an occupant. */
    fatalRate: number;
    /** Non-negative weapon damage multiplier. Defaults to 1. */
    damageMultiplier: number;
    /** Defaults to false. */
    bunkerRaidable: boolean;
    /** Empty when no trench type ID is declared. */
    isTrench?: string;
    /** Case-preserving, trimmed InfantryType names; defaults to []. */
    canBeOccupiedBy: string[];
    rubbleDestroyed?: AresRubbleTransition;
    rubbleIntact?: AresRubbleTransition;
}

export interface AresUrbanCombatProjectileRules {
    /** Defaults to true, matching Ares' SubjectToTrenches default. */
    subjectToTrenches: boolean;
}

type IniValue = string | string[] | undefined;

function normalizedKey(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function firstValue(value: IniValue): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

/** Read keys case-insensitively because INI key spelling is not significant. */
function getValue(section: IniSection, key: string): IniValue {
    const wanted = normalizedKey(key);
    for (const [entryKey, value] of section.entries) {
        if (normalizedKey(entryKey) === wanted) return value;
    }
    return undefined;
}

function hasValue(section: IniSection, key: string): boolean {
    return getValue(section, key) !== undefined;
}

function parseBoolean(value: IniValue, defaultValue: boolean): boolean {
    const text = firstValue(value)?.trim().toLocaleLowerCase("en-US");
    if (!text) return defaultValue;
    if (["yes", "true", "1", "on"].includes(text)) return true;
    if (["no", "false", "0", "off"].includes(text)) return false;
    return defaultValue;
}

/**
 * Parses Ares' numeric syntax. A trailing percent is converted to a fraction;
 * plain values are retained as numeric fractions/multipliers.
 */
function parseNumber(value: IniValue, defaultValue: number): number {
    const text = firstValue(value)?.trim();
    if (!text) return defaultValue;
    const isPercent = text.endsWith("%");
    const number = Number(isPercent ? text.slice(0, -1).trim() : text);
    if (!Number.isFinite(number)) return defaultValue;
    return isPercent ? number / 100 : number;
}

function parseChance(value: IniValue, defaultValue: number): number {
    const parsed = parseNumber(value, defaultValue);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : defaultValue;
}

function parseDamageMultiplier(value: IniValue): number {
    const parsed = parseNumber(value, 1);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

function parseInteger(value: IniValue, defaultValue: number | undefined): number | undefined {
    const parsed = parseNumber(value, Number.NaN);
    return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : defaultValue;
}

function parseString(value: IniValue): string | undefined {
    const text = firstValue(value)?.trim();
    return text ? text : undefined;
}

/**
 * Parses a comma-separated Ares list, also accepting repeated `key[]` values
 * produced by the INI loader. Empty members are ignored and duplicates are
 * removed case-insensitively while preserving the first spelling.
 */
function parseStringList(value: IniValue): string[] {
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    const result: string[] = [];
    const seen = new Set<string>();
    for (const item of values) {
        for (const part of item.split(",")) {
            const trimmed = part.trim();
            const identity = normalizedKey(trimmed);
            if (!identity || seen.has(identity)) continue;
            seen.add(identity);
            result.push(trimmed);
        }
    }
    return result;
}

function parseOwner(value: IniValue): AresRubbleOwner {
    const text = firstValue(value)?.trim().toLocaleLowerCase("en-US");
    return text === "civilian" || text === "special" || text === "neutral" || text === "default"
        ? text
        : "default";
}

function hasRubbleValues(section: IniSection, prefix: string): boolean {
    const wanted = normalizedKey(`${prefix}.`);
    for (const key of section.entries.keys()) {
        if (normalizedKey(key).startsWith(wanted)) return true;
    }
    return hasValue(section, prefix);
}

function parseRubbleTransition(
    section: IniSection,
    prefix: "Rubble.Destroyed" | "Rubble.Intact",
): AresRubbleTransition | undefined {
    if (!hasRubbleValues(section, prefix)) return undefined;

    const strengthDefault = prefix === "Rubble.Intact" ? -1 : 0;
    const rawStrength = getValue(section, `${prefix}.Strength`);
    const parsedStrength = rawStrength === undefined
        ? strengthDefault
        : parseInteger(rawStrength, strengthDefault);

    return {
        target: parseString(getValue(section, prefix)),
        remove: parseBoolean(getValue(section, `${prefix}.Remove`), false),
        owner: parseOwner(getValue(section, `${prefix}.Owner`)),
        strength: parsedStrength,
        animation: parseString(getValue(section, `${prefix}.Anim`)),
    };
}

/** Parse Urban Combat and advanced-rubble fields from a BuildingType section. */
export function parseAresUrbanCombatBuildingRules(section: IniSection): AresUrbanCombatBuildingRules {
    return {
        passThrough: parseChance(getValue(section, "UC.PassThrough"), 0),
        fatalRate: parseChance(getValue(section, "UC.FatalRate"), 0),
        damageMultiplier: parseDamageMultiplier(getValue(section, "UC.DamageMultiplier")),
        bunkerRaidable: parseBoolean(getValue(section, "Bunker.Raidable"), false),
        isTrench: parseString(getValue(section, "IsTrench")),
        canBeOccupiedBy: parseStringList(getValue(section, "CanBeOccupiedBy")),
        rubbleDestroyed: parseRubbleTransition(section, "Rubble.Destroyed"),
        rubbleIntact: parseRubbleTransition(section, "Rubble.Intact"),
    };
}

/** Parse the projectile-side trench participation flag. */
export function parseAresUrbanCombatProjectileRules(section: IniSection): AresUrbanCombatProjectileRules {
    return {
        subjectToTrenches: parseBoolean(getValue(section, "SubjectToTrenches"), true),
    };
}
