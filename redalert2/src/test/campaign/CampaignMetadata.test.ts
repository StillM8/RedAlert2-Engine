import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseCampaignIni } from "@/campaign/CampaignIniParser";
import { createCampaignSession } from "@/campaign/CampaignSession";
import type { CampaignSourceBundle } from "@/campaign/CampaignTypes";

function bundle(battle: string, extra: Partial<CampaignSourceBundle> = {}): CampaignSourceBundle {
    return {
        battle: [{ fileName: "battlemd.ini", ini: new IniFile(battle) }],
        battleClients: [],
        mission: [],
        mapSelection: [],
        ui: [],
        ...extra,
    };
}

describe("campaign metadata and settings", () => {
    test("reads summary and hover sound from the campaign section and Battle fallback", () => {
        const strings = {
            has: (key: string) => key === "SUM:CUSTOM",
            get: (key: string) => key === "SUM:CUSTOM" ? "Custom summary" : key,
        };
        const catalog = parseCampaignIni(bundle("[Battles]\n1=CUSTOM\n[Battle]\nHoverSound=CustomSelect\nSummary=SUM:CUSTOM\n[CUSTOM]\nScenario=custom.map\nFinalMovie=2\n"), { strings });
        expect(catalog.campaigns[0]).toMatchObject({
            hoverSound: "CustomSelect",
            finalMovie: 2,
            summary: { label: "SUM:CUSTOM", value: "Custom summary", resolved: true },
        });
    });

    test("honors campaign list size limits and defaults", () => {
        const catalog = parseCampaignIni(bundle("[Battles]\n1=ONE\n[ONE]\nScenario=one.map\n", {
            ui: [{ fileName: "uimd.ini", ini: new IniFile("[UISettings]\nCampaignListSize=99\nShowSummary=no\n") }],
        }));
        expect(catalog.settings).toEqual({
            campaignList: false,
            showDebugCampaigns: false,
            showSummary: false,
            campaignListSize: 18,
        });
    });

    test("resolves direct map entries and map-file section aliases in progression", () => {
        const catalog = parseCampaignIni(bundle("[Battles]\n1=ONE\n[ONE]\nScenario=one.map\nSide=0\n", {
            mapSelection: [{ fileName: "mapselmd.ini", ini: new IniFile("[GDI]\n0=one.map\n1=TWO_STEP\n[TWO_STEP]\nScenario=two.map\n") }],
        }));
        expect(catalog.campaigns[0].nextMission).toMatchObject({ scenario: "two.map" });
        expect(createCampaignSession(catalog).createLaunch()?.nextScenario).toBe("two.map");
    });
});
