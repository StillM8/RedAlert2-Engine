import type { CampaignLaunch as CatalogCampaignLaunch } from "@/campaign/CampaignTypes";

export interface CampaignSession {
    campaignId?: string;
    battleId?: string;
    missionId?: string;
    scenario?: string;
    mapName?: string;
    mapFile?: string;
    playerHouse?: string;
    side?: number | string;
    sideName?: string;
    playerName?: string;
    difficulty?: number | string;
    buildOffAlly?: boolean;
    globalVariables?: Record<string, boolean | number>;
    alternateStartLocation?: boolean;
    alternateNextScenario?: boolean;
    nextScenario?: string;
    altNextScenario?: string;
    endOfGame?: boolean;
    skipScore?: boolean;
    oneTimeOnly?: boolean;
    ignoreGlobalAITriggers?: boolean;
    fixedAlliance?: boolean;
    [key: string]: unknown;
}
export interface CampaignLaunchOptions extends CampaignSession {
    session?: CampaignSession;
}
export type CampaignGameOptions = CatalogCampaignLaunch | CampaignLaunchOptions | CampaignSession;
export type CampaignLaunch = CatalogCampaignLaunch | CampaignLaunchOptions;
export type CampaignRuntimeSession = CampaignSession;
function isLaunchLike(value: Record<string, any>): boolean {
    return value.kind === "campaign-launch" ||
        (typeof value.battleId === "string" && typeof value.mapFile === "string" && typeof value.scenario === "string");
}
function sessionFromLaunch(value: Record<string, any>): CampaignSession {
    return {
        ...value,
        campaignId: value.campaignId ?? value.battleId,
        missionId: value.missionId ?? value.scenario,
        mapName: value.mapName ?? value.mapFile,
        playerHouse: value.playerHouse ?? value.sideName ?? (typeof value.side === "string" ? value.side : undefined),
        difficulty: value.difficulty,
        nextScenario: value.nextScenario,
        altNextScenario: value.altNextScenario,
    };
}
export function getCampaignSession(value: unknown): CampaignSession | undefined {
    if (value === true) {
        return {};
    }
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const candidate = value as Record<string, any>;
    if (isLaunchLike(candidate)) {
        return sessionFromLaunch(candidate);
    }
    const nested = candidate.campaignLaunch ?? candidate.session ?? candidate.campaignSession ?? candidate.campaign;
    if (nested && typeof nested === "object") {
        const nestedSession = getCampaignSession(nested);
        return nestedSession ? { ...nestedSession, ...candidate } : undefined;
    }
    if (candidate.campaignId || candidate.battleId || candidate.missionId || candidate.playerHouse ||
        candidate.scenario || candidate.nextScenario || candidate.altNextScenario) {
        return candidate as CampaignSession;
    }
    return undefined;
}
export function isCampaignGameOpts(value: unknown): boolean {
    if (value === true) {
        return true;
    }
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Record<string, any>;
    return Boolean(
        candidate.isCampaign ||
        candidate.campaignLaunch ||
        candidate.campaign ||
        candidate.campaignSession ||
        isLaunchLike(candidate) ||
        getCampaignSession(candidate.session),
    );
}
export function isHumanPlayerInfo(info: any): boolean {
    return Boolean(info && typeof info === "object" && "name" in info);
}
export enum AiDifficulty {
    Brutal = 0,
    Medium = 1,
    Easy = 2,
    MediumSea = 3,
    Normal = 4,
    Custom = 5,
}
export interface HumanPlayerInfo {
    name: string;
    countryId: number;
    colorId: number;
    startPos: number;
    teamId: number;
}
export interface AiPlayerInfo {
    difficulty: AiDifficulty;
    customBotId?: string;
    countryId: number;
    colorId: number;
    startPos: number;
    teamId: number;
}
export interface GameOpts {
    gameMode: number;
    gameSpeed: number;
    credits: number;
    unitCount: number;
    shortGame: boolean;
    superWeapons: boolean;
    buildOffAlly: boolean;
    mcvRepacks: boolean;
    cratesAppear: boolean;
    hostTeams?: boolean;
    destroyableBridges: boolean;
    multiEngineer: boolean;
    noDogEngiKills: boolean;
    mapName: string;
    mapTitle: string;
    mapDigest: string;
    mapSizeBytes: number;
    maxSlots: number;
    mapOfficial: boolean;
    humanPlayers: HumanPlayerInfo[];
    aiPlayers: (AiPlayerInfo | undefined)[];
    campaign?: CampaignGameOptions | boolean;
    session?: CampaignSession;
    campaignSession?: CampaignSession;
    isCampaign?: boolean;
    unknown?: string;
}
