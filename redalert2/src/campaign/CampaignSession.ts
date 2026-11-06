import type {
    CampaignDefinition,
    CampaignLaunch,
    CampaignSession,
    CampaignSessionOptions,
    CampaignSide,
    CampaignDifficultyValue,
    CampaignCatalog,
} from "./CampaignTypes";
import { parseAresCampaignButtons } from "./CampaignButtonModel";

function cloneNextMission(launch: CampaignLaunch): CampaignLaunch {
    return {
        ...launch,
        presentation: { ...launch.presentation },
        nextMission: launch.nextMission ? { ...launch.nextMission } : undefined,
    };
}

export class DefaultCampaignSession implements CampaignSession {
    public difficulty: CampaignDifficultyValue = "normal";
    public buildOffAlly = false;
    public side?: CampaignSide;
    public sideName?: string;
    public selected?: CampaignDefinition;

    constructor(public readonly catalog: CampaignCatalog) {
    }

    select(campaign: CampaignDefinition | undefined): void {
        this.selected = campaign;
        if (campaign) {
            this.side = campaign.side;
            this.sideName = campaign.sideName;
            this.buildOffAlly = campaign.buildOffAlly;
        }
    }

    setDifficulty(difficulty: CampaignDifficultyValue): void {
        this.difficulty = difficulty;
    }

    setBuildOffAlly(value: boolean): void {
        this.buildOffAlly = value;
    }

    createLaunch(options: CampaignSessionOptions = {}): CampaignLaunch | undefined {
        const campaign = this.selected;
        if (!campaign?.scenario) {
            return undefined;
        }
        const side = options.side ?? this.side ?? campaign.side;
        const sideName = options.sideName ?? this.sideName ?? campaign.sideName;
        const difficulty = options.difficulty ?? this.difficulty;
        const buildOffAlly = options.buildOffAlly ?? this.buildOffAlly ?? campaign.buildOffAlly;
        const launch: CampaignLaunch = {
            kind: "campaign-launch",
            version: 1,
            battleId: campaign.battleId,
            battleFile: campaign.battleFile,
            mapFile: campaign.mapFile ?? campaign.scenario,
            scenario: campaign.scenario,
            side,
            sideName,
            difficulty,
            buildOffAlly,
            cd: campaign.cd,
            act: campaign.act,
            finalMovie: campaign.finalMovie,
            nextScenario: campaign.nextScenario ?? campaign.nextMission?.scenario,
            altNextScenario: campaign.altNextScenario ?? campaign.nextMission?.altNextScenario,
            nextMission: campaign.nextMission ? { ...campaign.nextMission } : undefined,
            presentation: {
                ...campaign.presentation,
                sideName,
            },
            campaign,
        };
        return cloneNextMission(launch);
    }
}

export function createCampaignSession(catalog: CampaignCatalog, selected?: CampaignDefinition): DefaultCampaignSession {
    const session = new DefaultCampaignSession(catalog);
    session.select(selected ?? catalog.campaigns[0]);
    return session;
}

export function createCampaignLaunch(
    campaign: CampaignDefinition,
    options: CampaignSessionOptions & { difficulty?: CampaignDifficultyValue } = {},
): CampaignLaunch | undefined {
    const session = new DefaultCampaignSession({
        campaigns: [campaign],
        allCampaigns: [campaign],
        settings: {
            campaignList: true,
            showDebugCampaigns: false,
            showSummary: true,
            campaignListSize: 7,
        },
        buttons: parseAresCampaignButtons(undefined),
        diagnostics: [],
        sourceFiles: {
            battle: [campaign.battleFile],
            battleClients: [],
            mission: [],
            mapSelection: [],
            ui: [],
        },
    });
    session.select(campaign);
    return session.createLaunch(options);
}
