import type { GameProfileDescriptor, GameProfileId } from "@/engine/GameProfile";
import type { CampaignFileNames } from "./CampaignTypes";

type FileGroup = keyof Pick<CampaignFileNames, "battle" | "mission" | "mapSelection" | "ui">;

const aliases: Record<GameProfileId, Record<FileGroup, string[]>> = {
    ra2: {
        battle: ["battle.ini", "battlemd.ini"],
        mission: ["mission.ini", "missionmd.ini", "missionmo.ini"],
        mapSelection: ["mapsel01.ini", "mapselmd.ini", "mapselmo.ini"],
        ui: ["ui.ini", "uimd.ini", "uimo.ini"],
    },
    yr: {
        battle: ["battlemd.ini", "battle.ini"],
        mission: ["missionmd.ini", "mission.ini"],
        mapSelection: ["mapselmd.ini", "mapsel01.ini"],
        ui: ["uimd.ini", "ui.ini", "uimo.ini"],
    },
    "mental-omega": {
        battle: ["battlemo.ini", "battlemd.ini", "battle.ini"],
        mission: ["missionmo.ini", "missionmd.ini", "mission.ini"],
        mapSelection: ["mapselmo.ini", "mapselmd.ini", "mapsel01.ini"],
        ui: ["uimd.ini", "ui.ini", "uimo.ini"],
    },
};

const allAliases: Record<FileGroup, string[]> = {
    battle: ["battle.ini", "battlemd.ini", "battlemo.ini"],
    mission: ["mission.ini", "missionmd.ini", "missionmo.ini"],
    mapSelection: ["mapsel01.ini", "mapselmd.ini", "mapselmo.ini"],
    ui: ["ui.ini", "uimd.ini", "uimo.ini"],
};

const canonicalNames: Record<FileGroup, string> = {
    battle: "battle.ini",
    mission: "mission.ini",
    mapSelection: "mapsel01.ini",
    ui: "ui.ini",
};

function profileId(profile: GameProfileId | GameProfileDescriptor | undefined): GameProfileId {
    if (!profile) {
        return "ra2";
    }
    return typeof profile === "string" ? profile : profile.id;
}

function unique(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const normalized = value.trim();
        if (!normalized) {
            continue;
        }
        const key = normalized.toLocaleLowerCase("en-US");
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(normalized);
    }
    return result;
}

function descriptorAliases(
    descriptor: GameProfileDescriptor | undefined,
    group: FileGroup,
): string[] {
    if (!descriptor) {
        return [];
    }
    const canonical = canonicalNames[group];
    const candidates = [
        descriptor.campaignFileNameOverrides?.[canonical],
        ...(group === "ui"
            ? [
                descriptor.fileNameOverrides?.["ui.ini"],
                descriptor.optionalFileNameOverrides?.["ui.ini"],
                descriptor.resolveCanonicalFile?.("ui.ini"),
            ]
            : []),
        ...(descriptor.campaignIniFiles ?? []),
        ...Object.values(descriptor.campaignFileNameOverrides ?? {}),
    ];
    const groupAliases = new Set(allAliases[group].map((value) => value.toLocaleLowerCase("en-US")));
    return candidates
        .filter((value): value is string => typeof value === "string")
        .filter((value) => {
            const leaf = value.replace(/\\/g, "/").split("/").pop()?.toLocaleLowerCase("en-US") ?? "";
            return groupAliases.has(leaf);
        });
}

export function getCampaignFileNames(profile: GameProfileId | GameProfileDescriptor = "ra2"): CampaignFileNames {
    const id = profileId(profile);
    const descriptor = typeof profile === "string" ? undefined : profile;
    const namesFor = (group: FileGroup): string[] => unique([
        ...descriptorAliases(descriptor, group),
        ...aliases[id][group],
    ]);
    return {
        battle: namesFor("battle"),
        mission: namesFor("mission"),
        mapSelection: namesFor("mapSelection"),
        ui: namesFor("ui"),
        battleClientPattern: "BattleClient*.ini",
    };
}

export function resolveCampaignFileNames(profile: GameProfileId | GameProfileDescriptor = "ra2"): CampaignFileNames {
    return getCampaignFileNames(profile);
}

export function getCampaignIniFileNames(profile: GameProfileId | GameProfileDescriptor = "ra2"): CampaignFileNames {
    return getCampaignFileNames(profile);
}

export function getCampaignProfileFileNames(profile: GameProfileId | GameProfileDescriptor = "ra2"): CampaignFileNames {
    return getCampaignFileNames(profile);
}
