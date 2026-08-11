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

function getNumberArray(section: IniSectionLike, key: string): number[] | undefined {
    const values = getArray(section, key);
    if (values === undefined) return undefined;
    const numbers = values.map(value => value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value));
    return numbers.every(Number.isFinite) ? numbers : undefined;
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
    "money.",
    "usechargedrain",
] as const;

function collectExtensionEntries(section: IniSectionLike): ReadonlyMap<string, string | string[]> {
    const entries = new Map<string, string | string[]>();
    for (const [key, value] of section.entries) {
        const normalized = normalize(key);
        if (EXTENSION_PREFIXES.some(prefix => normalized.startsWith(prefix)) || normalized === "usechargedrain") {
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
    /** Ares uses this to make a manual/auto-fired SW use its AI selector. */
    swUseAITargeting?: boolean;
    swAITargeting?: string;
    swAITargetingConstraints?: string;
    swAITargetingPreference?: string;
    swAffectsHouse?: string;
    swAffectsTarget?: string;
    swRequiresTarget?: string;
    /** Whether manual/AI activation may target the player's unexplored shroud. */
    swFireIntoShroud?: boolean;
    /** Automatically launch for human owners using the configured AI targeter. */
    swAutoFire?: boolean;
    /** When AutoFire is enabled, whether the owning human may click-launch it. */
    swManualFire?: boolean;
    /** Raw legacy flag retained for provenance; Ares handlers decide whether it applies. */
    swUseChargeDrain?: boolean;
    /** Ares forces charge-drain timing for the Firestorm and Battery handlers. */
    useChargeDrain?: boolean;
    swUnstoppable?: boolean;
    swAIRequiresTarget?: string;
    swAIRequiresHouse?: string;
    swRangeMinimum?: number;
    swRangeMaximum?: number;
    swRange?: number[];
    swMaxCount?: number;
    swDeferment?: number;
    swActivationSound?: string;
    swCursor?: string;
    swNoCursor?: string;
    swChargeToDrainRatio?: number;
    /** Explicit second-stage superweapon selected after the source click. */
    swPostDependent?: string;
    swRequiresHouse?: string;
    swInitialReady?: boolean;
    swVirtualCharge?: boolean;
    swGroup?: number;
    swCreateRadarEvent?: boolean;
    swShowCameo?: boolean;
    swTimerVisibility?: string;
    swAnimation?: string;
    swAnimationHeight?: number;
    swSound?: string;

    /** Shared Ares availability/grant fields. */
    requiredHouses?: string[];
    forbiddenHouses?: string[];
    auxBuildings?: string[];
    negBuildings?: string[];
    allowPlayer?: boolean;
    allowAI?: boolean;
    shots?: number;
    alwaysGranted?: boolean;

    /** Credits added to (positive) or removed from (negative) on launch. */
    moneyAmount?: number;
    /** Parsed for diagnostics; runtime charge-drain support is separate. */
    moneyDrainAmount?: number;
    /** Parsed for diagnostics; runtime charge-drain support is separate. */
    moneyDrainDelay?: number;

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

export interface SuperWeaponIdentity {
    index: number;
    type?: SuperWeaponType;
    typeId?: string;
    name?: string;
}

/**
 * Resolve the action/network identity for a superweapon.  Vanilla callers
 * historically supplied the numeric Type= enum; UI and serialized actions
 * use the authored list index so custom Ares types do not collide with a
 * vanilla enum value.
 */
export function resolveSuperWeaponActivationId(
    rules: Iterable<SuperWeaponIdentity>,
    selector: SuperWeaponType | string | number,
): number | undefined {
    if (selector === undefined || selector === null) return undefined;
    const entries = [...rules];
    if (typeof selector === "string") {
        const normalized = normalize(selector);
        return entries.find(rule => normalize(rule.name ?? "") === normalized || normalize(rule.typeId ?? "") === normalized)?.index;
    }
    const byVanillaType = entries.find(rule => rule.type === selector);
    return byVanillaType?.index ?? entries.find(rule => rule.index === selector)?.index;
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
        swUseAITargeting: getBool(section, "SW.UseAITargeting"),
        swAITargeting: getString(section, "SW.AITargeting"),
        swAITargetingConstraints: getString(section, "SW.AITargeting.Constraints"),
        swAITargetingPreference: getString(section, "SW.AITargeting.Preference"),
        swAffectsHouse: getString(section, "SW.AffectsHouse"),
        swAffectsTarget: getString(section, "SW.AffectsTarget"),
        swRequiresTarget: getString(section, "SW.RequiresTarget"),
        swFireIntoShroud: getBool(section, "SW.FireIntoShroud"),
        swAutoFire: getBool(section, "SW.AutoFire"),
        swManualFire: getBool(section, "SW.ManualFire"),
        swUseChargeDrain: getBool(section, "UseChargeDrain"),
        // Ares 3.0 only enables the charge-drain state machine for handlers
        // that own that lifecycle.  In particular, Firestorm ignores an
        // explicit UseChargeDrain=no, while an arbitrary custom Type= must
        // not gain gameplay merely because the field was present.
        useChargeDrain: extensionType === "Firestorm" ||
            extensionType === "Battery",
        swUnstoppable: getBool(section, "SW.Unstoppable"),
        swAIRequiresTarget: getString(section, "SW.AIRequiresTarget"),
        swAIRequiresHouse: getString(section, "SW.AIRequiresHouse"),
        swRangeMinimum: getNumber(section, "SW.RangeMinimum"),
        swRangeMaximum: getNumber(section, "SW.RangeMaximum"),
        swRange: getNumberArray(section, "SW.Range"),
        swMaxCount: getNumber(section, "SW.MaxCount"),
        swDeferment: getNumber(section, "SW.Deferment"),
        swActivationSound: getString(section, "SW.ActivationSound"),
        swCursor: getString(section, "Cursor") ?? getString(section, "SW.Cursor"),
        swNoCursor: getString(section, "NoCursor") ?? getString(section, "SW.NoCursor"),
        swChargeToDrainRatio: getNumber(section, "SW.ChargeToDrainRatio"),
        swPostDependent: getString(section, "SW.PostDependent"),
        swRequiresHouse: getString(section, "SW.RequiresHouse"),
        swInitialReady: getBool(section, "SW.InitialReady"),
        swVirtualCharge: getBool(section, "SW.VirtualCharge"),
        swGroup: getNumber(section, "SW.Group"),
        swCreateRadarEvent: getBool(section, "SW.CreateRadarEvent"),
        swShowCameo: getBool(section, "SW.ShowCameo"),
        swTimerVisibility: getString(section, "SW.TimerVisibility"),
        swAnimation: getString(section, "SW.Animation"),
        swAnimationHeight: getNumber(section, "SW.AnimationHeight"),
        swSound: getString(section, "SW.Sound"),
        requiredHouses: getArray(section, "SW.RequiredHouses"),
        forbiddenHouses: getArray(section, "SW.ForbiddenHouses"),
        auxBuildings: getArray(section, "SW.AuxBuildings"),
        negBuildings: getArray(section, "SW.NegBuildings"),
        allowPlayer: getBool(section, "SW.AllowPlayer"),
        allowAI: getBool(section, "SW.AllowAI"),
        shots: getNumber(section, "SW.Shots"),
        alwaysGranted: getBool(section, "SW.AlwaysGranted"),
        moneyAmount: getNumber(section, "Money.Amount"),
        moneyDrainAmount: getNumber(section, "Money.DrainAmount"),
        moneyDrainDelay: getNumber(section, "Money.DrainDelay"),
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

function isChronoWarpRule(rule: any): boolean {
    return rule?.type === SuperWeaponType.ChronoWarp ||
        normalize(rule?.typeId ?? "") === "chronowarp" ||
        normalize(rule?.ares?.typeId ?? "") === "chronowarp" ||
        normalize(rule?.ares?.extensionType ?? "") === "chronowarp";
}

/**
 * Resolves Ares' SW.PostDependent reference without relying on the legacy
 * PreClick/PostClick/PreDependent flags. Antares uses the explicitly named
 * ChronoWarp when it exists, and otherwise falls back to the first
 * ChronoWarp definition in authored SuperWeaponTypes order.
 */
export function resolveAresPostDependentSuperWeapon(
    rules: Iterable<any>,
    source: any,
): any | undefined {
    const entries = [...rules];
    const reference = source?.ares?.swPostDependent?.trim();
    if (reference) {
        const expected = normalize(reference);
        const named = entries.find((rule) =>
            normalize(rule?.name ?? "") === expected ||
            normalize(rule?.typeId ?? "") === expected ||
            normalize(rule?.ares?.typeId ?? "") === expected);
        if (named) return named;
    }

    // Ares' ChronoSphere handler defaults to the first ChronoWarp type when
    // SW.PostDependent is omitted or points at a missing/non-warp section.
    if (source?.type === SuperWeaponType.ChronoSphere ||
        normalize(source?.typeId ?? "") === "chronosphere") {
        return entries.find(isChronoWarpRule);
    }
    return undefined;
}

/** Parse either the vanilla enum value or retain the raw Ares Type= string. */
export function parseSuperWeaponType(value: string | undefined): SuperWeaponType | undefined {
    return parseVanillaType(value);
}
