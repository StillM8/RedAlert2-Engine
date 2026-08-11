import { SuperWeaponType } from "@/game/type/SuperWeaponType";
import type { AresSuperWeaponDefinition } from "./AresSuperWeapons";

/**
 * Ares' documented superweapon AI modes, plus the additional names exposed
 * by the Ares 3.0p1 targeting table.  These are semantic IDs, not the
 * numeric enum used by the Windows implementation.
 */
export type AresSuperWeaponAITargetingMode =
    | "none"
    | "nuke"
    | "lightning-storm"
    | "psychic-dominator"
    | "paradrop"
    | "genetic-mutator"
    | "force-shield"
    | "no-target"
    | "offensive"
    | "stealth"
    | "self"
    | "base"
    | "multi-missile"
    | "hunter-seeker"
    | "enemy-base"
    | "iron-curtain"
    | "attack"
    | "low-power"
    | "low-power-attack"
    | "drop-pod"
    | "lightning-random"
    | "unknown";

export type AresSuperWeaponAIPreference = "none" | "offensive" | "defensive";

/** Houses accepted by SW.AIRequiresHouse. */
export type AresSuperWeaponAIHouse = "none" | "owner" | "allies" | "team" | "enemies" | "others" | "all" | "unknown";

/**
 * Antares' bit flags that gate automatic targeting before a selector runs.
 * Keep them as stable semantic IDs instead of exposing the native bit mask.
 */
export type AresSuperWeaponAIConstraint =
    | "offensive-cell-clear"
    | "defensive-cell-clear"
    | "enemy"
    | "lightning-storm-inactive"
    | "dominator-inactive"
    | "attacked"
    | "low-power"
    | "offensive-cell-set"
    | "defensive-cell-set";

export interface AresSuperWeaponAITargetingProfile {
    rawMode?: string;
    mode: AresSuperWeaponAITargetingMode;
    supported: boolean;
    /** Ares SuperWeaponTarget names used by AI-required target filtering. */
    requiredTarget: string;
    /** Ares affected-house names used by AI-required house filtering. */
    requiredHouse: string;
    preference: AresSuperWeaponAIPreference;
    constraints: readonly AresSuperWeaponAIConstraint[];
    useAITargeting: boolean;
    allowsEmptyCell: boolean;
}

export interface AresSuperWeaponAITargetingInput extends Pick<
    AresSuperWeaponDefinition,
    | "swUseAITargeting"
    | "swAITargeting"
    | "swAITargetingConstraints"
    | "swAITargetingPreference"
    | "swAIRequiresTarget"
    | "swAIRequiresHouse"
    | "swAffectsTarget"
    | "swAffectsHouse"
    | "extensionType"
    | "typeId"
    | "empulseTargetSelf"
> {
    type?: SuperWeaponType;
}

interface ModeDefaults {
    requiredTarget: string;
    requiredHouse: string;
    preference: AresSuperWeaponAIPreference;
    constraints: readonly AresSuperWeaponAIConstraint[];
    allowsEmptyCell?: boolean;
}

const MODE_DEFAULTS: Readonly<Record<Exclude<AresSuperWeaponAITargetingMode, "unknown">, ModeDefaults>> = {
    "none": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: [] },
    "nuke": { requiredTarget: "infantry,units,buildings", requiredHouse: "enemies", preference: "offensive", constraints: ["enemy"] },
    "lightning-storm": { requiredTarget: "infantry,units,buildings", requiredHouse: "enemies", preference: "offensive", constraints: ["enemy", "lightning-storm-inactive"] },
    "psychic-dominator": { requiredTarget: "infantry,units", requiredHouse: "all", preference: "none", constraints: ["offensive-cell-clear", "enemy", "dominator-inactive"] },
    "paradrop": { requiredTarget: "", requiredHouse: "", preference: "offensive", constraints: [] },
    "genetic-mutator": { requiredTarget: "infantry", requiredHouse: "all", preference: "none", constraints: ["offensive-cell-clear"] },
    "force-shield": { requiredTarget: "", requiredHouse: "", preference: "defensive", constraints: [] },
    "no-target": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: [], allowsEmptyCell: true },
    "offensive": { requiredTarget: "infantry,units,buildings", requiredHouse: "enemies", preference: "none", constraints: ["enemy"] },
    "stealth": { requiredTarget: "infantry,units,buildings", requiredHouse: "enemies", preference: "none", constraints: [] },
    "self": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: [] },
    "base": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: [] },
    "multi-missile": { requiredTarget: "buildings", requiredHouse: "enemies", preference: "offensive", constraints: ["enemy"] },
    "hunter-seeker": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: ["enemy"], allowsEmptyCell: true },
    "enemy-base": { requiredTarget: "", requiredHouse: "enemies", preference: "none", constraints: ["enemy"] },
    "iron-curtain": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: [] },
    "attack": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: ["attacked"], allowsEmptyCell: true },
    "low-power": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: ["low-power"], allowsEmptyCell: true },
    "low-power-attack": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: ["attacked", "low-power"], allowsEmptyCell: true },
    "drop-pod": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: ["enemy"] },
    "lightning-random": { requiredTarget: "", requiredHouse: "", preference: "none", constraints: [], allowsEmptyCell: true },
};

const MODE_ALIASES: Readonly<Record<string, AresSuperWeaponAITargetingMode>> = {
    none: "none",
    nuke: "nuke",
    lightningstorm: "lightning-storm",
    lightning: "lightning-storm",
    psychicdominator: "psychic-dominator",
    paradrop: "paradrop",
    geneticmutator: "genetic-mutator",
    geneticconverter: "genetic-mutator",
    forceshield: "force-shield",
    notarget: "no-target",
    offensive: "offensive",
    stealth: "stealth",
    self: "self",
    base: "base",
    multimissile: "multi-missile",
    hunterseeker: "hunter-seeker",
    enemybase: "enemy-base",
    ironcurtain: "iron-curtain",
    attack: "attack",
    lowpower: "low-power",
    lowpowerattack: "low-power-attack",
    droppod: "drop-pod",
    lightningrandom: "lightning-random",
};

const CONSTRAINT_ALIASES: Readonly<Record<string, AresSuperWeaponAIConstraint>> = {
    offensivecellclear: "offensive-cell-clear",
    defensivecellclear: "defensive-cell-clear",
    enemy: "enemy",
    lightningstorminactive: "lightning-storm-inactive",
    dominatorinactive: "dominator-inactive",
    attacked: "attacked",
    lowpower: "low-power",
    offensivecellset: "offensive-cell-set",
    defensivecellset: "defensive-cell-set",
};

function compact(value: string | undefined): string {
    return (value ?? "").trim().toLocaleLowerCase("en-US").replace(/[._\s-]+/g, "");
}

function parseConstraints(value: string | undefined): AresSuperWeaponAIConstraint[] | undefined {
    if (value === undefined) return undefined;
    const parsed: AresSuperWeaponAIConstraint[] = [];
    for (const token of value.split(",").map(item => item.trim()).filter(Boolean)) {
        const constraint = CONSTRAINT_ALIASES[compact(token)];
        if (constraint && !parsed.includes(constraint)) parsed.push(constraint);
    }
    return parsed;
}

function parsePreference(value: string | undefined): AresSuperWeaponAIPreference | undefined {
    switch (compact(value)) {
        case "offensive": return "offensive";
        case "defensive": return "defensive";
        case "none": return "none";
        default: return undefined;
    }
}

/**
 * Normalizes the house relation used by the host bot's visible-object API.
 * Ares accepts both `others` and `enemies`; the latter is the usual spelling
 * in Mental Omega rules, while `others` is retained for generic Ares rules.
 */
export function normalizeAresSuperWeaponAIHouse(value: string | undefined): AresSuperWeaponAIHouse {
    switch (compact(value)) {
        case "none": return "none";
        case "owner":
        case "self": return "owner";
        case "allies":
        case "ally": return "allies";
        case "team": return "team";
        case "enemies":
        case "enemy": return "enemies";
        case "others": return "others";
        case "all": return "all";
        default: return "unknown";
    }
}

function defaultMode(input: AresSuperWeaponAITargetingInput): AresSuperWeaponAITargetingMode {
    const extension = compact(input.extensionType);
    if (extension === "genericwarhead") return "offensive";
    if (extension === "unitdelivery") return "paradrop";
    if (extension === "droppod") return "drop-pod";
    if (extension === "sonarpulse") return "stealth";
    if (extension === "hunterseeker") return "hunter-seeker";
    if (extension === "battery") return "low-power";
    if (extension === "empulse" || extension === "firestorm" || extension === "chronowarp") return "none";

    const type = compact(input.typeId);
    if (type === "multimissile") return "nuke";
    if (type === "lightningstorm") return "lightning-storm";
    if (type === "psychicdominator") return "psychic-dominator";
    if (type === "geneticconverter" || type === "geneticmutator") return "genetic-mutator";
    if (type === "paradrop" || type === "amerparadrop") return "paradrop";
    if (type === "forceshield") return "force-shield";
    if (type === "chronosphere" || type === "chronowarp") return "none";
    if (type === "ironcurtain") return "iron-curtain";
    if (type === "spyplane" || type === "psychicreveal") return "paradrop";

    switch (input.type) {
        case SuperWeaponType.MultiMissile: return "nuke";
        case SuperWeaponType.LightningStorm: return "lightning-storm";
        case SuperWeaponType.PsychicDominator: return "psychic-dominator";
        case SuperWeaponType.GeneticConverter: return "genetic-mutator";
        case SuperWeaponType.ParaDrop:
        case SuperWeaponType.AmerParaDrop: return "paradrop";
        case SuperWeaponType.ForceShield: return "force-shield";
        case SuperWeaponType.IronCurtain: return "iron-curtain";
        case SuperWeaponType.ChronoSphere:
        case SuperWeaponType.ChronoWarp: return "none";
        default: return "none";
    }
}

function defaultRequiredTarget(
    input: AresSuperWeaponAITargetingInput,
    mode: Exclude<AresSuperWeaponAITargetingMode, "unknown">,
): string {
    // Antares' SonarPulse initializer supplies Water as the AI-required
    // target even though its general Stealth mode normally means all technos.
    if (compact(input.extensionType) === "sonarpulse") return "water";
    return MODE_DEFAULTS[mode].requiredTarget;
}

export function normalizeAresSuperWeaponAITargeting(value: string | undefined): AresSuperWeaponAITargetingMode {
    if (value === undefined || !value.trim()) return "unknown";
    return MODE_ALIASES[compact(value)] ?? "unknown";
}

/**
 * Resolves the documented Ares AI mode and its Antares 3.0p1 defaults. This
 * is deliberately a pure normalized-model helper; callers decide how their
 * host AI selects a concrete cell.
 */
export function resolveAresSuperWeaponAITargeting(
    input: AresSuperWeaponAITargetingInput,
): AresSuperWeaponAITargetingProfile {
    const rawMode = input.swAITargeting?.trim() || undefined;
    const mode = rawMode === undefined ? defaultMode(input) : normalizeAresSuperWeaponAITargeting(rawMode);
    if (mode === "unknown") {
        return {
            rawMode,
            mode,
            supported: false,
            requiredTarget: input.swAIRequiresTarget?.trim() ?? "",
            requiredHouse: input.swAIRequiresHouse?.trim() ?? "",
            preference: "none",
            constraints: parseConstraints(input.swAITargetingConstraints) ?? [],
            useAITargeting: input.swUseAITargeting === true,
            allowsEmptyCell: false,
        };
    }

    const defaults = MODE_DEFAULTS[mode];
    return {
        rawMode,
        mode,
        supported: mode !== "none",
        requiredTarget: input.swAIRequiresTarget?.trim() || defaultRequiredTarget(input, mode),
        requiredHouse: input.swAIRequiresHouse?.trim() || defaults.requiredHouse,
        preference: parsePreference(input.swAITargetingPreference) ?? defaults.preference,
        constraints: parseConstraints(input.swAITargetingConstraints) ?? defaults.constraints,
        useAITargeting: input.swUseAITargeting === true,
        allowsEmptyCell: defaults.allowsEmptyCell ?? false,
    };
}
