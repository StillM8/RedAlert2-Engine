export type CampaignSide = number | string;

export type CampaignDifficulty = "easy" | "normal" | "hard";

export type CampaignDifficultyValue = CampaignDifficulty | number;

export interface CampaignStringResolver {
    get(key: string, ...args: any[]): string;
    has?(key: string): boolean;
}

export interface CampaignText {
    label: string;
    value: string;
    resolved: boolean;
}

export interface CampaignFileNames {
    battle: readonly string[];
    mission: readonly string[];
    mapSelection: readonly string[];
    ui: readonly string[];
    battleClientPattern: string;
}

export interface CampaignSourceDocument {
    fileName: string;
    ini: import("@/data/IniFile").IniFile;
}

export interface CampaignSourceBundle {
    battle: CampaignSourceDocument[];
    battleClients: CampaignSourceDocument[];
    mission: CampaignSourceDocument[];
    mapSelection: CampaignSourceDocument[];
    ui: CampaignSourceDocument[];
}

export interface CampaignUiSettings {
    campaignList: boolean;
    showDebugCampaigns: boolean;
    showSummary: boolean;
    campaignListSize: number;
}

export interface CampaignMissionDefinition {
    section: string;
    mapFile: string;
    briefing?: CampaignText;
    uiName?: CampaignText;
    summary?: CampaignText;
    values: Record<string, string | string[]>;
}

export interface CampaignMissionIdentity {
    battleId?: string;
    side?: CampaignSide;
    sideName?: string;
    section?: string;
    scenario?: string;
    mapFile?: string;
    altNextScenario?: string;
    index?: number;
    sourceFile?: string;
}

export interface CampaignPresentation {
    title: string;
    description: string;
    longDescription: string;
    summary: string;
    sideName?: string;
    hoverSound: string;
    image?: string;
    palette?: string;
    subline?: string;
    tooltip?: string;
}

export interface CampaignDefinition {
    id: string;
    battleId: string;
    battleFile: string;
    sourceFile: string;
    enabled: boolean;
    debugOnly: boolean;
    scenario?: string;
    mapFile?: string;
    cd?: number;
    side?: CampaignSide;
    act?: number;
    sideName?: string;
    sideNameLabel?: string;
    buildOffAlly: boolean;
    summary: CampaignText;
    description: CampaignText;
    longDescription: CampaignText;
    finalMovie?: number | string;
    nextScenario?: string;
    altNextScenario?: string;
    hoverSound: string;
    mission?: CampaignMissionDefinition;
    nextMission?: CampaignMissionIdentity;
    presentation: CampaignPresentation;
}

export interface CampaignDiagnostic {
    code: "missing-file" | "invalid-entry" | "invalid-value" | "include-error" | "unsupported";
    message: string;
    file?: string;
    section?: string;
}

export interface CampaignCatalog {
    campaigns: CampaignDefinition[];
    allCampaigns: CampaignDefinition[];
    settings: CampaignUiSettings;
    buttons: import("./CampaignButtonModel").CampaignButtonModel;
    diagnostics: CampaignDiagnostic[];
    sourceFiles: {
        battle: string[];
        battleClients: string[];
        mission: string[];
        mapSelection: string[];
        ui: string[];
    };
}

export interface CampaignSessionOptions {
    difficulty?: CampaignDifficultyValue;
    buildOffAlly?: boolean;
    side?: CampaignSide;
    sideName?: string;
}

export interface CampaignLaunchPresentation {
    title: string;
    description: string;
    longDescription: string;
    summary: string;
    sideName?: string;
    hoverSound: string;
    image?: string;
    palette?: string;
    subline?: string;
    tooltip?: string;
}

export interface CampaignLaunch {
    kind: "campaign-launch";
    version: 1;
    battleId: string;
    battleFile: string;
    mapFile: string;
    scenario: string;
    side?: CampaignSide;
    sideName?: string;
    difficulty: CampaignDifficultyValue;
    buildOffAlly: boolean;
    cd?: number;
    act?: number;
    finalMovie?: number | string;
    nextScenario?: string;
    altNextScenario?: string;
    nextMission?: CampaignMissionIdentity;
    alternateNextScenario?: boolean;
    presentation: CampaignLaunchPresentation;
    campaign: CampaignDefinition;
}

export interface CampaignSession {
    catalog: CampaignCatalog;
    selected?: CampaignDefinition;
    difficulty: CampaignDifficultyValue;
    buildOffAlly: boolean;
    side?: CampaignSide;
    sideName?: string;
    select(campaign: CampaignDefinition | undefined): void;
    setDifficulty(difficulty: CampaignDifficultyValue): void;
    setBuildOffAlly(value: boolean): void;
    createLaunch(options?: CampaignSessionOptions): CampaignLaunch | undefined;
}

export const CAMPAIGN_LAUNCH_KIND = "campaign-launch" as const;

export const VANILLA_CAMPAIGN_FALLBACKS: Readonly<Record<string, {
    title: string;
    sideName: string;
    subline: string;
    hoverSound: string;
}>> = {
    ALL1: {
        title: "Allied Campaign",
        sideName: "GDI",
        subline: "STT:AlliedCampaignIcon",
        hoverSound: "AlliedCampaignSelect",
    },
    SOV1: {
        title: "Soviet Campaign",
        sideName: "Nod",
        subline: "STT:SovietCampaignIcon",
        hoverSound: "SovietCampaignSelect",
    },
    TUT1: {
        title: "Tutorial Campaign",
        sideName: "GDI",
        subline: "STT:CampaignAnimTutorial",
        hoverSound: "BootCampSelect",
    },
};
