import { describe, expect, test } from "bun:test";
import { DataStream } from "@/data/DataStream";
import { MemArchive } from "@/data/vfs/MemArchive";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
import { CampaignCatalogService } from "@/campaign/CampaignService";

function file(name: string, text: string): VirtualFile {
    return new VirtualFile(new DataStream(new TextEncoder().encode(text)), name);
}

function vfsWith(files: Array<[string, string]>): VirtualFileSystem {
    const archive = new MemArchive();
    for (const [name, text] of files) {
        archive.addFile(file(name, text));
    }
    const vfs = new VirtualFileSystem(undefined, {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    });
    vfs.addArchive(archive, "campaign-test");
    return vfs;
}

describe("campaign catalog service", () => {
    test("loads preferred effective INI files and discovered battle clients", () => {
        const vfs = vfsWith([
            ["battlemo.ini", "[#include]\ninclude=mo-campaign.inc\n"],
            ["mo-campaign.inc", "[Battles]\n1=MO1\n[MO1]\nScenario=mo1.map\n"],
            ["uimd.ini", "[UISettings]\nCampaignList=yes\nShowDebugCampaigns=yes\n"],
            ["INI/BattleClient07.ini", "[Battles]\n2=CLIENT2\n[CLIENT2]\nScenario=client2.map\nDebugOnly=yes\n"],
        ]);
        const catalog = new CampaignCatalogService(vfs, "mental-omega").load();
        expect(catalog.campaigns.map((campaign) => campaign.id)).toEqual(["MO1", "CLIENT2"]);
        expect(catalog.sourceFiles.battle).toEqual(["battlemo.ini"]);
        expect(catalog.sourceFiles.battleClients).toEqual(["INI/BattleClient07.ini"]);
        expect(catalog.settings.campaignList).toBe(true);
    });

    test("falls back to the next available profile alias", () => {
        const vfs = vfsWith([
            ["battlemd.ini", "[Battles]\n1=YR1\n[YR1]\nScenario=yr1.map\n"],
        ]);
        const catalog = new CampaignCatalogService(vfs, "mental-omega").load();
        expect(catalog.campaigns[0].id).toBe("YR1");
        expect(catalog.sourceFiles.battle).toEqual(["battlemd.ini"]);
    });
});
