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
}

export interface PrerequisiteRuleSet {
    /** Each list is an AND expression; any complete list satisfies the rule. */
    alternativeLists: string[][];
    negative: string[];
    requiredTheaters: string[];
    stolenTechs: number[];
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
    for (let i = 1; i <= 32; i++) {
        if (section.has(`Prerequisite.List${i}`)) {
            highestList = Math.max(highestList, i);
        }
    }
    for (let i = 1; i <= highestList; i++) {
        alternativeLists.push(normalizeList(section.getArray(`Prerequisite.List${i}`)));
    }

    return {
        alternativeLists,
        negative: normalizeList(section.getArray("Prerequisite.Negative")),
        requiredTheaters: normalizeList(section.getArray("Prerequisite.RequiredTheaters")),
        stolenTechs: section.getNumberArray("Prerequisite.StolenTechs")
            .map(value => Math.trunc(value))
            .filter(value => Number.isFinite(value)),
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

    if (rules.requiredTheaters.length && context.theater !== undefined) {
        const theater = normalizePrerequisiteId(context.theater);
        if (!rules.requiredTheaters.includes(theater)) {
            return false;
        }
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

