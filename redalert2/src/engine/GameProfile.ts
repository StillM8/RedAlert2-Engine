import { EngineType } from "./EngineType";
import { gamePathKey, tryNormalizeGamePath } from "./GamePath";

export type GameProfileId = "ra2" | "yr" | "mental-omega";

export interface GameProfileDescriptor {
    id: GameProfileId;
    engine: EngineType;
    displayName: string;
    requiredFiles: string[];
    filenameAliases?: Map<string, string>;
    extraMixPrefixes?: string[];
    companionMixFiles?: string[];
}

const mentalOmegaAliases = new Map<string, string>([
    ["rulesmd.ini", "rulesmo.ini"],
    ["artmd.ini", "artmo.ini"],
    ["aimd.ini", "aimo.ini"],
    ["battlemd.ini", "battlemo.ini"],
    ["desertmd.ini", "desertmo.ini"],
    ["evamd.ini", "evamo.ini"],
    ["lunarmd.ini", "lunarmo.ini"],
    ["mapselmd.ini", "mapselmo.ini"],
    ["missionmd.ini", "missionmo.ini"],
    ["snowmd.ini", "snowmo.ini"],
    ["soundmd.ini", "soundmo.ini"],
    ["thememd.ini", "thememo.ini"],
    ["temperatmd.ini", "temperatmo.ini"],
    ["urbanmd.ini", "urbanmo.ini"],
    ["urbannmd.ini", "urbannmo.ini"],
]);

export const GAME_PROFILES: Record<GameProfileId, GameProfileDescriptor> = {
    ra2: {
        id: "ra2",
        engine: EngineType.RedAlert2,
        displayName: "Red Alert 2",
        requiredFiles: ["language.mix", "multi.mix", "ra2.mix"],
    },
    yr: {
        id: "yr",
        engine: EngineType.YurisRevenge,
        displayName: "Yuri's Revenge",
        requiredFiles: ["language.mix", "multi.mix", "ra2.mix", "langmd.mix", "multimd.mix", "ra2md.mix"],
    },
    "mental-omega": {
        id: "mental-omega",
        engine: EngineType.YurisRevenge,
        displayName: "Mental Omega",
        requiredFiles: ["language.mix", "multi.mix", "ra2.mix", "langmd.mix", "multimd.mix", "ra2md.mix"],
        filenameAliases: mentalOmegaAliases,
        extraMixPrefixes: ["ecache", "expandmo", "expand", "elocal"],
        companionMixFiles: ["mapsmo03.mix", "multimo.mix", "movmo03.mix"],
    },
};

export function getGameProfile(id: GameProfileId | undefined): GameProfileDescriptor {
    return GAME_PROFILES[id ?? "ra2"];
}

export function isGameProfileId(value: string | null | undefined): value is GameProfileId {
    return value === "ra2" || value === "yr" || value === "mental-omega";
}

/**
 * MO releases use different expandmo numbers. The archive plus either the
 * loose MapsMO tree or one of the MO companion archives is the signature that
 * distinguishes a complete MO installation from ordinary Yuri's Revenge.
 */
export function hasMentalOmegaSignature(paths: Iterable<string>): boolean {
    let hasExpandArchive = false;
    let hasMoContent = false;
    for (const path of paths) {
        const normalized = tryNormalizeGamePath(path);
        if (!normalized) {
            continue;
        }
        const key = gamePathKey(normalized);
        const leaf = key.split("/").pop()!;
        if (/^expandmo\d{2}\.mix$/i.test(leaf)) {
            hasExpandArchive = true;
        }
        if (key.startsWith("mapsmo/") || /^(mapsmo\d+|multimo|movmo\d+)\.mix$/i.test(leaf)) {
            hasMoContent = true;
        }
        if (hasExpandArchive && hasMoContent) {
            return true;
        }
    }
    return false;
}

export function detectGameProfile(paths: Iterable<string>): GameProfileId {
    const normalizedPaths = [...paths].map(tryNormalizeGamePath).filter((path): path is string => !!path);
    if (hasMentalOmegaSignature(normalizedPaths)) {
        return "mental-omega";
    }
    const keys = new Set(normalizedPaths.map(gamePathKey));
    return GAME_PROFILES.yr.requiredFiles.every((file) => keys.has(gamePathKey(file))) ? "yr" : "ra2";
}
