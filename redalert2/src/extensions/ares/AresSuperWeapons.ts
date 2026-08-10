import { SuperWeaponType } from "@/game/type/SuperWeaponType";

/**
 * Ares superweapon type names which are not represented by the vanilla
 * numeric SuperWeaponType enum.  Keep this list data-driven: the rules parser
 * must retain a custom type instead of silently converting it to a vanilla
 * effect.
 */
export const ARES_SUPER_WEAPON_TYPES = [
    "GenericWarhead",
    "UnitDelivery",
    "Firestorm",
    "HunterSeeker",
    "DropPod",
    "EMPulse",
    "Battery",
    "SonarPulse",
    "ChronoWarp",
] as const;

export type AresSuperWeaponType = typeof ARES_SUPER_WEAPON_TYPES[number];

interface IniSectionLike {
    entries: Map<string, string | string[]>;
}

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function scalar(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0]?.trim() || undefined;
    const text = value?.trim();
    return text || undefined;
}

function findEntry(section: IniSectionLike, key: string): string | string[] | undefined {
    const expected = normalize(key);
    for (const [actual, value] of section.entries) {
        if (normalize(actual) === expected) return value;
    }
    return undefined;
}

function getString(section: IniSectionLike, key: string): string | undefined {
    return scalar(findEntry(section, key));
}

function getNumber(section: IniSectionLike, key: string): number | undefined {
    const text = getString(section, key);
    if (text === undefined) return undefined;
    const value = text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
    return Number.isFinite(value) ? value : undefined;
}

function getBool(section: IniSectionLike, key: string): boolean | undefined {
    const text = getString(section, key)?.toLocaleLowerCase("en-US");
    if (text === undefined) return undefined;
    if (["yes", "true", "1", "on"].includes(text)) return true;
    if (["no", "false", "0", "off"].includes(text)) return false;
    return undefined;
}

function getArray(section: IniSectionLike, key: string): string[] | undefined {
    const value = findEntry(section, key);
    if (value === undefined) return undefined;
    const values = Array.isArray(value) ? value : value.split(",");
    const result = values.flatMap(item => item.split(",")).map(item => item.trim()).filter(Boolean);
    return result.length ? result : [];
}

function parseVanillaType(value: string | undefined): SuperWeaponType | undefined {
    if (!value) return undefined;
    const expected = normalize(value);
    for (const [name, enumValue] of Object.entries(SuperWeaponType)) {
        // Numeric reverse-mapping entries are not names.
        if (/^\d+$/.test(name)) continue;
        if (normalize(name) === expected) return enumValue as SuperWeaponType;
    }
    return undefined;
}

function parseExtensionType(value: string | undefined): AresSuperWeaponType | undefined {
    if (!value) return undefined;
    return ARES_SUPER_WEAPON_TYPES.find(type => normalize(type) === normalize(value));
}

const EXTENSION_PREFIXES = [
    "sw.",
    "deliver.",
    "droppod.",
    "empulse.",
    "battery.",
    "hunterseeker.",
    "firestorm.",
    "genericwarhead.",
    "chronowarp.",
    "sonarpulse.",
    "eva.",
    "text.",
] as const;

function collectExtensionEntries(section: IniSectionLike): ReadonlyMap<string, string | string[]> {
    const entries = new Map<string, string | string[]>();
    for (const [key, value] of section.entries) {
        const normalized = normalize(key);
        if (EXTENSION_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
            entries.set(key, Array.isArray(value) ? [...value] : value);
        }
    }
    return entries;
}

export interface AresSuperWeaponDefinition {
    /** The original Type= value, case-preserved for diagnostics. */
    typeId?: string;
    /** Parsed only when the type is one of Ares' non-vanilla handlers. */
    extensionType?: AresSuperWeaponType;

    swDamage?: number;
    swWarhead?: string;
    swAITargeting?: string;
    swAffectsHouse?: string;
    swAffectsTarget?: string;
    swRequiresTarget?: string;
    swAIRequiresTarget?: string;
    swRangeMinimum?: number;
    swRangeMaximum?: number;
    swMaxCount?: number;
    swDeferment?: number;
    swActivationSound?: string;
    swCursor?: string;
    swNoCursor?: string;
    swChargeToDrainRatio?: number;

    evaDetected?: string;
    evaReady?: string;
    evaActivated?: string;
    textReady?: string;

    deliverTypes?: string[];
    deliverOwner?: string;
    deliverBaseNormal?: boolean;

    sonarPulseDelay?: number;

    dropPodTypes?: string[];
    dropPodVeterancy?: number;
    dropPodMinimum?: number;
    dropPodMaximum?: number;

    hunterSeekerBuildings?: string[];
    hunterSeekerType?: string;
    hunterSeekerRandomOnly?: boolean;

    empulseCannons?: string[];
    empulseTargetSelf?: boolean;
    empulseLinked?: boolean;
    empulsePulseBall?: string;
    empulsePulseDelay?: number;

    batteryPower?: number;
    batteryOverpower?: string[];
    batteryKeepOnline?: string[];

    /**
     * Preserve all Ares-prefixed values, including fields not yet modeled by
     * the runtime.  This makes compatibility diagnostics lossless and gives
     * future handlers a single normalized source to extend.
     */
    extensionEntries: ReadonlyMap<string, string | string[]>;
}

function isMeaningful(definition: AresSuperWeaponDefinition): boolean {
    return !!definition.extensionType || definition.extensionEntries.size > 0;
}

/**
 * Parse Ares superweapon fields without assigning custom types a vanilla
 * numeric enum value.  The runtime deliberately consumes this as a separate
 * capability layer; until a handler is registered, a custom type remains
 * visible to diagnostics instead of being mis-executed as another weapon.
 */
export function parseAresSuperWeaponDefinition(section: IniSectionLike): AresSuperWeaponDefinition | undefined {
    const typeId = getString(section, "Type");
    const extensionType = parseExtensionType(typeId);
    const definition: AresSuperWeaponDefinition = {
        typeId,
        extensionType,
        swDamage: getNumber(section, "SW.Damage"),
        swWarhead: getString(section, "SW.Warhead"),
        swAITargeting: getString(section, "SW.AITargeting"),
        swAffectsHouse: getString(section, "SW.AffectsHouse"),
        swAffectsTarget: getString(section, "SW.AffectsTarget"),
        swRequiresTarget: getString(section, "SW.RequiresTarget"),
        swAIRequiresTarget: getString(section, "SW.AIRequiresTarget"),
        swRangeMinimum: getNumber(section, "SW.RangeMinimum"),
        swRangeMaximum: getNumber(section, "SW.RangeMaximum"),
        swMaxCount: getNumber(section, "SW.MaxCount"),
        swDeferment: getNumber(section, "SW.Deferment"),
        swActivationSound: getString(section, "SW.ActivationSound"),
        swCursor: getString(section, "Cursor") ?? getString(section, "SW.Cursor"),
        swNoCursor: getString(section, "NoCursor") ?? getString(section, "SW.NoCursor"),
        swChargeToDrainRatio: getNumber(section, "SW.ChargeToDrainRatio"),
        evaDetected: getString(section, "EVA.Detected"),
        evaReady: getString(section, "EVA.Ready"),
        evaActivated: getString(section, "EVA.Activated"),
        textReady: getString(section, "Text.Ready"),
        deliverTypes: getArray(section, "Deliver.Types"),
        deliverOwner: getString(section, "Deliver.Owner"),
        deliverBaseNormal: getBool(section, "Deliver.BaseNormal"),
        sonarPulseDelay: getNumber(section, "SonarPulse.Delay"),
        dropPodTypes: getArray(section, "DropPod.Types"),
        dropPodVeterancy: getNumber(section, "DropPod.Veterancy"),
        dropPodMinimum: getNumber(section, "DropPod.Minimum"),
        dropPodMaximum: getNumber(section, "DropPod.Maximum"),
        hunterSeekerBuildings: getArray(section, "HunterSeeker.Buildings"),
        hunterSeekerType: getString(section, "HunterSeeker.Type"),
        hunterSeekerRandomOnly: getBool(section, "HunterSeeker.RandomOnly"),
        empulseCannons: getArray(section, "EMPulse.Cannons"),
        empulseTargetSelf: getBool(section, "EMPulse.TargetSelf"),
        empulseLinked: getBool(section, "EMPulse.Linked"),
        empulsePulseBall: getString(section, "EMPulse.PulseBall"),
        empulsePulseDelay: getNumber(section, "EMPulse.PulseDelay"),
        batteryPower: getNumber(section, "Battery.Power"),
        batteryOverpower: getArray(section, "Battery.Overpower"),
        batteryKeepOnline: getArray(section, "Battery.KeepOnline"),
        extensionEntries: collectExtensionEntries(section),
    };
    return isMeaningful(definition) ? definition : undefined;
}

/** Parse either the vanilla enum value or retain the raw Ares Type= string. */
export function parseSuperWeaponType(value: string | undefined): SuperWeaponType | undefined {
    return parseVanillaType(value);
}
