import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseCampaignIni } from "@/campaign/CampaignIniParser";
import { resolveCampaignLabel } from "@/campaign/CampaignCsfResolver";
import type { CampaignSourceDocument, CampaignStringResolver } from "@/campaign/CampaignTypes";

function document(fileName: string, source: string): CampaignSourceDocument {
    return { fileName, ini: new IniFile(source) };
}

describe("campaign CSF and vanilla fallbacks", () => {
    test("resolves campaign labels and keeps vanilla hover sounds", () => {
        const strings: CampaignStringResolver = {
            has: (key) => ["DESC:FIRST", "LONG:FIRST"].includes(key),
            get: (key) => key === "DESC:FIRST" ? "First campaign" : "Long first campaign",
        };
        const catalog = parseCampaignIni({
            battle: [document("battlemd.ini", "[Battles]\n1=ALL1\n[ALL1]\nScenario=all01.map\nDescription=DESC:FIRST\nLongDescription=LONG:FIRST\n")],
            battleClients: [],
            mission: [],
            mapSelection: [],
            ui: [],
        }, { strings });
        expect(catalog.campaigns[0].description.value).toBe("First campaign");
        expect(catalog.campaigns[0].longDescription.value).toBe("Long first campaign");
        expect(catalog.campaigns[0].hoverSound).toBe("AlliedCampaignSelect");
    });

    test("uses safe vanilla labels when CSF is unavailable", () => {
        expect(resolveCampaignLabel(undefined, "STT:AlliedCampaignIcon")).toEqual({
            label: "STT:AlliedCampaignIcon",
            value: "STT:AlliedCampaignIcon",
            resolved: false,
        });
        expect(resolveCampaignLabel("NOSTR:", "STT:AlliedCampaignIcon")).toEqual({
            label: "NOSTR:",
            value: "",
            resolved: true,
        });
    });
});
