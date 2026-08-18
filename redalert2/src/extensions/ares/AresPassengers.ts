export type AresPassengerIniValue = string | string[];

export interface AresPassengerSectionLike {
    entries: ReadonlyMap<string, AresPassengerIniValue>;
}

/**
 * Normalized passenger/transport data needed by Ares features.
 *
 * InfantryAbsorb/UnitAbsorb are YR host capabilities, but Ares Operator and
 * InitialPayload explicitly depend on them for BuildingTypes, so they live in
 * this normalized compatibility boundary with the Ares passenger extensions.
 */
export interface AresPassengerRules {
    /** If non-empty, only these TechnoTypes may enter. */
    allowedTypes: readonly string[];
    /** These TechnoTypes may never enter, even if also present in Allowed. */
    disallowedTypes: readonly string[];
    /** Ares default: passenger Size consumes capacity. false means one seat each. */
    bySize: boolean;
    /** Building host accepts InfantryTypes as passengers. */
    infantryAbsorb: boolean;
    /** Building host accepts VehicleTypes as passengers. */
    unitAbsorb: boolean;
    /** Player-facing manual unload suppression; scripted/forced unload is separate. */
    noManualUnload: boolean;
    /** Cursor/manual-entry suppression only; scripts and AI may still enter. */
    noManualEnter: boolean;
    /** Authored initial-payload types. Runtime creation is certified separately. */
    initialPayloadTypes: readonly string[];
    /** Expanded one-to-one counts for initialPayloadTypes. */
    initialPayloadCounts: readonly number[];
    /** Ares promotion propagation flag. Runtime promotion is certified separately. */
    promoteIncludePassengers: boolean;
}

const passengerRulesByTechnoRules = new WeakMap<object, AresPassengerRules>();

function normalizeKey(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function findEntry(section: AresPassengerSectionLike, expectedKey: string): AresPassengerIniValue | undefined {
    const expected = normalizeKey(expectedKey);
    let result: AresPassengerIniValue | undefined;
    for (const [key, value] of section.entries) {
        if (normalizeKey(key) === expected) result = value;
    }
    return result;
}

function valuesOf(value: AresPassengerIniValue | undefined): string[] {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value])
        .flatMap((item) => item.split(","))
        .map((item) => item.trim())
        .filter(Boolean);
}

function scalar(value: AresPassengerIniValue | undefined): string | undefined {
    return valuesOf(value)[0];
}

function parseBool(value: AresPassengerIniValue | undefined, defaultValue: boolean): boolean {
    const text = scalar(value)?.toLocaleLowerCase("en-US");
    if (text === undefined) return defaultValue;
    if (["yes", "true", "1"].includes(text)) return true;
    if (["no", "false", "0"].includes(text)) return false;
    return defaultValue;
}

function parseCount(value: string | undefined, defaultValue = 1): number {
    if (value === undefined || !/^[+-]?\d+$/.test(value)) return defaultValue;
    const count = Number(value);
    return Number.isSafeInteger(count) ? Math.max(0, count) : defaultValue;
}

function expandInitialPayloadCounts(types: readonly string[], authored: readonly string[]): number[] {
    if (!types.length) return [];
    if (!authored.length) return types.map(() => 1);
    const parsed = authored.map((value) => parseCount(value, 1));
    const last = parsed[parsed.length - 1] ?? 1;
    return types.map((_, index) => parsed[index] ?? last);
}

export function parseAresPassengerRules(section: AresPassengerSectionLike): AresPassengerRules {
    const initialPayloadTypes = valuesOf(findEntry(section, "InitialPayload.Types"));
    const authoredCounts = valuesOf(findEntry(section, "InitialPayload.Nums"));
    return {
        allowedTypes: valuesOf(findEntry(section, "Passengers.Allowed")),
        disallowedTypes: valuesOf(findEntry(section, "Passengers.Disallowed")),
        bySize: parseBool(findEntry(section, "Passengers.BySize"), true),
        infantryAbsorb: parseBool(findEntry(section, "InfantryAbsorb"), false),
        unitAbsorb: parseBool(findEntry(section, "UnitAbsorb"), false),
        noManualUnload: parseBool(findEntry(section, "NoManualUnload"), false),
        noManualEnter: parseBool(findEntry(section, "NoManualEnter"), false),
        initialPayloadTypes,
        initialPayloadCounts: expandInitialPayloadCounts(initialPayloadTypes, authoredCounts),
        promoteIncludePassengers: parseBool(findEntry(section, "Promote.IncludePassengers"), false),
    };
}

export function hasAuthoredAresPassengerRules(section: AresPassengerSectionLike): boolean {
    const keys = new Set([...section.entries.keys()].map(normalizeKey));
    return [
        "passengers.allowed",
        "passengers.disallowed",
        "passengers.bysize",
        "infantryabsorb",
        "unitabsorb",
        "nomanualunload",
        "nomanualenter",
        "initialpayload.types",
        "initialpayload.nums",
        "promote.includepassengers",
    ].some((key) => keys.has(key));
}

/** Attach normalized definition data to a TechnoRules instance without making
 * the shared base rules class depend on an Ares-specific field layout. */
export function registerAresPassengerRules(
    technoRules: object,
    section: AresPassengerSectionLike,
): AresPassengerRules | undefined {
    if (!hasAuthoredAresPassengerRules(section)) {
        passengerRulesByTechnoRules.delete(technoRules);
        return undefined;
    }
    const rules = parseAresPassengerRules(section);
    passengerRulesByTechnoRules.set(technoRules, rules);
    return rules;
}

export function getAresPassengerRules(technoRules: object | undefined): AresPassengerRules | undefined {
    return technoRules ? passengerRulesByTechnoRules.get(technoRules) : undefined;
}

function normalizeTypeId(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

/** Ares Specific Passengers precedence: Disallowed wins; a non-empty Allowed
 * list becomes an allow-list; otherwise any type passes this extension gate. */
export function isAresPassengerTypeAllowed(
    rules: AresPassengerRules | undefined,
    passengerTypeId: string,
): boolean {
    if (!rules) return true;
    const passenger = normalizeTypeId(passengerTypeId);
    const disallowed = rules.disallowedTypes.some((type) => normalizeTypeId(type) === passenger);
    if (disallowed) return false;
    if (!rules.allowedTypes.length) return true;
    return rules.allowedTypes.some((type) => normalizeTypeId(type) === passenger);
}

export function isAresBuildingPassengerClassAllowed(
    rules: AresPassengerRules | undefined,
    passenger: { isInfantry?(): boolean; isVehicle?(): boolean },
): boolean {
    if (!rules) return false;
    if (passenger.isInfantry?.()) return rules.infantryAbsorb;
    if (passenger.isVehicle?.()) return rules.unitAbsorb;
    return false;
}

export function getAresPassengerCapacityCost(
    rules: AresPassengerRules | undefined,
    passengerSize: number,
): number {
    return rules?.bySize === false ? 1 : Math.max(0, passengerSize);
}
