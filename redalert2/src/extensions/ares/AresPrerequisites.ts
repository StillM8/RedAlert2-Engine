/**
 * Data-driven prerequisite support for the Ares extension runtime.
 *
 * The vanilla engine has one comma-separated `Prerequisite` list. Ares adds
 * alternative lists, negative prerequisites, custom generic groups, and
 * prerequisites that can be satisfied by non-building objects. Keep the
 * parsed representation independent from Production so other producers (AI,
 * map scripts, and UI) can use the same evaluator.
 */

export interface PrerequisiteSection {
    has(key: string): boolean;
    getArray(key: string): string[];
    getNumber(key: string, defaultValue?: number): number;
    getNumberArray(key: string): number[];
    entries?: Map<string, unknown>;
}

export interface PrerequisiteRuleSet {
    /** Each list is an AND expression; any complete list satisfies the rule. */
    alternativeLists: string[][];
    negative: string[];
    requiredTheaters: string[];
    stolenTechs: number[];
    /** Countries whose factory plans may produce this object. */
    factoryOwners: string[];
    /** Countries whose factory plans may not produce this object. */
    factoryOwnersForbidden: string[];
}

export interface PrerequisiteEvaluationContext {
    ownedObjectNames: Iterable<string>;
    genericGroups?: ReadonlyMap<string, readonly string[]>;
    genericAlternates?: ReadonlyMap<string, readonly string[]>;
    stolenTechs?: Iterable<number | string>;
    theater?: string;
}

export function normalizePrerequisiteId(value: string): string {
    return value.trim().toUpperCase();
}

/**
 * Ares uses the factory's initial country, rather than the country that
 * currently owns a captured factory, for FactoryOwners restrictions. The
 * caller supplies that stable identity when it is available and may fall
 * back to the current owner for legacy objects created before this metadata
 * was introduced.
 */
export function isFactoryOwnerAllowed(
    factoryOwnerId: string | undefined,
    allowedOwners: Iterable<string> = [],
    forbiddenOwners: Iterable<string> = [],
): boolean {
    const owner = factoryOwnerId ? normalizePrerequisiteId(factoryOwnerId) : "";
    const forbidden = new Set([...forbiddenOwners].map(normalizePrerequisiteId));
    if (owner && forbidden.has(owner)) return false;

    const allowed = [...allowedOwners]
        .map(normalizePrerequisiteId)
        .filter(Boolean);
    return allowed.length === 0 ? true : !!owner && allowed.includes(owner);
}

function normalizeList(values: Iterable<string>): string[] {
    return [...values]
        .map(normalizePrerequisiteId)
        .filter(Boolean);
}

/**
 * Parses the Ares prerequisite extensions while preserving vanilla syntax.
 * `Prerequisite.List0` intentionally takes precedence over `Prerequisite`, as
 * documented by Ares. The plural `Prerequisites` key is supported for custom
 * generic groups used by Ares-era rulesets.
 */
export function parseAresPrerequisiteRules(section: PrerequisiteSection): PrerequisiteRuleSet {
    const alternativeLists: string[][] = [];
    const hasList0 = section.has("Prerequisite.List0");
    const baseList = hasList0
        ? section.getArray("Prerequisite.List0")
        : section.has("Prerequisite")
            ? section.getArray("Prerequisite")
            : section.getArray("Prerequisites");
    alternativeLists.push(normalizeList(baseList));

    const declaredExtraLists = Math.max(0, section.getNumber("Prerequisite.Lists", 0));
    let highestList = declaredExtraLists;
    for (const key of section.entries?.keys() ?? []) {
        const match = /^Prerequisite\.List(\d+)$/i.exec(key);
        if (match) highestList = Math.max(highestList, Number(match[1]));
    }
    for (let i = 1; i <= highestList; i++) {
        alternativeLists.push(normalizeList(section.getArray(`Prerequisite.List${i}`)));
    }

    const stolenTechValues = section.getNumberArray("Prerequisite.StolenTechs")
        .map(value => Math.trunc(value));
    const stolenTechs = stolenTechValues.includes(-1)
        ? []
        : stolenTechValues.filter(value => Number.isFinite(value) && value >= 0);

    return {
        alternativeLists,
        negative: normalizeList(section.getArray("Prerequisite.Negative")),
        requiredTheaters: normalizeList(section.getArray("Prerequisite.RequiredTheaters")),
        stolenTechs,
        factoryOwners: normalizeList(section.getArray("FactoryOwners")),
        factoryOwnersForbidden: normalizeList(section.getArray("FactoryOwners.Forbidden")),
    };
}

function hasOwnedName(ownedObjectNames: ReadonlySet<string>, name: string): boolean {
    return ownedObjectNames.has(normalizePrerequisiteId(name));
}

function satisfiesToken(token: string, context: PrerequisiteEvaluationContext, owned: ReadonlySet<string>): boolean {
    const normalizedToken = normalizePrerequisiteId(token);
    const genericGroup = context.genericGroups?.get(normalizedToken);
    if (!genericGroup) {
        return hasOwnedName(owned, normalizedToken);
    }

    if (genericGroup.some(name => hasOwnedName(owned, name))) {
        return true;
    }

    // Ares allows a generic group to be satisfied by alternate TechnoTypes,
    // for example an undeployed refinery vehicle satisfying the PROC group.
    const alternates = context.genericAlternates?.get(normalizedToken) ?? [];
    return alternates.some(name => hasOwnedName(owned, name));
}

/** Evaluates one parsed rule set against a deterministic player snapshot. */
export function evaluateAresPrerequisiteRules(
    rules: PrerequisiteRuleSet,
    context: PrerequisiteEvaluationContext,
): boolean {
    const owned = new Set([...context.ownedObjectNames].map(normalizePrerequisiteId));

    if (rules.negative.some(name => owned.has(normalizePrerequisiteId(name)))) {
        return false;
    }

    if (rules.requiredTheaters.length) {
        if (context.theater === undefined) return false;
        const theater = normalizePrerequisiteId(context.theater);
        if (!rules.requiredTheaters.includes(theater)) return false;
    }

    if (rules.stolenTechs.length) {
        const stolen = new Set(
            [...(context.stolenTechs ?? [])].map(value =>
                typeof value === "number" ? Math.trunc(value) : Number(value),
            ),
        );
        if (rules.stolenTechs.some(value => !stolen.has(value))) {
            return false;
        }
    }

    // An empty prerequisite list is the vanilla "no prerequisite" case and
    // is also the documented Ares behavior when a list is explicitly empty.
    return rules.alternativeLists.some(list =>
        list.every(token => satisfiesToken(token, context, owned)),
    );
}
