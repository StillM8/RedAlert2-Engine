import { jsx } from "@/gui/jsx/jsx";
import { HtmlView } from "@/gui/jsx/HtmlView";
import { ScoreTable } from "@/gui/screen/mainMenu/score/ScoreTable";
import { SideType } from "@/game/SideType";
import { expandAresMultiplayerScoreBars, resolveMultiplayerScorePresentation, type MultiplayerScorePresentation, type SideDescriptor } from "@/extensions/ares/AresSides";
import { Engine } from "@/engine/Engine";
import { MusicType } from "@/engine/sound/Music";
import { MainMenuScreen } from "@/gui/screen/mainMenu/MainMenuScreen";
import { MainMenuRoute } from "@/gui/screen/mainMenu/MainMenuRoute";
import { MainMenuScreenType, ScreenType } from "@/gui/screen/ScreenType";
import { WolGameReportResult } from "@/network/WolGameReport";
import { Task } from "@puzzl/core/lib/async/Task";
import { OperationCanceledError } from "@puzzl/core/lib/async/cancellation/OperationCanceledError";
import { sleep } from "@puzzl/core/lib/async/sleep";
import {
    campaignLaunchToGameScreenParams,
    getCampaignLaunch,
    loadNextCampaignLaunch,
} from "@/campaign/CampaignLaunch";
import type {
    CampaignCatalog,
    CampaignLaunch,
} from "@/campaign/CampaignTypes";

interface Game {
    id: string;
    campaignResult?: any;
    getCampaignResult?: () => any;
}
interface Player {
    name?: string;
    defeated?: boolean;
    isObserver?: boolean;
    country?: {
        side: SideType;
        sideDefinition?: SideDescriptor;
    };
}
export interface ScoreScreenRoute {
    screenType: any;
    params?: any;
}
export interface ScoreScreenParams {
    game: Game;
    localPlayer: Player;
    singlePlayer: boolean;
    tournament: boolean;
    returnTo?: ScoreScreenRoute;
    campaignLaunch?: CampaignLaunch;
    campaign?: CampaignLaunch;
    campaignSession?: any;
    campaignState?: any;
    result?: any;
    nextScenario?: string;
    altNextScenario?: string;
    skipScore?: boolean;
    endOfGame?: boolean;
    catalog?: CampaignCatalog;
}
export interface ScoreScreenRootController {
    goToScreen(screenType: ScreenType, params?: any): void;
}
export interface ScoreScreenOptions {
    catalog?: CampaignCatalog;
    catalogLoader?: () => CampaignCatalog | undefined | Promise<CampaignCatalog | undefined>;
}
interface GameReport {
    gameId: string;
    players?: any[];
}
interface WolService {
    getLastGameReport?(): GameReport | undefined;
}

function resolveScoreResult(game: any, localPlayer: any, singlePlayer: boolean, gameReport?: GameReport): WolGameReportResult | undefined {
    const reportPlayer = (gameReport as any)?.players?.find((player: any) =>
        player.name?.toLowerCase() === localPlayer?.name?.toLowerCase(),
    );
    if (reportPlayer?.resultType !== undefined) {
        return reportPlayer.resultType;
    }
    if (game.stalemateDetectTrait?.isStale?.() && game.stalemateDetectTrait.getCountdownTicks?.() === 0) {
        return WolGameReportResult.Draw;
    }
    if (localPlayer?.defeated) {
        if (!game.alliances
            ?.getAllies(localPlayer)
            ?.filter((ally: any) => !ally.isAi && !ally.defeated).length) {
            return WolGameReportResult.Loss;
        }
    }
    else if (!singlePlayer && !localPlayer?.isObserver) {
        return WolGameReportResult.Win;
    }
    else if (singlePlayer && !localPlayer?.isObserver) {
        return WolGameReportResult.Win;
    }
    return undefined;
}

function hasCampaignResult(value: any): boolean {
    if (value && typeof value === "object") {
        return ["victory", "outcome", "scripted", "nextScenario", "altNextScenario", "endOfGame", "skipScore"]
            .some((key) => key in value);
    }
    if (typeof value === "string") {
        return ["win", "won", "victory", "lose", "lost", "loss", "defeat"]
            .includes(value.trim().toLocaleLowerCase("en-US"));
    }
    return false;
}

function isCampaignContext(params: ScoreScreenParams): boolean {
    return Boolean(
        params.campaignLaunch ||
        params.campaign ||
        params.campaignSession ||
        params.campaignState ||
        hasCampaignResult(params.result) ||
        params.nextScenario ||
        params.altNextScenario ||
        params.skipScore === true ||
        params.endOfGame === true,
    );
}

function campaignResult(params: ScoreScreenParams): any {
    const candidates = [
        params.result,
        params.campaignState?.result,
        params.campaignSession?.result,
        hasCampaignResult(params.campaignState) ? params.campaignState : undefined,
        hasCampaignResult(params.campaignSession) ? params.campaignSession : undefined,
        params.game?.campaignResult,
    ];
    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null) {
            return candidate;
        }
    }
    try {
        const result = params.game?.getCampaignResult?.();
        if (result !== undefined && result !== null) {
            return result;
        }
    }
    catch {
    }
    return undefined;
}

function resultVictory(result: any): boolean | undefined {
    if (typeof result === "boolean") {
        return result;
    }
    if (typeof result === "string") {
        const outcome = result.trim().toLocaleLowerCase("en-US");
        if (["win", "won", "victory"].includes(outcome)) {
            return true;
        }
        if (["lose", "lost", "loss", "defeat"].includes(outcome)) {
            return false;
        }
    }
    if (typeof result?.victory === "boolean") {
        return result.victory;
    }
    if (typeof result?.victory === "number") {
        return result.victory !== 0;
    }
    if (typeof result?.outcome === "string") {
        const outcome = result.outcome.toLocaleLowerCase("en-US");
        if (["win", "won", "victory"].includes(outcome)) {
            return true;
        }
        if (["lose", "lost", "loss", "defeat"].includes(outcome)) {
            return false;
        }
    }
    return undefined;
}

export function getScoreCampaignResult(params: ScoreScreenParams): any {
    return campaignResult(params);
}

export function getScoreCampaignVictory(params: ScoreScreenParams): boolean | undefined {
    const result = campaignResult(params);
    const scriptedResult = resultVictory(result);
    if (scriptedResult !== undefined) {
        return scriptedResult;
    }
    if (isCampaignContext(params)) {
        return !params.localPlayer?.defeated && !params.localPlayer?.isObserver;
    }
    return undefined;
}

export class ScoreScreen extends MainMenuScreen {
    private strings: any;
    private jsxRenderer: any;
    private wolService?: WolService;
    private scoreTable?: any;
    private reportUpdateTask?: Task<void>;
    private scorePresentation?: MultiplayerScorePresentation;
    private music?: { play(type: MusicType): Promise<void> };
    private rootController?: ScoreScreenRootController;
    private options: ScoreScreenOptions;
    private campaignLaunch?: CampaignLaunch;
    private nextCampaignLaunch?: CampaignLaunch;
    private navigationStarted = false;
    constructor(
        strings: any,
        jsxRenderer: any,
        wolService: WolService,
        music?: { play(type: MusicType): Promise<void> },
        rootControllerOrOptions?: ScoreScreenRootController | ScoreScreenOptions,
        options: ScoreScreenOptions = {},
    ) {
        super();
        this.strings = strings;
        this.jsxRenderer = jsxRenderer;
        this.wolService = wolService;
        this.music = music;
        if (rootControllerOrOptions && typeof (rootControllerOrOptions as ScoreScreenRootController).goToScreen === "function") {
            this.rootController = rootControllerOrOptions as ScoreScreenRootController;
            this.options = options;
        }
        else {
            this.options = (rootControllerOrOptions as ScoreScreenOptions | undefined) ?? options;
        }
        this.musicType = MusicType.Score;
    }
    async onEnter(params: ScoreScreenParams): Promise<void> {
        this.navigationStarted = false;
        this.campaignLaunch = getCampaignLaunch(params);
        this.nextCampaignLaunch = undefined;
        const campaign = isCampaignContext(params);
        const victory = getScoreCampaignVictory(params) ?? true;
        if (campaign && this.campaignLaunch && victory) {
            this.nextCampaignLaunch = await this.resolveNextCampaignLaunch(params);
        }
        const skipScore = this.resolveSkipScore(params);
        if (campaign && victory && skipScore) {
            this.continueCampaign(params);
            return;
        }
        this.title = params.singlePlayer
            ? this.strings.get("GUI:SkirmishScore")
            : this.strings.get("GUI:MultiplayerScore");
        this.controller.toggleMainVideo(false);
        this.scorePresentation = resolveMultiplayerScorePresentation(
            params.localPlayer.country?.sideDefinition,
            params.localPlayer.country?.side ?? SideType.GDI,
        );
        this.updateScoreMusic(params, undefined);
        this.initView(params, campaign, victory);
        if (!params.singlePlayer && !campaign) {
            this.loadGameReport(params.game, params);
        }
    }
    private resolveSkipScore(params: ScoreScreenParams): boolean {
        const result = campaignResult(params);
        const values = [
            params.skipScore,
            result?.skipScore,
            (this.campaignLaunch as any)?.skipScore,
            params.campaignState?.skipScore,
            params.campaignSession?.skipScore,
        ];
        for (const value of values) {
            if (typeof value === "boolean") {
                return value;
            }
            if (typeof value === "number") {
                return value !== 0;
            }
            if (typeof value === "string") {
                const normalized = value.trim().toLocaleLowerCase("en-US");
                if (["yes", "y", "true", "1", "on"].includes(normalized)) {
                    return true;
                }
                if (["no", "n", "false", "0", "off"].includes(normalized)) {
                    return false;
                }
            }
        }
        return false;
    }
    private async resolveNextCampaignLaunch(params: ScoreScreenParams): Promise<CampaignLaunch | undefined> {
        if (!this.campaignLaunch) {
            return undefined;
        }
        try {
            return await loadNextCampaignLaunch(this.campaignLaunch, {
                catalog: params.catalog ?? this.options.catalog,
                loadCatalog: this.options.catalogLoader,
                nextScenario: params.nextScenario,
                altNextScenario: params.altNextScenario,
                endOfGame: params.endOfGame ?? (this.campaignLaunch as any)?.endOfGame,
                nextMission: params.campaignState?.nextMission,
                result: campaignResult(params),
                campaignState: params.campaignState,
                campaignSession: params.campaignSession,
            });
        }
        catch {
            return undefined;
        }
    }
    private getSidebarButtons(params: ScoreScreenParams, campaign: boolean, victory: boolean): any[] {
        if (campaign) {
            if (!victory) {
                return [
                    {
                        label: this.strings.get("GUI:Retry") || "Retry",
                        tooltip: this.strings.get("STT:MPScoreButtonContinue"),
                        isBottom: true,
                        onClick: () => this.retryCampaign(params),
                    },
                    {
                        label: this.strings.get("GUI:Return") || "Return",
                        tooltip: this.strings.get("GUI:Back"),
                        isBottom: true,
                        onClick: () => this.returnFromScore(params),
                    },
                ];
            }
            const label = this.nextCampaignLaunch
                ? this.strings.get("GUI:NextMission") || this.strings.get("GUI:Continue") || "Next Mission"
                : this.strings.get("GUI:Continue") || "Continue";
            return [
                {
                    label,
                    tooltip: this.strings.get("STT:MPScoreButtonContinue"),
                    isBottom: true,
                    onClick: () => this.continueCampaign(params),
                },
            ];
        }
        const returnTo = params.returnTo ?? {
            screenType: MainMenuScreenType.Home,
            params: undefined,
        };
        return [
            {
                label: this.strings.get("GUI:Continue"),
                tooltip: this.strings.get("STT:MPScoreButtonContinue"),
                isBottom: true,
                onClick: () => this.controller?.goToScreen(returnTo.screenType, returnTo.params),
            },
        ];
    }
    private continueCampaign(params: ScoreScreenParams): void {
        if (this.navigationStarted) {
            return;
        }
        this.navigationStarted = true;
        if (this.nextCampaignLaunch) {
            this.launchCampaign(this.nextCampaignLaunch, params);
            return;
        }
        const route = new MainMenuRoute(MainMenuScreenType.CampaignSelection, {
            returnTo: new MainMenuRoute(MainMenuScreenType.Home, undefined),
        });
        this.controller?.goToScreen(route.screenType, route.params);
    }
    private retryCampaign(params: ScoreScreenParams): void {
        if (!this.campaignLaunch || this.navigationStarted) {
            return;
        }
        this.navigationStarted = true;
        this.launchCampaign(this.campaignLaunch, params);
    }
    private launchCampaign(launch: CampaignLaunch, params: ScoreScreenParams): void {
        const screenParams = campaignLaunchToGameScreenParams(launch, {
            returnTo: params.returnTo,
        });
        const controller: any = this.rootController ?? this.controller;
        controller?.goToScreen?.(ScreenType.Game, screenParams);
    }
    private returnFromScore(params: ScoreScreenParams): void {
        const returnTo = params.returnTo ?? {
            screenType: MainMenuScreenType.Home,
            params: undefined,
        };
        this.controller?.goToScreen(returnTo.screenType, returnTo.params);
    }
    private initView(params: ScoreScreenParams, campaign: boolean, victory: boolean): void {
        this.controller.setSidebarButtons(this.getSidebarButtons(params, campaign, victory));
        this.controller.showSidebarButtons();
        const { game, localPlayer, singlePlayer, tournament } = params;
        const side = localPlayer.country?.side ?? SideType.GDI;
        const scorePresentation = this.scorePresentation ?? resolveMultiplayerScorePresentation(
            localPlayer.country?.sideDefinition,
            side,
        );
        const fallbackPresentation = resolveMultiplayerScorePresentation(undefined, side);
        const hasAssetPair = (image: string, palette: string): boolean => {
            try {
                return !!Engine.vfs?.fileExists(image) && !!Engine.vfs?.fileExists(palette);
            }
            catch {
                return false;
            }
        };
        const customAssetsAvailable = hasAssetPair(scorePresentation.image, scorePresentation.palette);
        const fallbackAssetsAvailable = hasAssetPair(fallbackPresentation.image, fallbackPresentation.palette);
        const assets = customAssetsAvailable
            ? { img: scorePresentation.image, pal: scorePresentation.palette }
            : fallbackAssetsAvailable
                ? { img: fallbackPresentation.image, pal: fallbackPresentation.palette }
                : undefined;
        const resolveExistingBars = (presentation: MultiplayerScorePresentation): string[] =>
            expandAresMultiplayerScoreBars(presentation.bars).filter((filename) => {
                try {
                    return !!Engine.vfs?.fileExists(filename);
                }
                catch {
                    return false;
                }
            });
        const customBars = resolveExistingBars(scorePresentation);
        const fallbackBars = resolveExistingBars(fallbackPresentation);
        const scoreBars = customBars.length === expandAresMultiplayerScoreBars(scorePresentation.bars).length
            ? customBars
            : fallbackBars.length === expandAresMultiplayerScoreBars(fallbackPresentation.bars).length
                ? fallbackBars
                : customBars.length ? customBars : fallbackBars;
        console.info('[ScoreScreen] Faction presentation', {
            side,
            image: assets?.img ?? scorePresentation.image,
            palette: assets?.pal ?? scorePresentation.palette,
            imageAvailable: customAssetsAvailable || fallbackAssetsAvailable,
            paletteAvailable: customAssetsAvailable || fallbackAssetsAvailable,
            usingFallback: !customAssetsAvailable && fallbackAssetsAvailable,
            scoreBars: scoreBars.length,
        });
        const [component] = this.jsxRenderer.render(jsx("container", { width: "100%", height: "100%" }, assets
            ? jsx("sprite", { image: assets.img, palette: assets.pal })
            : [], jsx(HtmlView, {
            width: "100%",
            height: "100%",
            component: ScoreTable,
            innerRef: (ref: any) => (this.scoreTable = ref),
            props: {
                game: game,
                singlePlayer: singlePlayer,
                localPlayer: localPlayer,
                tournament: tournament,
                strings: this.strings,
                scoreBars: !singlePlayer ? scoreBars : undefined,
            },
        })));
        this.controller.setMainComponent(component);
    }
    private loadGameReport(game: Game, params: ScoreScreenParams): void {
        this.reportUpdateTask?.cancel();
        const task = (this.reportUpdateTask = new Task(async (cancellationToken) => {
            while (true) {
                if (cancellationToken.isCancelled())
                    return;
                const report = this.wolService?.getLastGameReport?.();
                if (report?.gameId === game.id) {
                    this.scoreTable.applyOptions((options: any) => {
                        options.gameReport = report;
                    });
                    this.updateScoreMusic(params, report);
                    return;
                }
                await sleep(1000, cancellationToken);
            }
        }));
        task.start().catch((error) => {
            if (!(error instanceof OperationCanceledError)) {
                console.error(error);
            }
        });
    }
    private updateScoreMusic(params: ScoreScreenParams, report?: GameReport): void {
        const result = resolveScoreResult(params.game, params.localPlayer, params.singlePlayer, report);
        const theme = !params.singlePlayer
            ? result === WolGameReportResult.Win
                ? this.scorePresentation?.winTheme
                : result === WolGameReportResult.Loss
                    ? this.scorePresentation?.loseTheme
                    : undefined
            : undefined;
        const nextMusicType = (theme || MusicType.Score) as MusicType;
        if (this.musicType === nextMusicType) {
            return;
        }
        this.musicType = nextMusicType;
        this.music?.play(nextMusicType).catch((error) => {
            console.warn(`[ScoreScreen] Failed to play score theme "${String(nextMusicType)}"`, error);
        });
    }
    async onLeave(): Promise<void> {
        if (this.reportUpdateTask) {
            this.reportUpdateTask.cancel();
            this.reportUpdateTask = undefined;
        }
        await this.controller.hideSidebarButtons();
    }
    async onStack(): Promise<void> {
        await this.onLeave();
    }
    onUnstack(): void {
    }
}
