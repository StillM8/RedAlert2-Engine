import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseCampaignIni } from "@/campaign/CampaignIniParser";
import { createCampaignSession, createCampaignLaunch } from "@/campaign/CampaignSession";
import { applyCampaignLaunchToParams, campaignLaunchToGameScreenParams, isCampaignLaunch } from "@/campaign/CampaignLaunch";

function catalog() {
    return parseCampaignIni({
        battle: [{ fileName: "battlemd.ini", ini: new IniFile("[Battles]\n1=ALL1\n[ALL1]\nScenario=all01.map\nSide=0\nBuildOffAlly=yes\nNextScenario=all02.map\n") }],
        battleClients: [],
        mission: [],
        mapSelection: [],
        ui: [],
    });
}

describe("campaign launch contract", () => {
    test("creates a serializable launch with map, side, difficulty, presentation, and next identity", () => {
        const source = catalog();
        const session = createCampaignSession(source);
        session.setDifficulty("hard");
        session.setBuildOffAlly(false);
        const launch = session.createLaunch();
        expect(launch).toMatchObject({
            kind: "campaign-launch",
            version: 1,
            battleId: "ALL1",
            battleFile: "battlemd.ini",
            mapFile: "all01.map",
            side: 0,
            difficulty: "hard",
            buildOffAlly: false,
            presentation: { title: "Allied Campaign" },
        });
        expect(launch?.nextScenario).toBe("all02.map");
        expect(isCampaignLaunch(launch)).toBe(true);
        expect(JSON.parse(JSON.stringify(launch))).toMatchObject({ battleId: "ALL1", mapFile: "all01.map" });
    });

    test("adapts the launch to GameScreen parameters without discarding existing options", () => {
        const launch = createCampaignLaunch(catalog().campaigns[0], { difficulty: "easy" })!;
        const params = applyCampaignLaunchToParams({
            create: true,
            singlePlayer: true,
            gameOpts: { mapTitle: "Custom title", buildOffAlly: true },
            campaignLaunch: launch,
        });
        expect(params.campaignLaunch).toBe(launch);
        expect(params.gameOpts.mapName).toBe("all01.map");
        expect(params.gameOpts.mapTitle).toBe("Custom title");
        expect(params.gameOpts.buildOffAlly).toBe(true);
        expect(params.gameOpts.isCampaign).toBe(true);
        expect(params.gameOpts.campaign).toBe(launch);
        expect(campaignLaunchToGameScreenParams(launch).gameOpts.mapName).toBe("all01.map");
    });
});
