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

/**
 * Normalized prerequisite nodes. A reference is resolved against the loaded
 * generic prerequisite registry at evaluation time, so the same parsed rule
 * set can be shared by production, UI, and AI consumers.
 */
export type PrerequisiteExpression =
    | { type: "reference"; id: string }
    | { type: "all"; children: PrerequisiteExpression[] }
    | { type: "any"; children: PrerequisiteExpression[] }
    | { type: "not"; child: PrerequisiteExpression }
    | { type: "theater"; allowed: string[] }
    | { type: "stolen-tech"; required: number[] };

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
    /** Complete normalized expression for shared prerequisite consumers. */
    expression?: PrerequisiteExpression;
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

function all(children: PrerequisiteExpression[]): PrerequisiteExpression {
    return { type: "all", children };
}

function any(children: PrerequisiteExpression[]): PrerequisiteExpression {
    return { type: "any", children };
}

function buildExpression(
    alternativeLists: readonly string[][],
    negative: readonly string[],
    requiredTheaters: readonly string[],
    stolenTechs: readonly number[],
): PrerequisiteExpression {
    const alternatives = alternativeLists.map(list =>
        all(list.map(id => ({ type: "reference", id }) as PrerequisiteExpression)));
    const children: PrerequisiteExpression[] = [
        alternatives.length === 1 ? alternatives[0] : any(alternatives),
        ...negative.map(id => ({
            type: "not",
            child: { type: "reference", id },
        }) as PrerequisiteExpression),
    ];
    if (requiredTheaters.length) {
        children.push({ type: "theater", allowed: [...requiredTheaters] });
    }
    if (stolenTechs.length) {
        children.push({ type: "stolen-tech", required: [...stolenTechs] });
    }
    return all(children);
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
        const key = `Prerequisite.List${i}`;
        // A missing numbered list is not an empty alternative. Treating it as
        // one would make every object buildable when a declared list is
        // omitted, because an empty AND expression is always true.
        if (section.has(key)) {
            alternativeLists.push(normalizeList(section.getArray(key)));
        }
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
        expression: buildExpression(
            alternativeLists,
            normalizeList(section.getArray("Prerequisite.Negative")),
            normalizeList(section.getArray("Prerequisite.RequiredTheaters")),
            stolenTechs,
        ),
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

function evaluateExpression(
    expression: PrerequisiteExpression,
    context: PrerequisiteEvaluationContext,
    owned: ReadonlySet<string>,
): boolean {
    switch (expression.type) {
        case "reference":
            return satisfiesToken(expression.id, context, owned);
        case "all":
            return expression.children.every(child => evaluateExpression(child, context, owned));
        case "any":
            return expression.children.some(child => evaluateExpression(child, context, owned));
        case "not":
            return !evaluateExpression(expression.child, context, owned);
        case "theater":
            return context.theater !== undefined &&
                expression.allowed.includes(normalizePrerequisiteId(context.theater));
        case "stolen-tech": {
            const stolen = new Set(
                [...(context.stolenTechs ?? [])].map(value =>
                    typeof value === "number" ? Math.trunc(value) : Number(value),
                ),
            );
            return expression.required.every(value => stolen.has(value));
        }
    }
}

/** Evaluates one parsed rule set against a deterministic player snapshot. */
export function evaluateAresPrerequisiteRules(
    rules: PrerequisiteRuleSet,
    context: PrerequisiteEvaluationContext,
): boolean {
    const owned = new Set([...context.ownedObjectNames].map(normalizePrerequisiteId));
    // Keep callers that construct a legacy snapshot manually source-compatible
    // while all INI-parsed rules retain their normalized expression tree.
    const expression = rules.expression ?? buildExpression(
        rules.alternativeLists,
        rules.negative,
        rules.requiredTheaters,
        rules.stolenTechs,
    );
    return evaluateExpression(expression, context, owned);
}
