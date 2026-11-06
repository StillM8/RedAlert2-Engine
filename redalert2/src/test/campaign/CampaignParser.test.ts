import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseCampaignIni } from "@/campaign/CampaignIniParser";
import type { CampaignSourceBundle, CampaignSourceDocument } from "@/campaign/CampaignTypes";

function document(fileName: string, source: string): CampaignSourceDocument {
    return { fileName, ini: new IniFile(source) };
}

function sources(battle: string, extra: Partial<CampaignSourceBundle> = {}): CampaignSourceBundle {
    return {
        battle: [document("battlemd.ini", battle)],
        battleClients: [],
        mission: [document("missionmd.ini", "[first.map]\nBriefing=BRIEF:FIRST\nUIName=NAME:FIRST\n")],
        mapSelection: [document("mapselmd.ini", "[GDI]\n1=FIRST_STEP\n2=SECOND_STEP\n[FIRST_STEP]\nScenario=first.map\n[SECOND_STEP]\nScenario=next.map\n")],
        ui: [document("uimd.ini", "[UISettings]\nShowDebugCampaigns=no\nCampaignList=yes\n")],
        ...extra,
    };
}

describe("campaign INI parser", () => {
    test("preserves [Battles] insertion order and parses mission metadata", () => {
        const catalog = parseCampaignIni(sources(`[Battles]\n2=THIRD\n1=FIRST\n[FIRST]\nScenario=first.map\nCD=0\nSide=0\nAct=1\nSideName=GDI\nBuildOffAlly=yes\nDescription=DESC:FIRST\nSummary=SUM:FIRST\n[THIRD]\nScenario=third.map\nCD=2\nSide=4\n`));
        expect(catalog.campaigns.map((campaign) => campaign.id)).toEqual(["THIRD", "FIRST"]);
        expect(catalog.campaigns[1]).toMatchObject({
            id: "FIRST",
            battleFile: "battlemd.ini",
            mapFile: "first.map",
            cd: 0,
            side: 0,
            act: 1,
            sideName: "GDI",
            buildOffAlly: true,
        });
        expect(catalog.campaigns[1].description.label).toBe("DESC:FIRST");
        expect(catalog.campaigns[1].mission?.values.Briefing).toBe("BRIEF:FIRST");
        expect(catalog.campaigns[1].nextMission?.mapFile).toBe("next.map");
    });

    test("filters disabled and debug campaigns unless debug display is enabled", () => {
        const source = `[Battles]\n1=VISIBLE\n2=DISABLED\n3=DEBUG\n[VISIBLE]\nScenario=visible.map\n[DISABLED]\nScenario=disabled.map\nEnabled=no\n[DEBUG]\nScenario=debug.map\nDebugOnly=yes\n`;
        expect(parseCampaignIni(sources(source)).campaigns.map((campaign) => campaign.id)).toEqual(["VISIBLE"]);
        const debugVisible = parseCampaignIni(sources(source, {
            ui: [document("uimd.ini", "[UISettings]\nShowDebugCampaigns=yes\n")],
        }));
        expect(debugVisible.campaigns.map((campaign) => campaign.id)).toEqual(["VISIBLE", "DEBUG"]);
    });

    test("uses an empty state for missing or malformed campaign data", () => {
        const catalog = parseCampaignIni({
            battle: [],
            battleClients: [],
            mission: [],
            mapSelection: [],
            ui: [],
        });
        expect(catalog.campaigns).toEqual([]);
        expect(catalog.allCampaigns).toEqual([]);
        expect(catalog.diagnostics).toEqual([]);
    });
});
