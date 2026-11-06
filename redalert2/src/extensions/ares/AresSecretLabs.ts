import { fnv32aStrings } from "@/util/math";

/**
 * Ares `SecretLab` support.
 *
 * A secret lab is a capturable building that grants the capturing house a
 * randomly chosen bonus. Authoring lives in `[General]`:
 *
 *   SecretLab.PossibleBoons=<boon>,<boon>,...
 *   SecretLab.GenerateOnCapture=yes|no
 *   Secret.RequiredHouses=<house>,...
 *   Secret.ForbiddenHouses=<house>,...
 *
 * Boon entries are `<Kind>[:argument]`. `Kind` is case-insensitive; an
 * unrecognized kind is preserved verbatim so a target mod's custom boon stays
 * visible in diagnostics instead of being silently dropped.
 */
export type AresSecretLabBoonKind =
    | "money"
    | "infantry"
    | "vehicle"
    | "aircraft"
    | "building"
    | "unit"
    | "veterancy"
    | "reveal"
    | "unknown";

export interface AresSecretLabBoon {
    kind: AresSecretLabBoonKind;
    /** Raw kind token, preserved so unknown boons remain diagnosable. */
    rawKind: string;
    /** The argument after the first colon, or the whole token when absent. */
    argument: string;
    /** Optional numeric payload (money amount, veterancy level, ...). */
    number?: number;
    /** Stable text used by the lockstep hash and by canonical ordering. */
    id: string;
}

export interface AresSecretLabRules {
    boons: AresSecretLabBoon[];
    generateOnCapture: boolean;
    requiredHouses: string[];
    forbiddenHouses: string[];
}

export const ARES_SECRET_LAB_RULES_VERSION = 1 as const;

const DEFAULT_BOON_MONEY = 10000;

function normalize(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function splitList(value: string): string[] {
    return String(value ?? "")
        .split(/[,\s]+/)
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
}

function classify(rawKind: string): AresSecretLabBoonKind {
    switch (normalize(rawKind)) {
        case "money":
            return "money";
        case "infantry":
            return "infantry";
        case "vehicle":
            return "vehicle";
        case "aircraft":
            return "aircraft";
        case "building":
            return "building";
        case "unit":
            return "unit";
        case "veterancy":
            return "veterancy";
        case "reveal":
            return "reveal";
        default:
            return "unknown";
    }
}

/**
 * Parses one boon token. Ares accepts both `Kind:argument` and a bare argument
 * (for example a money amount), so a token with no colon is treated according
 * to whether it is numeric.
 */
export function parseAresSecretLabBoon(token: string): AresSecretLabBoon {
    const raw = String(token ?? "").trim();
    if (!raw) {
        throw new Error("Invalid Ares secret lab boon: empty entry");
    }
    const separator = raw.indexOf(":");
    const rawKind = separator === -1 ? raw : raw.slice(0, separator);
    const argument = separator === -1 ? "" : raw.slice(separator + 1).trim();
    let kind = classify(rawKind);
    let resolvedArgument = argument;
    if (kind === "unknown" && separator === -1 && Number.isFinite(Number(raw))) {
        // A bare number is a money amount, matching Ares' default boon form.
        kind = "money";
        resolvedArgument = raw;
    }
    const numeric = Number(resolvedArgument);
    const number = Number.isFinite(numeric) && resolvedArgument !== "" ? numeric : undefined;
    return {
        kind,
        rawKind: rawKind.trim(),
        argument: resolvedArgument,
        ...(number === undefined ? {} : { number }),
        id: `${normalize(rawKind)}:${resolvedArgument}`.toLocaleLowerCase("en-US"),
    };
}

export function parseAresSecretLabRules(section: {
    getArray?(key: string): readonly string[] | undefined;
    getBool?(key: string, fallback?: boolean): boolean;
}): AresSecretLabRules {
    const boons = (section.getArray?.("SecretLab.PossibleBoons") ?? [])
        .flatMap(entry => String(entry).split(","))
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0)
        .map(parseAresSecretLabBoon);
    return {
        boons,
        // Ares defaults this to yes: a captured secret lab pays out.
        generateOnCapture: section.getBool?.("SecretLab.GenerateOnCapture", true) ?? true,
        requiredHouses: (section.getArray?.("Secret.RequiredHouses") ?? []).map(normalize).filter(Boolean),
        forbiddenHouses: (section.getArray?.("Secret.ForbiddenHouses") ?? []).map(normalize).filter(Boolean),
    };
}

export function validateAresSecretLabRules(state: unknown): AresSecretLabRules {
    if (!state || typeof state !== "object") {
        throw new Error("Invalid Ares secret lab rules state");
    }
    const candidate = state as AresSecretLabRules;
    if (!Array.isArray(candidate.boons) ||
        typeof candidate.generateOnCapture !== "boolean" ||
        !Array.isArray(candidate.requiredHouses) ||
        !Array.isArray(candidate.forbiddenHouses)) {
        throw new Error("Invalid Ares secret lab rules state");
    }
    for (const [index, boon] of candidate.boons.entries()) {
        if (!boon || typeof boon !== "object" || typeof boon.id !== "string" || !boon.id ||
            typeof boon.rawKind !== "string" || typeof boon.argument !== "string" ||
            (boon.number !== undefined && !Number.isFinite(boon.number))) {
            throw new Error(`Invalid Ares secret lab boon[${index}]`);
        }
    }
    return candidate;
}

export function captureAresSecretLabRules(rules: AresSecretLabRules): AresSecretLabRules {
    return validateAresSecretLabRules({
        boons: rules.boons.map(boon => ({ ...boon })),
        generateOnCapture: rules.generateOnCapture,
        requiredHouses: [...rules.requiredHouses],
        forbiddenHouses: [...rules.forbiddenHouses],
    });
}

/**
 * House eligibility. Ares treats an empty required list as "any house", and a
 * house named in both lists is ineligible (forbidden wins).
 */
export function isAresSecretLabHouseEligible(
    rules: AresSecretLabRules,
    houseTokens: readonly string[],
): boolean {
    const tokens = houseTokens.map(normalize).filter(Boolean);
    const label = tokens.join(" ");
    if (rules.forbiddenHouses.some(house => label.includes(house))) {
        return false;
    }
    if (rules.requiredHouses.length === 0) {
        return true;
    }
    return rules.requiredHouses.some(house => label.includes(house));
}

/** Canonical ordering so two peers index the same list identically. */
export function sortAresSecretLabBoons(boons: readonly AresSecretLabBoon[]): AresSecretLabBoon[] {
    return [...boons].sort((left, right) => left.id.localeCompare(right.id, "en-US"));
}

export function getAresSecretLabDefaultBoonMoney(): number {
    return DEFAULT_BOON_MONEY;
}

export function getAresSecretLabRulesHash(rules: AresSecretLabRules | undefined): number {
    if (!rules) {
        return 0;
    }
    return fnv32aStrings([
        "AresSecretLab",
        rules.generateOnCapture ? 1 : 0,
        ...sortAresSecretLabBoons(rules.boons).map(boon => boon.id),
        ...rules.requiredHouses.slice().sort(),
        ...rules.forbiddenHouses.slice().sort(),
    ]);
}
