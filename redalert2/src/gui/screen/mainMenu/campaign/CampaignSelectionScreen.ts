import { ChannelType } from "@/engine/sound/ChannelType";
import { MusicType } from "@/engine/sound/Music";
import { Engine } from "@/engine/Engine";
import { CampaignCatalogService } from "@/campaign/CampaignService";
import { createCampaignSession, DefaultCampaignSession } from "@/campaign/CampaignSession";
import { campaignLaunchToGameScreenParams } from "@/campaign/CampaignLaunch";
import type {
    CampaignCatalog,
    CampaignDefinition,
    CampaignDifficultyValue,
    CampaignLaunch,
    CampaignStringResolver,
} from "@/campaign/CampaignTypes";
import { HtmlView } from "@/gui/jsx/HtmlView";
import { jsx } from "@/gui/jsx/jsx";
import { MainMenuScreen } from "@/gui/screen/mainMenu/MainMenuScreen";
import { ScreenType } from "@/gui/screen/ScreenType";
import { CampaignSelection } from "./CampaignSelection";
import type { CampaignSelectionRouteParams } from "./CampaignRoute";

interface CampaignSelectionJsxRenderer {
    render(element: any): any[];
}

interface CampaignSelectionRootController {
    goToScreen(screenType: ScreenType, params?: any): void;
}

interface CampaignSelectionSound {
    play(key: string, channel: ChannelType): unknown;
}

export interface CampaignSelectionScreenOptions {
    catalog?: CampaignCatalog;
    service?: CampaignCatalogService;
}

export class CampaignSelectionScreen extends MainMenuScreen {
    public readonly musicType: MusicType = MusicType.Intro;
    private catalog?: CampaignCatalog;
    private session?: DefaultCampaignSession;
    private component?: { applyOptions?: (callback: (options: any) => void) => void };
    private returnTo?: unknown;
    private lastLaunch?: CampaignLaunch;

    constructor(
        private readonly strings: CampaignStringResolver,
        private readonly jsxRenderer: CampaignSelectionJsxRenderer,
        private readonly rootController?: CampaignSelectionRootController,
        private readonly sound?: CampaignSelectionSound,
        private readonly options: CampaignSelectionScreenOptions = {},
    ) {
        super();
        this.title = strings.get("GUI:Campaign") || "Campaign";
    }

    async onEnter(params: CampaignSelectionRouteParams = {}): Promise<void> {
        this.returnTo = params.returnTo;
        this.catalog = await this.resolveCatalog(params.catalog);
        this.session = createCampaignSession(this.catalog);
        this.controller?.toggleMainVideo(false);
        this.renderView();
        this.refreshSidebarButtons();
        this.controller?.showSidebarButtons();
    }

    private async resolveCatalog(candidate: unknown): Promise<CampaignCatalog> {
        if (candidate && typeof candidate === "object" && Array.isArray((candidate as CampaignCatalog).campaigns)) {
            return candidate as CampaignCatalog;
        }
        if (this.options.catalog) {
            return this.options.catalog;
        }
        if (this.options.service) {
            return this.options.service.loadAsync();
        }
        return new CampaignCatalogService(
            Engine.vfs,
            Engine.getActiveProfile?.()?.id ?? "ra2",
            { strings: this.strings },
        ).loadAsync();
    }

    private renderView(): void {
        if (!this.catalog || !this.session || !this.jsxRenderer) {
            return;
        }
        const [component] = this.jsxRenderer.render(jsx(HtmlView, {
            component: CampaignSelection,
            innerRef: (ref: any) => (this.component = ref),
            props: {
                campaigns: this.catalog.campaigns,
                selected: this.session.selected,
                difficulty: this.session.difficulty,
                buildOffAlly: this.session.buildOffAlly,
                strings: this.strings,
                onSelect: (campaign: CampaignDefinition) => this.selectCampaign(campaign),
                onHover: (campaign: CampaignDefinition) => this.playHoverSound(campaign),
                onDifficultyChange: (difficulty: CampaignDifficultyValue) => this.setDifficulty(difficulty),
                onBuildOffAllyChange: (value: boolean) => this.setBuildOffAlly(value),
                onLaunch: () => this.launchSelected(),
            },
        }));
        this.component = component;
        this.controller?.setMainComponent(component);
    }

    private refreshSidebarButtons(): void {
        this.controller?.setSidebarButtons([
            {
                label: this.strings.get("GUI:StartGame") || "Start",
                tooltip: this.strings.get("STT:CampaignLaunch") || "Launch campaign",
                disabled: !this.session?.selected,
                onClick: () => this.launchSelected(),
            },
            {
                label: this.strings.get("GUI:Back") || "Back",
                isBottom: true,
                onClick: () => this.controller?.popScreen(),
            },
        ]);
    }

    selectCampaign(campaign: CampaignDefinition | undefined): void {
        if (!this.session || !campaign) {
            return;
        }
        this.session.select(campaign);
        this.renderView();
        this.refreshSidebarButtons();
    }

    setDifficulty(difficulty: CampaignDifficultyValue): void {
        this.session?.setDifficulty(difficulty);
        this.renderView();
    }

    setBuildOffAlly(value: boolean): void {
        this.session?.setBuildOffAlly(value);
        this.renderView();
    }

    private playHoverSound(campaign: CampaignDefinition): void {
        if (!campaign.hoverSound || !this.sound) {
            return;
        }
        try {
            this.sound.play(campaign.hoverSound, ChannelType.Ui);
        }
        catch {
        }
    }

    launchSelected(): CampaignLaunch | undefined {
        const launch = this.session?.createLaunch();
        if (!launch) {
            return undefined;
        }
        this.lastLaunch = launch;
        this.rootController?.goToScreen(
            ScreenType.Game,
            campaignLaunchToGameScreenParams(launch, { returnTo: this.returnTo }),
        );
        return launch;
    }

    getLastLaunch(): CampaignLaunch | undefined {
        return this.lastLaunch;
    }

    getCatalog(): CampaignCatalog | undefined {
        return this.catalog;
    }

    async onLeave(): Promise<void> {
        await this.controller?.hideSidebarButtons();
        this.component = undefined;
    }

    async onStack(): Promise<void> {
        await this.onLeave();
    }

    onUnstack(params?: CampaignSelectionRouteParams): void {
        void this.onEnter(params);
    }
}
