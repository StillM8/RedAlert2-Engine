import type { IniSection } from "@/data/IniSection";

/** Categories used by Chronosphere's SW.AffectsTarget filter. */
export type AresChronoshiftTargetCategory = "infantry" | "unit" | "building";

/** Generic source object categories accepted by the eligibility model. */
export type AresChronoshiftObjectCategory =
    | "infantry"
    | "unit"
    | "vehicle"
    | "aircraft"
    | "building";

export interface AresChronoshiftRules {
    /** TechnoType.Chronoshift.Allow; defaults to yes. */
    allow: boolean;
    /** BuildingType.Chronoshift.IsVehicle; defaults to no. */
    isVehicle: boolean;
    /** TechnoType.Chronoshift.Crushable; defaults to yes. */
    crushable: boolean;
}

export interface AresChronosphereEligibilityRules {
    /** SW.AffectsTarget categories. Omitted means the Chronosphere default. */
    affectedTargets?: readonly unknown[] | unknown;
    /** Chronosphere.ReconsiderBuildings; defaults to yes. */
    reconsiderBuildings?: unknown;
}

export interface AresChronoshiftEligibilityInput {
    objectCategory: unknown;
    techno?: Partial<AresChronoshiftRules> | null;
    chronosphere?: AresChronosphereEligibilityRules | null;
}

export type AresChronoshiftEligibilityReason =
    | "eligible"
    | "not-allowed"
    | "invalid-category"
    | "category-not-affected";

export interface AresChronoshiftEligibility {
    eligible: boolean;
    reason: AresChronoshiftEligibilityReason;
    /** The category used for SW.AffectsTarget after building reclassification. */
    effectiveCategory?: AresChronoshiftTargetCategory;
}

const DEFAULT_RULES: AresChronoshiftRules = {
    allow: true,
    isVehicle: false,
    crushable: true,
};

const DEFAULT_AFFECTED_TARGETS: readonly AresChronoshiftTargetCategory[] = [
    "infantry",
    "unit",
];

type IniValue = string | string[] | undefined;

function normalizeText(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function getValue(section: IniSection, key: string): IniValue {
    const expected = normalizeText(key);
    for (const [actualKey, value] of section.entries) {
        if (normalizeText(actualKey) === expected) return value;
    }
    return undefined;
}

function firstValue(value: IniValue): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function parseBoolean(value: IniValue, defaultValue: boolean): boolean {
    const text = firstValue(value);
    if (text === undefined) return defaultValue;
    switch (normalizeText(text)) {
        case "yes":
        case "true":
        case "1":
        case "on":
            return true;
        case "no":
        case "false":
        case "0":
        case "off":
            return false;
        default:
            return defaultValue;
    }
}

/** Parse TechnoType/BuildingType Chronoshift fields with Ares defaults. */
export function parseAresChronoshiftRules(section: IniSection): AresChronoshiftRules {
    return {
        allow: parseBoolean(getValue(section, "Chronoshift.Allow"), DEFAULT_RULES.allow),
        isVehicle: parseBoolean(getValue(section, "Chronoshift.IsVehicle"), DEFAULT_RULES.isVehicle),
        crushable: parseBoolean(getValue(section, "Chronoshift.Crushable"), DEFAULT_RULES.crushable),
    };
}

function normalizeBoolean(value: unknown, defaultValue: boolean): boolean {
    return typeof value === "boolean" ? value : defaultValue;
}

function normalizeRules(value: Partial<AresChronoshiftRules> | null | undefined): AresChronoshiftRules {
    return {
        allow: normalizeBoolean(value?.allow, DEFAULT_RULES.allow),
        isVehicle: normalizeBoolean(value?.isVehicle, DEFAULT_RULES.isVehicle),
        crushable: normalizeBoolean(value?.crushable, DEFAULT_RULES.crushable),
    };
}

/**
 * Resolve the optional runtime override without borrowing ObjectRules.Crushable.
 * Undefined means no Ares value was authored and preserves the existing
 * Chronosphere collision behavior.
 */
export function resolveAresChronoshiftCrushable(
    value: Partial<AresChronoshiftRules> | null | undefined,
): boolean | undefined {
    return typeof value?.crushable === "boolean" ? value.crushable : undefined;
}

function normalizeObjectCategory(value: unknown): AresChronoshiftObjectCategory | undefined {
    if (typeof value !== "string") return undefined;
    switch (normalizeText(value)) {
        case "infantry":
            return "infantry";
        case "unit":
        case "units":
            return "unit";
        case "vehicle":
        case "vehicles":
            return "vehicle";
        case "aircraft":
        case "air":
            return "aircraft";
        case "building":
        case "buildings":
            return "building";
        default:
            return undefined;
    }
}

function normalizeTargetCategory(value: unknown): AresChronoshiftTargetCategory | "all" | undefined {
    if (typeof value !== "string") return undefined;
    switch (normalizeText(value)) {
        case "infantry":
            return "infantry";
        case "unit":
        case "units":
        case "vehicle":
        case "vehicles":
        case "aircraft":
        case "air":
            return "unit";
        case "building":
        case "buildings":
            return "building";
        case "all":
        case "allcontents":
        case "all contents":
            return "all";
        default:
            return undefined;
    }
}

function targetValues(value: unknown): unknown[] | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "string") return value.split(",");
    if (Array.isArray(value)) return value;
    if (value instanceof Set) return [...value];
    return undefined;
}

function normalizeAffectedTargets(value: unknown): Set<AresChronoshiftTargetCategory> {
    const values = targetValues(value);
    if (values === undefined) return new Set(DEFAULT_AFFECTED_TARGETS);

    const result = new Set<AresChronoshiftTargetCategory>();
    for (const item of values) {
        for (const token of typeof item === "string" ? item.split(",") : [item]) {
            const category = normalizeTargetCategory(token);
            if (category === "all") {
                return new Set(["infantry", "unit", "building"]);
            }
            if (category !== undefined) result.add(category);
        }
    }

    // A malformed or entirely unknown filter must not silently disable the
    // documented Chronosphere defaults.
    return result.size > 0 ? result : new Set(DEFAULT_AFFECTED_TARGETS);
}

function effectiveCategory(
    category: AresChronoshiftObjectCategory,
    rules: AresChronoshiftRules,
    reconsiderBuildings: boolean,
): AresChronoshiftTargetCategory {
    if (category === "infantry") return "infantry";
    if (category === "building") {
        return reconsiderBuildings && rules.isVehicle ? "unit" : "building";
    }
    return "unit";
}

/**
 * Pure Ares Chronoshift eligibility model.
 *
 * This models only Allow, IsVehicle, ReconsiderBuildings, and the
 * SW.AffectsTarget category gate. It does not mutate or chronoshift objects.
 */
export function decideAresChronoshiftEligibility(
    input: AresChronoshiftEligibilityInput,
): AresChronoshiftEligibility {
    const category = normalizeObjectCategory(input.objectCategory);
    if (category === undefined) {
        return { eligible: false, reason: "invalid-category" };
    }

    const rules = normalizeRules(input.techno);
    const reconsiderBuildings = normalizeBoolean(
        input.chronosphere?.reconsiderBuildings,
        true,
    );
    const effective = effectiveCategory(category, rules, reconsiderBuildings);

    if (!rules.allow) {
        return { eligible: false, reason: "not-allowed", effectiveCategory: effective };
    }

    const affectedTargets = normalizeAffectedTargets(input.chronosphere?.affectedTargets);
    if (!affectedTargets.has(effective)) {
        return { eligible: false, reason: "category-not-affected", effectiveCategory: effective };
    }

    return { eligible: true, reason: "eligible", effectiveCategory: effective };
}
