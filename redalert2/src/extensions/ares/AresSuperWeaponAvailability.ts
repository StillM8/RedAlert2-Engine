import { ObjectType } from "@/engine/type/ObjectType";
import { buildingProvidesAresSuperWeapon } from "@/extensions/ares/AresSuperWeaponProviders";

/**
 * Pure availability rules for Ares superweapons.
 *
 * The evaluator deliberately knows nothing about a particular mod, profile,
 * building name, or UI. Callers provide the current house state and the
 * provider building types that are currently owned. This keeps the same
 * availability decision usable by the runtime, AI, and presentation layers.
 */

export type AresAvailabilityList = string | readonly string[] | Iterable<string>;

export interface AresSuperWeaponAvailabilityRules {
    requiredHouses?: AresAvailabilityList;
    forbiddenHouses?: AresAvailabilityList;
    auxBuildings?: AresAvailabilityList;
    negBuildings?: AresAvailabilityList;
    allowPlayer?: boolean | string;
    allowAI?: boolean | string;
    shots?: number | string;
    alwaysGranted?: boolean | string;

    /** Raw parsed Ares entries, as retained by AresSuperWeaponDefinition. */
    extensionEntries?: ReadonlyMap<string, string | string[]>;
}

export interface AresSuperWeaponAvailabilityContext {
    countryId?: string;
    isAi: boolean;
    defeated?: boolean;
    /** All currently owned building type names, used by Aux/NegBuildings. */
    ownedBuildingTypes: Iterable<string>;
    /** Provider building types currently owned for this superweapon. */
    ownedProviderBuildingTypes: Iterable<string>;
    shotsFired?: number;
}

export interface AresSuperWeaponOwnerLike {
    country?: { id?: string; name?: string };
    isAi?: boolean;
    defeated?: boolean;
    buildings?: Iterable<{
        name?: string;
        rules?: { name?: string; superWeapon?: string; superWeapon2?: string; superWeapons?: string[] };
    }>;
    getOwnedObjectsByType?: (type: ObjectType) => Iterable<{
        name?: string;
        rules?: { name?: string; superWeapon?: string; superWeapon2?: string; superWeapons?: string[] };
    }>;
}

export type AresSuperWeaponAvailabilityFailure =
    | "defeated"
    | "forbidden-house"
    | "missing-required-house"
    | "player-not-allowed"
    | "ai-not-allowed"
    | "missing-aux-building"
    | "has-negative-building"
    | "shot-limit"
    | "missing-provider-building";

const AVAILABILITY_KEYS = new Set([
    "sw.requiredhouses",
    "sw.forbiddenhouses",
    "sw.auxbuildings",
    "sw.negbuildings",
    "sw.allowplayer",
    "sw.allowai",
    "sw.shots",
    "sw.alwaysgranted",
]);

/** Whether a definition explicitly opts into the shared availability layer. */
export function hasAresSuperWeaponAvailabilityConfiguration(
    rules: AresSuperWeaponAvailabilityRules,
): boolean {
    if (rules.requiredHouses !== undefined ||
        rules.forbiddenHouses !== undefined ||
        rules.auxBuildings !== undefined ||
        rules.negBuildings !== undefined ||
        rules.allowPlayer !== undefined ||
        rules.allowAI !== undefined ||
        rules.shots !== undefined ||
        rules.alwaysGranted !== undefined) {
        return true;
    }
    return [...(rules.extensionEntries?.keys() ?? [])]
        .some((key) => AVAILABILITY_KEYS.has(normalize(key)));
}

export interface AresSuperWeaponAvailabilityResult {
    available: boolean;
    /** Stable reason list for callers that only need explainability. */
    reasons: readonly AresSuperWeaponAvailabilityFailure[];
    /** Detailed alias retained for diagnostics and existing callers. */
    failures: readonly AresSuperWeaponAvailabilityFailure[];
    providerBuildingPresent: boolean;
    shotsLimit: number;
    shotsRemaining?: number;
}

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function asValues(value: AresAvailabilityList | string | string[] | undefined): string[] {
    if (value === undefined) return [];
    const values = typeof value === "string" ? [value] : [...value];
    return values
        .flatMap(item => item.split(","))
        .map(item => normalize(item))
        .filter(Boolean);
}

function names(values: Iterable<string>): Set<string> {
    return new Set([...values].map(normalize).filter(Boolean));
}

function rawEntry(
    rules: AresSuperWeaponAvailabilityRules,
    ...keys: string[]
): string | string[] | undefined {
    if (!rules.extensionEntries) return undefined;
    const expected = new Set(keys.map(normalize));
    for (const [key, value] of rules.extensionEntries) {
        if (expected.has(normalize(key))) return value;
    }
    return undefined;
}

function listField(
    rules: AresSuperWeaponAvailabilityRules,
    value: AresAvailabilityList | undefined,
    ...rawKeys: string[]
): string[] {
    const typed = asValues(value);
    if (value !== undefined) return typed;
    return asValues(rawEntry(rules, ...rawKeys));
}

function boolField(
    rules: AresSuperWeaponAvailabilityRules,
    value: boolean | string | undefined,
    defaultValue: boolean,
    ...rawKeys: string[]
): boolean {
    const raw = value !== undefined ? value : rawEntry(rules, ...rawKeys);
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
        const normalized = normalize(raw);
        if (["yes", "true", "1", "on"].includes(normalized)) return true;
        if (["no", "false", "0", "off"].includes(normalized)) return false;
    }
    return defaultValue;
}

function numberField(
    rules: AresSuperWeaponAvailabilityRules,
    value: number | string | undefined,
    defaultValue: number,
    ...rawKeys: string[]
): number {
    const raw = value !== undefined ? value : rawEntry(rules, ...rawKeys);
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
    return Number.isFinite(parsed) ? Math.trunc(parsed) : defaultValue;
}

function hasHouse(houses: Set<string>, countryId: string | undefined): boolean {
    if (!houses.size || houses.has("none") || houses.has("all")) return true;
    return countryId !== undefined && houses.has(normalize(countryId));
}

function hasAny(values: Set<string>, candidates: readonly string[]): boolean {
    return candidates.some(candidate => values.has(candidate));
}

/**
 * Evaluate the common Ares superweapon availability gates.
 *
 * Every failure is returned in a stable order so callers can present a
 * useful diagnostic without changing the decision. `AlwaysGranted` bypasses
 * only the provider-building requirement; Ares still applies the house,
 * auxiliary-building, player/AI, shot, and defeated-player restrictions.
 */
export function evaluateAresSuperWeaponAvailability(
    rules: AresSuperWeaponAvailabilityRules,
    context: AresSuperWeaponAvailabilityContext,
): AresSuperWeaponAvailabilityResult {
    const requiredHouses = new Set(listField(rules, rules.requiredHouses, "SW.RequiredHouses", "RequiredHouses"));
    const forbiddenHouses = new Set(listField(rules, rules.forbiddenHouses, "SW.ForbiddenHouses", "ForbiddenHouses"));
    const auxBuildings = listField(rules, rules.auxBuildings, "SW.AuxBuildings", "AuxBuildings");
    const negBuildings = listField(rules, rules.negBuildings, "SW.NegBuildings", "NegBuildings");
    const ownedBuildings = names(context.ownedBuildingTypes);
    const ownedProviders = names(context.ownedProviderBuildingTypes);
    const providerBuildingPresent = ownedProviders.size > 0;
    const parsedShotsLimit = numberField(rules, rules.shots, -1, "SW.Shots", "Shots");
    // Ares documents -1 as the unlimited sentinel. Treat other negative
    // values as the same safe unlimited fallback instead of inventing a
    // second, undocumented shot policy.
    const shotsLimit = parsedShotsLimit < -1 ? -1 : parsedShotsLimit;
    const shotsFired = Math.max(0, Math.trunc(context.shotsFired ?? 0));
    const shotsRemaining = shotsLimit >= 0 ? Math.max(0, shotsLimit - shotsFired) : undefined;
    const alwaysGranted = boolField(rules, rules.alwaysGranted, false, "SW.AlwaysGranted", "AlwaysGranted");
    const failures: AresSuperWeaponAvailabilityFailure[] = [];

    if (context.defeated === true) failures.push("defeated");
    if (hasAny(forbiddenHouses, [normalize(context.countryId ?? "")]) ||
        forbiddenHouses.has("all")) {
        failures.push("forbidden-house");
    }
    if (!hasHouse(requiredHouses, context.countryId)) failures.push("missing-required-house");
    if (context.isAi && !boolField(rules, rules.allowAI, true, "SW.AllowAI", "AllowAI")) {
        failures.push("ai-not-allowed");
    }
    if (!context.isAi && !boolField(rules, rules.allowPlayer, true, "SW.AllowPlayer", "AllowPlayer")) {
        failures.push("player-not-allowed");
    }
    if (auxBuildings.length && !hasAny(ownedBuildings, auxBuildings)) {
        failures.push("missing-aux-building");
    }
    if (hasAny(ownedBuildings, negBuildings)) failures.push("has-negative-building");
    if (shotsLimit >= 0 && shotsFired >= shotsLimit) failures.push("shot-limit");
    if (!alwaysGranted && !providerBuildingPresent) failures.push("missing-provider-building");

    return {
        available: failures.length === 0,
        reasons: failures,
        failures,
        providerBuildingPresent,
        shotsLimit,
        shotsRemaining,
    };
}

/**
 * Build the common availability context from a live owner without teaching
 * the evaluator about Player or Building classes. This is the single runtime
 * adapter used by grants, removal, UI-facing inventory, and activation gates.
 */
export function evaluateAresSuperWeaponAvailabilityForOwner(
    rules: AresSuperWeaponAvailabilityRules,
    owner: AresSuperWeaponOwnerLike,
    superWeaponName: string,
    shotsFired = 0,
): AresSuperWeaponAvailabilityResult {
    const buildings = owner.getOwnedObjectsByType
        ? [...owner.getOwnedObjectsByType(ObjectType.Building)]
        : [...(owner.buildings ?? [])];
    const expectedSuperWeapon = normalize(superWeaponName);
    const buildingName = (building: { name?: string; rules?: { name?: string } }): string | undefined =>
        building.name ?? building.rules?.name;
    const providerBuildings = buildings.filter((building) =>
        buildingProvidesAresSuperWeapon(building, expectedSuperWeapon));

    return evaluateAresSuperWeaponAvailability(rules, {
        countryId: owner.country?.id ?? owner.country?.name,
        isAi: owner.isAi === true,
        defeated: owner.defeated === true,
        ownedBuildingTypes: buildings.map(buildingName).filter((name): name is string => !!name),
        ownedProviderBuildingTypes: providerBuildings
            .map(buildingName)
            .filter((name): name is string => !!name),
        shotsFired,
    });
}

/** Generic name for consumers that do not need the Ares-prefixed adapter name. */
export const evaluateSuperWeaponAvailability = evaluateAresSuperWeaponAvailability;
