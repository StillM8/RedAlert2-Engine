import { EngineType } from "./EngineType";

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
