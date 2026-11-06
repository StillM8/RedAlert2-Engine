import { SuperWeaponType } from "@/game/type/SuperWeaponType";
import { normalizeAresCameoPalette } from "@/extensions/ares/AresPcxCameos";

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

export function isAresSuperWeaponTargetType(rules: any): boolean {
    if (rules?.type !== undefined) return true;
    const extensionType = normalize(String(rules?.ares?.extensionType ?? ""));
    return ARES_SUPER_WEAPON_TYPES.some((type) => normalize(type) === extensionType);
}

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
    "chronosphere.",
    "nuke.",
    "dominator.",
    "protect.",
    "mutate.",
    "paradrop.",
    "spyplane.",
    "sidebarpcx",
    "sonarpulse.",
    "eva.",
    "message.",
    "text.",
    "light.",
    "lightning.",
    "droppodweapon",
    "droppodtrailer",
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
    nukePayload?: string;
    nukeSiloLaunch?: boolean;
    /** Ares uses this to make a manual/auto-fired SW use its AI selector. */
    swUseAITargeting?: boolean;
    swAITargeting?: string;
    swAITargetingType?: string;
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
    /** TechnoTypes that can designate the selected target for this SW. */
    swDesignators?: string[];
    /** Allow any owned TechnoType to designate the selected target. */
    swAnyDesignator?: boolean;
    /** Enemy TechnoTypes that can inhibit target areas for this SW. */
    swInhibitors?: string[];
    /** Allow any enemy TechnoType to inhibit a launch site. */
    swAnyInhibitor?: boolean;
    swMaxCount?: number;
    swDeferment?: number;
    lightningDuration?: number;
    lightningHitDelay?: number;
    lightningScatterDelay?: number;
    lightningScatterCount?: number;
    lightningSeparation?: number;
    lightningRadarOutage?: number;
    lightningRadarOutageAffects?: string;
    /** Type=LightningStorm: bypass LightningRod attraction and damage scaling. */
    lightningIgnoreLightningRod?: boolean;
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
    swAnimationVisibility?: string;
    swSound?: string;
    /** Ares PCX sidebar asset; absent means the legacy SidebarImage is used. */
    sidebarPcx?: string;
    sidebarPalette: string;
    /** Chronosphere.ReconsiderBuildings; absent means the Ares default. */
    chronosphereReconsiderBuildings?: boolean;
    /** Chronosphere.KillOrganic; absent means the Ares default. */
    chronosphereKillOrganic?: boolean;
    /** Chronosphere.KillTeleporters; absent means the Ares default. */
    chronosphereKillTeleporters?: boolean;
    /** Chronosphere.AffectsIronCurtain; absent means the Ares default. */
    chronosphereAffectsIronCurtain?: boolean;
    /** Chronosphere.AffectsUnwarpable; absent means the Ares default. */
    chronosphereAffectsUnwarpable?: boolean;
    /** Chronosphere.AffectsUndeployable; absent means the Ares default. */
    chronosphereAffectsUndeployable?: boolean;
    /** Chronosphere.BlowUnplaceable; absent means the Ares default. */
    chronosphereBlowUnplaceable?: boolean;
    /** Chronosphere.KillCargo; absent means the Ares default. */
    chronosphereKillCargo?: boolean;

    dominatorFirstAnim?: string;
    dominatorFirstAnimHeight?: number;
    dominatorSecondAnim?: string;
    dominatorSecondAnimHeight?: number;
    dominatorFireAtPercentage?: number;
    dominatorControlAnim?: string;
    dominatorCapture?: boolean;
    dominatorRipple?: boolean;
    dominatorCaptureMindControlled?: boolean;
    dominatorCapturePermaMindControlled?: boolean;
    dominatorCaptureImmuneToPsionics?: boolean;
    dominatorPermanentCapture?: boolean;

    protectDuration?: number;
    protectPowerOutage?: number;
    protectPlayFadeSoundTime?: number;
    specialSound?: string;

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
    /** Ares message labels, displayed at the corresponding lifecycle stage. */
    messageDetected?: string;
    messageReady?: string;
    messageLaunch?: string;
    messageActivate?: string;
    messageAbort?: string;
    messageInsufficientFunds?: string;
    messageCannotFire?: string;
    messageFirerColor?: boolean;
    messageColor?: string;
    textReady?: string;
    textCharging?: string;
    textActive?: string;

    /** Temporary primary-superweapon lighting override. */
    lightEnabled?: boolean;
    lightAmbient?: number;
    lightRed?: number;
    lightGreen?: number;
    lightBlue?: number;

    deliverTypes?: string[];
    deliverOwner?: string;
    deliverBaseNormal?: boolean;

    sonarPulseDelay?: number;

    dropPodTypes?: string[];
    dropPodVeterancy?: number;
    dropPodMinimum?: number;
    dropPodMaximum?: number;
    dropPodWeapon?: string;
    dropPodTrailer?: string;

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

export interface AresLightningStormSettings {
    readonly duration?: number;
    readonly hitDelay?: number;
    readonly scatterDelay?: number;
    readonly separation?: number;
    readonly scatterCount?: number;
    readonly damage?: number;
    readonly warhead?: string;
    readonly radarOutage?: number;
    readonly radarOutageAffects?: string;
}

export function createAresLightningStormSettings(
    definition?: AresSuperWeaponDefinition,
): Readonly<AresLightningStormSettings> {
    return Object.freeze({
        duration: definition?.lightningDuration,
        hitDelay: definition?.lightningHitDelay,
        scatterDelay: definition?.lightningScatterDelay,
        separation: definition?.lightningSeparation,
        scatterCount: definition?.lightningScatterCount,
        damage: definition?.swDamage,
        warhead: definition?.swWarhead,
        radarOutage: definition?.lightningRadarOutage,
        radarOutageAffects: definition?.lightningRadarOutageAffects,
    });
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
    const type = normalize(definition.typeId ?? "");
    return !!definition.extensionType ||
        definition.extensionEntries.size > 0 ||
        type === "psychicdominator" ||
        type === "forceshield";
}

/**
 * Parse Ares superweapon fields without assigning custom types a vanilla
 * numeric enum value.  The runtime deliberately consumes this as a separate
 * capability layer; until a handler is registered, a custom type remains
 * visible to diagnostics instead of being mis-executed as another weapon.
 */
export function parseAresSuperWeaponDefinition(section: IniSectionLike): AresSuperWeaponDefinition | undefined {
    const typeId = getString(section, "Type");
    const type = normalize(typeId ?? "");
    const extensionType = parseExtensionType(typeId);
    const damageText = getString(section, "SW.Damage");
    const swDamage = getNumber(section, "SW.Damage") ??
        (type === "psychicdominator" && damageText && /^(?:none|null)$/i.test(damageText.trim()) ? 0 : undefined);
    const definition: AresSuperWeaponDefinition = {
        typeId,
        extensionType,
        swDamage,
        swWarhead: getString(section, "SW.Warhead"),
        nukePayload: getString(section, "Nuke.Payload"),
        nukeSiloLaunch: getBool(section, "Nuke.SiloLaunch"),
        swUseAITargeting: getBool(section, "SW.UseAITargeting"),
        swAITargeting: getString(section, "SW.AITargeting") ?? getString(section, "SW.AITargetingType"),
        swAITargetingType: getString(section, "SW.AITargetingType"),
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
        swDesignators: getArray(section, "SW.Designators"),
        swAnyDesignator: getBool(section, "SW.AnyDesignator"),
        swInhibitors: getArray(section, "SW.Inhibitors"),
        swAnyInhibitor: getBool(section, "SW.AnyInhibitor"),
        swMaxCount: getNumber(section, "SW.MaxCount"),
        swDeferment: getNumber(section, "SW.Deferment"),
        lightningDuration: getNumber(section, "Lightning.Duration"),
        lightningHitDelay: getNumber(section, "Lightning.HitDelay"),
        lightningScatterDelay: getNumber(section, "Lightning.ScatterDelay"),
        lightningScatterCount: getNumber(section, "Lightning.ScatterCount"),
        lightningSeparation: getNumber(section, "Lightning.Separation") ??
            getNumber(section, "Lightning.Seperation"),
        lightningRadarOutage: getNumber(section, "Lightning.RadarOutage"),
        lightningRadarOutageAffects: getString(section, "Lightning.RadarOutageAffects"),
        lightningIgnoreLightningRod: getBool(section, "Lightning.IgnoreLightningRod"),
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
        swAnimationVisibility: getString(section, "SW.AnimationVisibility"),
        swSound: getString(section, "SW.Sound"),
        sidebarPcx: getString(section, "SidebarPCX"),
        sidebarPalette: normalizeAresCameoPalette(getString(section, "SidebarPalette")),
        chronosphereReconsiderBuildings: getBool(section, "Chronosphere.ReconsiderBuildings"),
        chronosphereKillOrganic: getBool(section, "Chronosphere.KillOrganic"),
        chronosphereKillTeleporters: getBool(section, "Chronosphere.KillTeleporters"),
        chronosphereAffectsIronCurtain: getBool(section, "Chronosphere.AffectsIronCurtain"),
        chronosphereAffectsUnwarpable: getBool(section, "Chronosphere.AffectsUnwarpable"),
        chronosphereAffectsUndeployable: getBool(section, "Chronosphere.AffectsUndeployable"),
        chronosphereBlowUnplaceable: getBool(section, "Chronosphere.BlowUnplaceable"),
        chronosphereKillCargo: getBool(section, "Chronosphere.KillCargo"),
        dominatorFirstAnim: getString(section, "Dominator.FirstAnim"),
        dominatorFirstAnimHeight: getNumber(section, "Dominator.FirstAnimHeight"),
        dominatorSecondAnim: getString(section, "Dominator.SecondAnim"),
        dominatorSecondAnimHeight: getNumber(section, "Dominator.SecondAnimHeight"),
        dominatorFireAtPercentage: getNumber(section, "Dominator.FireAtPercentage"),
        dominatorControlAnim: getString(section, "Dominator.ControlAnim"),
        dominatorCapture: getBool(section, "Dominator.Capture"),
        dominatorRipple: getBool(section, "Dominator.Ripple"),
        dominatorCaptureMindControlled: getBool(section, "Dominator.CaptureMindControlled"),
        dominatorCapturePermaMindControlled: getBool(section, "Dominator.CapturePermaMindControlled"),
        dominatorCaptureImmuneToPsionics: getBool(section, "Dominator.CaptureImmuneToPsionics"),
        dominatorPermanentCapture: getBool(section, "Dominator.PermanentCapture"),
        protectDuration: getNumber(section, "Protect.Duration"),
        protectPowerOutage: getNumber(section, "Protect.PowerOutage"),
        protectPlayFadeSoundTime: getNumber(section, "Protect.PlayFadeSoundTime"),
        specialSound: getString(section, "SpecialSound"),
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
        messageDetected: getString(section, "Message.Detected"),
        messageReady: getString(section, "Message.Ready"),
        messageLaunch: getString(section, "Message.Launch"),
        messageActivate: getString(section, "Message.Activate"),
        messageAbort: getString(section, "Message.Abort"),
        messageInsufficientFunds: getString(section, "Message.InsufficientFunds"),
        messageCannotFire: getString(section, "Message.CannotFire"),
        messageFirerColor: getBool(section, "Message.FirerColor"),
        messageColor: getString(section, "Message.Color"),
        textReady: getString(section, "Text.Ready"),
        textCharging: getString(section, "Text.Charging"),
        textActive: getString(section, "Text.Active"),
        lightEnabled: getBool(section, "Light.Enabled"),
        lightAmbient: getNumber(section, "Light.Ambient"),
        lightRed: getNumber(section, "Light.Red"),
        lightGreen: getNumber(section, "Light.Green"),
        lightBlue: getNumber(section, "Light.Blue"),
        deliverTypes: getArray(section, "Deliver.Types"),
        deliverOwner: getString(section, "Deliver.Owner"),
        deliverBaseNormal: getBool(section, "Deliver.BaseNormal"),
        sonarPulseDelay: getNumber(section, "SonarPulse.Delay"),
        dropPodTypes: getArray(section, "DropPod.Types"),
        dropPodVeterancy: getNumber(section, "DropPod.Veterancy"),
        dropPodMinimum: getNumber(section, "DropPod.Minimum"),
        dropPodMaximum: getNumber(section, "DropPod.Maximum"),
        dropPodWeapon: getString(section, "DropPodWeapon"),
        dropPodTrailer: getString(section, "DropPodTrailer"),
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
    if (type === "psychicdominator") {
        definition.swAffectsHouse ??= "all";
        definition.swAffectsTarget ??= "infantry,units";
        definition.swDeferment ??= 0;
        definition.dominatorFirstAnimHeight ??= 750;
        definition.dominatorSecondAnimHeight ??= 0;
        definition.dominatorCapture ??= true;
        definition.dominatorRipple ??= true;
        definition.dominatorCaptureMindControlled ??= true;
        definition.dominatorCapturePermaMindControlled ??= true;
        definition.dominatorCaptureImmuneToPsionics ??= false;
        definition.dominatorPermanentCapture ??= true;
    }
    if (type === "forceshield") {
        definition.swAffectsHouse ??= "team";
        definition.swAffectsTarget ??= "buildings";
        definition.swRequiresHouse ??= "team";
        definition.swRequiresTarget ??= "buildings";
        definition.swAnimationHeight ??= 5;
    }
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
