import { jsx } from "@/gui/jsx/jsx";
import { HtmlView } from "@/gui/jsx/HtmlView";
import { ScoreTable } from "@/gui/screen/mainMenu/score/ScoreTable";
import { SideType } from "@/game/SideType";
import { expandAresMultiplayerScoreBars, resolveMultiplayerScorePresentation, type MultiplayerScorePresentation, type SideDescriptor } from "@/extensions/ares/AresSides";
import { Engine } from "@/engine/Engine";
import { MusicType } from "@/engine/sound/Music";
import { MainMenuScreen } from "@/gui/screen/mainMenu/MainMenuScreen";
import { WolGameReportResult } from "@/network/WolGameReport";
import { Task } from "@puzzl/core/lib/async/Task";
import { OperationCanceledError } from "@puzzl/core/lib/async/cancellation/OperationCanceledError";
import { sleep } from "@puzzl/core/lib/async/sleep";
interface Game {
    id: string;
}
interface Player {
    country?: {
        side: SideType;
        sideDefinition?: SideDescriptor;
    };
}
interface ScoreScreenParams {
    game: Game;
    localPlayer: Player;
    singlePlayer: boolean;
    tournament: boolean;
    returnTo: {
        screenType: any;
        params: any;
    };
}
interface GameReport {
    gameId: string;
}
interface WolService {
    getLastGameReport(): GameReport | undefined;
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

export class ScoreScreen extends MainMenuScreen {
    private strings: any;
    private jsxRenderer: any;
    private wolService?: WolService;
    private scoreTable?: any;
    private reportUpdateTask?: Task<void>;
    private scorePresentation?: MultiplayerScorePresentation;
    private music?: { play(type: MusicType): Promise<void> };
    constructor(strings: any, jsxRenderer: any, wolService: WolService, music?: { play(type: MusicType): Promise<void> }) {
        super();
        this.strings = strings;
        this.jsxRenderer = jsxRenderer;
        this.wolService = wolService;
        this.music = music;
        this.musicType = MusicType.Score;
    }
    async onEnter(params: ScoreScreenParams): Promise<void> {
        this.title = params.singlePlayer
            ? this.strings.get("GUI:SkirmishScore")
            : this.strings.get("GUI:MultiplayerScore");
        this.controller.toggleMainVideo(false);
        this.scorePresentation = resolveMultiplayerScorePresentation(
            params.localPlayer.country?.sideDefinition,
            params.localPlayer.country?.side ?? SideType.GDI,
        );
        this.updateScoreMusic(params, undefined);
        this.initView(params);
        if (!params.singlePlayer) {
            this.loadGameReport(params.game, params);
        }
    }
    private initView({ game, localPlayer, singlePlayer, tournament, returnTo, }: ScoreScreenParams): void {
        this.controller.setSidebarButtons([
            {
                label: this.strings.get("GUI:Continue"),
                tooltip: this.strings.get("STT:MPScoreButtonContinue"),
                isBottom: true,
                onClick: () => {
                    this.controller?.goToScreen(returnTo.screenType, returnTo.params);
                },
            },
        ]);
        this.controller.showSidebarButtons();
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
