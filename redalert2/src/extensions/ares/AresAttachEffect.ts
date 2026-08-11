/**
 * Data-only normalization for the documented Ares AttachEffect definition.
 *
 * This adapter intentionally does not attach effects to game objects. It is
 * usable for both TechnoType and Warhead sections; Ares applies Delay and
 * InitialDelay to TechnoTypes, and Cumulative and AnimResetOnReapply to
 * Warheads. The caller retains that section context for the later runtime
 * integration.
 */

export interface AresAttachEffectSection {
    entries: ReadonlyMap<string, string | string[]>;
}

export interface AresAttachEffectDefinition {
    /** AnimationType name; omitted when absent or blank. */
    animation?: string;
    /** Frames; -1 is the documented infinite duration. */
    duration: number;
    speedMultiplier: number;
    armorMultiplier: number;
    firepowerMultiplier: number;
    rofMultiplier: number;
    cloakable: boolean;
    forceDecloak: boolean;
    discardOnEntry: boolean;
    penetratesIronCurtain: boolean;
    /** TechnoType-only renewal delay in frames. */
    delay: number;
    /** TechnoType-only first-application delay in frames. */
    initialDelay: number;
    /** Warhead-only stacking flag. */
    cumulative: boolean;
    /** Warhead-only animation reset flag. */
    animResetOnReapply: boolean;
    temporalHidesAnim: boolean;
    /** Warhead/TechnoType AttachEffect.* entries retained for diagnostics and future fields. */
    extensionEntries: ReadonlyMap<string, string | string[]>;
}

const ATTACH_EFFECT_PREFIX = "attacheffect.";

function normalizeKey(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function cloneValue(value: string | string[]): string | string[] {
    return Array.isArray(value) ? [...value] : value;
}

function scalar(section: AresAttachEffectSection, key: string): string | undefined {
    const expected = normalizeKey(key);
    for (const [actualKey, value] of section.entries) {
        if (normalizeKey(actualKey) !== expected) continue;
        if (Array.isArray(value)) {
            return value.length === 1 ? value[0]?.trim() || undefined : undefined;
        }
        const text = value.trim();
        return text || undefined;
    }
    return undefined;
}

function parseBoolean(
    section: AresAttachEffectSection,
    key: string,
    defaultValue: boolean,
): boolean {
    const value = scalar(section, key)?.toLocaleLowerCase("en-US");
    if (value === undefined) return defaultValue;
    if (["yes", "true", "1", "on", "y", "t"].includes(value)) return true;
    if (["no", "false", "0", "off", "n", "f"].includes(value)) return false;
    return defaultValue;
}

function parseInteger(
    section: AresAttachEffectSection,
    key: string,
    defaultValue: number,
): number {
    const value = scalar(section, key);
    if (value === undefined || !/^[+-]?\d+$/.test(value)) return defaultValue;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : defaultValue;
}

function parseMultiplier(
    section: AresAttachEffectSection,
    key: string,
    defaultValue: number,
): number {
    const value = scalar(section, key);
    if (value === undefined) return defaultValue;

    const isPercent = value.endsWith("%");
    const numericValue = isPercent ? value.slice(0, -1).trim() : value;
    if (!numericValue) return defaultValue;

    const parsed = Number(numericValue);
    if (!Number.isFinite(parsed)) return defaultValue;
    return isPercent ? parsed / 100 : parsed;
}

function parseAnimation(section: AresAttachEffectSection): string | undefined {
    return scalar(section, "AttachEffect.Animation");
}

function collectExtensionEntries(
    section: AresAttachEffectSection,
): ReadonlyMap<string, string | string[]> {
    const entries = new Map<string, string | string[]>();
    for (const [key, value] of section.entries) {
        if (normalizeKey(key).startsWith(ATTACH_EFFECT_PREFIX)) {
            entries.set(key, cloneValue(value));
        }
    }
    return entries;
}

/**
 * Normalize the bounded AttachEffect field family without invoking runtime
 * combat, animation, transport, save, or network behavior.
 *
 * Invalid scalar values safely fall back to the documented defaults. Raw
 * AttachEffect.* entries remain available through extensionEntries, including
 * keys this bounded model does not yet understand.
 */
export function parseAresAttachEffectDefinition(
    section: AresAttachEffectSection,
): AresAttachEffectDefinition {
    return {
        animation: parseAnimation(section),
        duration: parseInteger(section, "AttachEffect.Duration", 0),
        speedMultiplier: parseMultiplier(section, "AttachEffect.SpeedMultiplier", 1),
        armorMultiplier: parseMultiplier(section, "AttachEffect.ArmorMultiplier", 1),
        firepowerMultiplier: parseMultiplier(section, "AttachEffect.FirepowerMultiplier", 1),
        rofMultiplier: parseMultiplier(section, "AttachEffect.ROFMultiplier", 1),
        cloakable: parseBoolean(section, "AttachEffect.Cloakable", false),
        forceDecloak: parseBoolean(section, "AttachEffect.ForceDecloak", false),
        discardOnEntry: parseBoolean(section, "AttachEffect.DiscardOnEntry", false),
        penetratesIronCurtain: parseBoolean(section, "AttachEffect.PenetratesIronCurtain", false),
        delay: parseInteger(section, "AttachEffect.Delay", 0),
        initialDelay: parseInteger(section, "AttachEffect.InitialDelay", 0),
        cumulative: parseBoolean(section, "AttachEffect.Cumulative", false),
        animResetOnReapply: parseBoolean(section, "AttachEffect.AnimResetOnReapply", false),
        temporalHidesAnim: parseBoolean(section, "AttachEffect.TemporalHidesAnim", false),
        extensionEntries: collectExtensionEntries(section),
    };
}
