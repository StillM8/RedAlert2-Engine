import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { MapList } from "@/engine/MapList";
import type { GameModeEntry, GameModes } from "@/game/ini/GameModes";

function mode(mapFilter: string): GameModeEntry {
    return { mapFilter } as GameModeEntry;
}

function gameModes(...entries: GameModeEntry[]): GameModes {
    return { getAll: () => entries } as GameModes;
}

describe("multiplayer map catalogs", () => {
    test("loads CnCNet-style paths, literal titles, and plural GameModes", () => {
        const standard = mode("standard");
        const noBases = mode("no bases");
        const mapList = new MapList(gameModes(standard, noBases));

        mapList.addFromIni(new IniFile(String.raw`
[MultiMaps]
0=MapsMO\Standard\ActionReaction

[MapsMO\Standard\ActionReaction]
Description=(2) Action Reaction
MaxPlayers=2
GameModes=Standard,No Bases
`));

        const map = mapList.getByName("MAPSMO/standard/ACTIONREACTION.map");
        expect(map?.fileName).toBe("mapsmo/standard/actionreaction.map");
        expect(map?.uiName).toBe("NOSTR:(2) Action Reaction");
        expect(map?.gameModes).toEqual([standard, noBases]);
        expect(map?.getFullMapTitle({
            get: (key: string) => key.replace(/^NOSTR:/i, ""),
        } as any)).toBe("(2) Action Reaction");
    });

    test("keeps retail CSF keys and singular GameMode compatibility", () => {
        const standard = mode("standard");
        const mapList = new MapList(gameModes(standard));

        mapList.addFromIni(new IniFile(String.raw`
[MultiMaps]
0=MP03T4

[MP03T4]
File=Maps\MP03T4.map
Description=DESC:MP03T4
MaxPlayers=4
GameMode=STANDARD
`));

        const map = mapList.getByName("maps/mp03t4.map");
        expect(map?.uiName).toBe("DESC:MP03T4");
        expect(map?.gameModes).toEqual([standard]);
        expect(mapList.getByName("Maps\\MP03T4.map")).toBe(map);
        expect(mapList.getByName("../MP03T4.map")).toBeUndefined();
    });

    test("deduplicates Windows and web spellings as one map identity", () => {
        const standard = mode("standard");
        const mapList = new MapList(gameModes(standard));
        mapList.addFromIni(new IniFile(String.raw`
[MultiMaps]
0=First
[First]
File=MapsMO\Standard\Arena.map
Description=First
MaxPlayers=2
GameMode=standard
`));
        mapList.addFromIni(new IniFile(String.raw`
[MultiMaps]
0=Second
[Second]
File=mapsmo/standard/ARENA.map
Description=Replacement
MaxPlayers=4
GameMode=standard
`));

        expect(mapList.getAll()).toHaveLength(1);
        expect(mapList.getByName("MAPSMO\\STANDARD\\arena.map")?.maxSlots).toBe(4);
    });
});
