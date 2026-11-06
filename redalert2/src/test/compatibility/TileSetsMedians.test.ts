import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { TileSets } from "@/game/theater/TileSets";

describe("theater General Medians", () => {
    test("defaults missing Medians to tile set 71", () => {
        const ini = new IniFile();
        const general = ini.getOrCreateSection("General");
        general.set("GreenTile", "10");
        general.set("PaveTile", "20");
        const tileSets = new TileSets(ini) as any;
        tileSets.tileSets = Array.from({ length: 71 }, () => ({}));

        expect(tileSets.getGeneralValue("Medians")).toBe(71);
        expect(tileSets.canConnectTiles(20, 71)).toBe(false);
        expect(tileSets.canConnectTiles(20, 70)).toBe(true);
    });
});
