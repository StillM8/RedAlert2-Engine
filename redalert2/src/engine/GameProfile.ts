import { EngineType } from "./EngineType";
import { gamePathKey, gamePathLeaf, tryNormalizeGamePath } from "./GamePath";

export type GameProfileId = "ra2" | "yr";

export interface GameProfileDescriptor {
    id: GameProfileId;
    engine: EngineType;
    displayName: string;
    requiredFiles: string[];
}

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
};

export function getGameProfile(id: GameProfileId | undefined): GameProfileDescriptor {
    return GAME_PROFILES[id ?? "ra2"];
}

export function isGameProfileId(value: string | null | undefined): value is GameProfileId {
    return value === "ra2" || value === "yr";
}

/**
 * Detect the vanilla game profile represented by a set of imported paths.
 *
 * The detector intentionally only knows about the two retail profiles on
 * this branch.  Paths may contain an imported directory prefix, but unsafe
 * entries are ignored so one malformed archive entry cannot make an
 * otherwise valid installation appear broken.
 */
export function detectGameProfile(paths: Iterable<string>): GameProfileId {
    const filenames = new Set<string>();

    for (const path of paths) {
        const normalized = tryNormalizeGamePath(path);
        if (!normalized) {
            continue;
        }
        filenames.add(gamePathKey(gamePathLeaf(normalized)));
    }

    const hasAll = (requiredFiles: readonly string[]) =>
        requiredFiles.every((file) => filenames.has(gamePathKey(file)));

    if (hasAll(GAME_PROFILES.yr.requiredFiles)) {
        return "yr";
    }
    return "ra2";
}
