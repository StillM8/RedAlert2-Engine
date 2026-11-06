import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseCampaignIni } from "@/campaign/CampaignIniParser";
import { CampaignSelectionScreen } from "@/gui/screen/mainMenu/campaign/CampaignSelectionScreen";
import { MainMenuScreenType, ScreenType } from "@/gui/screen/ScreenType";

function catalog() {
    return parseCampaignIni({
        battle: [{ fileName: "battlemd.ini", ini: new IniFile("[Battles]\n1=ALL1\n[ALL1]\nScenario=all01.map\n") }],
        battleClients: [],
        mission: [],
        mapSelection: [],
        ui: [],
    });
}

describe("campaign selection screen", () => {
    test("renders a catalog, updates options, and hands a launch to GameScreen", async () => {
        const strings = {
            get: (key: string) => key === "GUI:Campaign" ? "Campaign" : key,
            has: () => false,
        };
        const rendered: any[] = [];
        const controller = {
            toggleMainVideo: () => undefined,
            setMainComponent: (component: any) => rendered.push(component),
            setSidebarButtons: () => undefined,
            showSidebarButtons: () => undefined,
        };
        const rootController = {
            calls: [] as Array<{ screenType: ScreenType; params: any }>,
            goToScreen(screenType: ScreenType, params: any) {
                this.calls.push({ screenType, params });
            },
        };
        const screen = new CampaignSelectionScreen(
            strings,
            { render: () => [{}] },
            rootController,
            undefined,
            { catalog: catalog() },
        );
        (screen as any).controller = controller;
        await screen.onEnter({});
        expect(screen.getCatalog()?.campaigns).toHaveLength(1);
        screen.setDifficulty("hard");
        const launch = screen.launchSelected();
        expect(launch?.difficulty).toBe("hard");
        expect(rootController.calls[0].screenType).toBe(ScreenType.Game);
        expect(rootController.calls[0].params.campaignLaunch).toBe(launch);
        expect(MainMenuScreenType.CampaignSelection).toBe(23);
    });
});
