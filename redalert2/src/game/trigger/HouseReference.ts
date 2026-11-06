import type { IniSection } from "@/data/IniSection";

export const TRIGGER_LOCATION_HOUSE_ID_BEGIN = 4475;

type HouseContext = {
    getAllPlayers?(): any[];
    playerList?: { getAll?(): any[] };
    rules?: any;
    map?: any;
};

function normalize(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function compact(value: unknown): string {
    return normalize(value).replace(/[^a-z0-9]/g, "");
}

function numericReference(value: unknown): number | undefined {
    const text = normalize(value);
    if (!/^[+-]?\d+$/.test(text)) {
        return undefined;
    }
    const numeric = Number(text);
    return Number.isSafeInteger(numeric) ? numeric : undefined;
}

function players(context: HouseContext): any[] {
    return context.getAllPlayers?.() ?? context.playerList?.getAll?.() ?? [];
}

function ruleIni(context: HouseContext): any {
    return context.rules?.getIni?.() ?? context.rules?.ini;
}

function section(context: HouseContext, name: string): IniSection | undefined {
    return ruleIni(context)?.getSection?.(name);
}

function ruleCountry(context: HouseContext, player: any): any {
    const id = player?.country?.id ?? player?.country?.name;
    if (!id) {
        return undefined;
    }
    try {
        return context.rules?.getCountry?.(id);
    } catch {
        return undefined;
    }
}

function numericHouseIndices(context: HouseContext, player: any): number[] {
    const countryId = normalize(player?.country?.id ?? player?.country?.name);
    const indices = new Set<number>();
    const add = (value: unknown) => {
        const numeric = numericReference(value);
        if (numeric !== undefined && numeric >= 0) {
            indices.add(numeric);
        }
    };
    const countryRules = ruleCountry(context, player);
    if (Number(countryRules?.listIndex) < 100) {
        add(countryRules?.listIndex);
    }
    add(countryRules?.order);
    add(countryRules?.networkIndex);
    try {
        const multiplayerIndex = context.rules
            ?.getMultiplayerCountries?.()
            ?.findIndex((entry: any) => normalize(entry?.id) === countryId) ?? -1;
        add(multiplayerIndex);
    } catch {
    }
    for (const listName of ["Countries", "Houses"]) {
        const list = section(context, listName);
        if (!list) {
            continue;
        }
        for (const [key, raw] of list.entries) {
            const value = Array.isArray(raw) ? raw.join(",") : raw;
            if (compact(value) === compact(countryId)) {
                add(key);
            }
        }
    }
    if (player?.startLocation !== undefined) {
        add(player.startLocation);
        add(TRIGGER_LOCATION_HOUSE_ID_BEGIN + Number(player.startLocation));
    }
    return [...indices].sort((a, b) => a - b);
}

function playerTokens(context: HouseContext, player: any): Set<string> {
    const tokens = new Set<string>();
    const add = (value: unknown) => {
        const normalized = normalize(value);
        if (normalized) {
            tokens.add(normalized);
            tokens.add(compact(value));
        }
    };
    add(player?.country?.id);
    add(player?.country?.name);
    add(player?.country?.uiName);
    add(player?.country?.sideId);
    add(player?.name);
    const countryRules = ruleCountry(context, player);
    add(countryRules?.id);
    add(countryRules?.name);
    add(countryRules?.uiName);
    if (player?.isNeutral || player?.country?.isNeutral?.()) {
        add("neutral");
        add("civilian");
    }
    for (const index of numericHouseIndices(context, player)) {
        add(String(index));
    }
    return tokens;
}

export function isAnyHouseReference(reference: unknown): boolean {
    return numericReference(reference) === -1;
}

export function canonicalizeHouseReference(reference: unknown): string {
    const numeric = numericReference(reference);
    if (numeric !== undefined) {
        return String(numeric);
    }
    const normalized = normalize(reference);
    if (["<none>", "none"].includes(normalized)) {
        return "none";
    }
    if (["@@neutral@@", "neutral", "civilian"].includes(normalized)) {
        return "neutral";
    }
    return compact(reference);
}

export function houseReferenceMatches(context: HouseContext, player: any, reference: unknown): boolean {
    const numeric = numericReference(reference);
    if (numeric === -1) {
        return false;
    }
    if (numeric !== undefined && numeric >= TRIGGER_LOCATION_HOUSE_ID_BEGIN) {
        const locationIndex = numeric - TRIGGER_LOCATION_HOUSE_ID_BEGIN;
        return Number(player?.startLocation) === locationIndex;
    }
    const tokens = playerTokens(context, player);
    const normalized = normalize(reference);
    const compacted = compact(reference);
    if (tokens.has(normalized) || tokens.has(compacted)) {
        return true;
    }
    if (numeric === undefined) {
        return false;
    }
    return numericHouseIndices(context, player).includes(numeric);
}

export function resolveHousePlayer(context: HouseContext, reference: unknown): any | undefined {
    return players(context).find((player) => houseReferenceMatches(context, player, reference));
}

export function resolveHousePlayers(context: HouseContext, reference: unknown): any[] {
    if (isAnyHouseReference(reference)) {
        return players(context);
    }
    return players(context).filter((player) => houseReferenceMatches(context, player, reference));
}

export function resolveTriggerHousePlayer(context: HouseContext, trigger: any): any | undefined {
    return resolveHousePlayer(context, trigger?.houseName);
}
