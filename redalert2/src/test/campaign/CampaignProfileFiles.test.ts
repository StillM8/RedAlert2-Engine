import { describe, expect, test } from "bun:test";
import { getCampaignFileNames } from "@/campaign/CampaignFileNames";

describe("campaign profile filenames", () => {
    test("selects Mental Omega campaign aliases before Yuri and retail files", () => {
        expect(getCampaignFileNames("mental-omega")).toEqual({
            battle: ["battlemo.ini", "battlemd.ini", "battle.ini"],
            mission: ["missionmo.ini", "missionmd.ini", "mission.ini"],
            mapSelection: ["mapselmo.ini", "mapselmd.ini", "mapsel01.ini"],
            ui: ["uimd.ini", "ui.ini", "uimo.ini"],
            battleClientPattern: "BattleClient*.ini",
        });
    });

    test("keeps retail and Yuri campaign filename chains distinct", () => {
        expect(getCampaignFileNames("ra2").mission).toEqual(["mission.ini", "missionmd.ini", "missionmo.ini"]);
        expect(getCampaignFileNames("yr").battle).toEqual(["battlemd.ini", "battle.ini"]);
        expect(getCampaignFileNames("yr").mapSelection).toEqual(["mapselmd.ini", "mapsel01.ini"]);
    });
});
