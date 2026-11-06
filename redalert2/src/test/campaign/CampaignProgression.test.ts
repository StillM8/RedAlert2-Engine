import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseCampaignIni } from "@/campaign/CampaignIniParser";
import { createCampaignLaunch } from "@/campaign/CampaignSession";
import {
    loadNextCampaignLaunch,
    resolveNextCampaignLaunch,
} from "@/campaign/CampaignLaunch";
import type { CampaignCatalog, CampaignLaunch } from "@/campaign/CampaignTypes";
import { ScoreScreen, getScoreCampaignVictory } from "@/gui/screen/mainMenu/score/ScoreScreen";
import { MainMenuScreenType, ScreenType } from "@/gui/screen/ScreenType";

function catalog(): CampaignCatalog {
    return parseCampaignIni({
        battle: [{
            fileName: "battle.ini",
            ini: new IniFile("[Battles]\n1=ONE\n2=TWO\n[ONE]\nScenario=one.map\nNextScenario=two.map\nSide=0\nBuildOffAlly=yes\n[TWO]\nScenario=two.map\nNextScenario=three.map\nSide=1\n"),
        }],
        battleClients: [],
        mission: [],
        mapSelection: [],
        ui: [],
    });
}

function launch(catalogValue: CampaignCatalog = catalog()): CampaignLaunch {
    return createCampaignLaunch(catalogValue.campaigns[0], {
        difficulty: "hard",
        side: 0,
        buildOffAlly: true,
    })!;
}

function screenHarness(catalogValue: CampaignCatalog = catalog()) {
    const buttons: any[] = [];
    const mainMenuCalls: any[] = [];
    const rootCalls: any[] = [];
    const controller = {
        toggleMainVideo: () => undefined,
        setSidebarButtons: (value: any[]) => buttons.splice(0, buttons.length, ...value),
        showSidebarButtons: () => undefined,
        setMainComponent: () => undefined,
        goToScreen: (screenType: MainMenuScreenType, params?: any) => mainMenuCalls.push({ screenType, params }),
        hideSidebarButtons: async () => undefined,
    };
    const rootController = {
        goToScreen: (screenType: ScreenType, params?: any) => rootCalls.push({ screenType, params }),
    };
    const strings = {
        get: (key: string) => key,
    };
    const screen = new ScoreScreen(
        strings,
        { render: () => [{}] },
        undefined,
        undefined,
        rootController,
        { catalog: catalogValue },
    );
    screen.setController(controller);
    return { screen, buttons, mainMenuCalls, rootCalls };
}

function player(defeated = false): any {
    return {
        name: "Player 1",
        defeated,
        isObserver: false,
        country: { side: 0 },
    };
}

function params(launchValue: CampaignLaunch, result: any, extra: any = {}): any {
    return {
        game: { id: "game" },
        localPlayer: player(result?.victory === false),
        singlePlayer: true,
        tournament: false,
        returnTo: { screenType: MainMenuScreenType.Home, params: undefined },
        campaignLaunch: launchValue,
        result,
        ...extra,
    };
}

describe("campaign progression", () => {
    test("resolves nextScenario and preserves launch options", () => {
        const source = catalog();
        const current = launch(source);
        const next = resolveNextCampaignLaunch(current, source, { nextScenario: "two.map" });
        expect(next).toMatchObject({
            mapFile: "two.map",
            scenario: "two.map",
            difficulty: "hard",
            side: 0,
            buildOffAlly: true,
            nextScenario: "three.map",
        });
    });

    test("resolves a nextMission identity when no scenario is supplied", async () => {
        const source = catalog();
        const current = launch(source);
        const withIdentity: CampaignLaunch = {
            ...current,
            nextScenario: undefined,
            nextMission: {
                battleId: "ONE",
                side: 0,
                section: "TWO",
                scenario: "two.map",
                mapFile: "two.map",
                index: 1,
                sourceFile: "battle.ini",
            },
        };
        const next = resolveNextCampaignLaunch(withIdentity, source);
        expect(next?.mapFile).toBe("two.map");
        expect(next?.difficulty).toBe("hard");
        const loaded = await loadNextCampaignLaunch(withIdentity, { catalog: source });
        expect(loaded?.scenario).toBe("two.map");
    });

    test("resolves an identity that names only a mission section", () => {
        const source = catalog();
        const current = launch(source);
        const next = resolveNextCampaignLaunch({
            ...current,
            nextScenario: undefined,
            nextMission: {
                battleId: "TWO",
                side: 1,
                section: "TWO",
                index: 0,
            },
        }, source);
        expect(next?.scenario).toBe("two.map");
        expect(next?.side).toBe(0);
    });

    test("selects the alternate branch from the scripted result", () => {
        const source = parseCampaignIni({
            battle: [{ fileName: "battle.ini", ini: new IniFile("[Battles]\n1=ONE\n2=ALT\n[ONE]\nScenario=one.map\nNextScenario=base.map\nAltNextScenario=alt.map\n[ALT]\nScenario=alt.map\n") }],
            battleClients: [],
            mission: [],
            mapSelection: [],
            ui: [],
        });
        const current = launch(source);
        const next = resolveNextCampaignLaunch(current, source, {
            result: { victory: true, scripted: true, nextScenario: "alt.map" },
        });
        expect(next?.mapFile).toBe("alt.map");
        expect(next?.alternateNextScenario).toBe(true);
    });

    test("returns no launch for no-next and EndOfGame", () => {
        const source = catalog();
        const current = launch(source);
        const withoutNext: CampaignLaunch = {
            ...current,
            nextScenario: undefined,
            nextMission: undefined,
        };
        expect(resolveNextCampaignLaunch(withoutNext, source, {})).toBeUndefined();
        expect(resolveNextCampaignLaunch(current, source, { endOfGame: true, nextScenario: "two.map" })).toBeUndefined();
        expect(resolveNextCampaignLaunch(current, { campaigns: [], allCampaigns: [] } as any, { nextScenario: "two.map" })).toBeUndefined();
        expect(resolveNextCampaignLaunch(current, undefined as any, { nextScenario: "two.map" })).toBeUndefined();
        expect(resolveNextCampaignLaunch(current, { campaigns: [null] } as any, { nextScenario: "two.map" })).toBeUndefined();
    });
});

describe("campaign score routing", () => {
    test("uses scripted victory and launches the resolved mission", async () => {
        const source = catalog();
        const current = launch(source);
        const harness = screenHarness(source);
        await harness.screen.onEnter(params(current, { victory: true, scripted: true, nextScenario: "two.map" }));
        expect(harness.buttons[0].label).toBe("GUI:NextMission");
        harness.buttons[0].onClick();
        expect(harness.rootCalls[0].screenType).toBe(ScreenType.Game);
        expect(harness.rootCalls[0].params.campaignLaunch.mapFile).toBe("two.map");
        expect(harness.rootCalls[0].params.campaignLaunch.difficulty).toBe("hard");
    });

    test("does not render a score screen when SkipScore is set", async () => {
        const source = catalog();
        const current = launch(source);
        const harness = screenHarness(source);
        await harness.screen.onEnter(params(current, { victory: true, scripted: true, nextScenario: "two.map" }, { skipScore: true }));
        expect(harness.buttons).toHaveLength(0);
        expect(harness.rootCalls[0].screenType).toBe(ScreenType.Game);
    });

    test("offers retry and return on scripted defeat", async () => {
        const source = catalog();
        const current = launch(source);
        const harness = screenHarness(source);
        await harness.screen.onEnter(params(current, { victory: false, scripted: true }));
        expect(harness.buttons.map((button) => button.label)).toEqual(["GUI:Retry", "GUI:Return"]);
        harness.buttons[0].onClick();
        expect(harness.rootCalls[0].params.campaignLaunch).toBe(current);
    });

    test("routes a missing next mission to campaign selection", async () => {
        const source = catalog();
        const current = launch(source);
        const harness = screenHarness(source);
        await harness.screen.onEnter(params(current, { victory: true, scripted: true }, { endOfGame: true }));
        harness.buttons[0].onClick();
        expect(harness.mainMenuCalls[0].screenType).toBe(MainMenuScreenType.CampaignSelection);
    });

    test("keeps ordinary skirmish score continuation unchanged", async () => {
        const harness = screenHarness(catalog());
        await harness.screen.onEnter({
            game: { id: "skirmish" },
            localPlayer: player(),
            singlePlayer: true,
            tournament: false,
            returnTo: { screenType: MainMenuScreenType.Home, params: undefined },
        });
        expect(harness.buttons[0].label).toBe("GUI:Continue");
        harness.buttons[0].onClick();
        expect(harness.mainMenuCalls[0].screenType).toBe(MainMenuScreenType.Home);
        expect(harness.rootCalls).toHaveLength(0);
    });

    test("honors the scripted result over player state", () => {
        const source = catalog();
        const current = launch(source);
        const screenParams = params(current, { victory: true, scripted: true });
        expect(getScoreCampaignVictory(screenParams)).toBe(true);
    });
});
