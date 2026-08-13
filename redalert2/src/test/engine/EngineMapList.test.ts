import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { Engine, EngineType } from "@/engine/Engine";
import { GAME_PROFILES } from "@/engine/GameProfile";
import { MapList } from "@/engine/MapList";
import type { GameModeEntry, GameModes } from "@/game/ini/GameModes";

describe("Engine map discovery", () => {
    test("does not mount deferred gameplay archives or read catalogued loose maps", async () => {
        const previous = {
            activeEngine: Engine.getActiveEngine(),
            activeProfile: (Engine as any).activeProfile,
            vfs: Engine.vfs,
            rfs: Engine.rfs,
            mapList: (Engine as any).mapList,
            mapListGameModes: (Engine as any).mapListGameModes,
            mapListLoadPromise: (Engine as any).mapListLoadPromise,
            mapListLoadScheduled: (Engine as any).mapListLoadScheduled,
            loadedMapListFiles: (Engine as any).loadedMapListFiles,
        };
        const standard = { mapFilter: "standard" } as GameModeEntry;
        const modes = { getAll: () => [standard] } as GameModes;
        const mapList = new MapList(modes).addFromIni(new IniFile(String.raw`
[MultiMaps]
0=MapsMO\Standard\Known
[MapsMO\Standard\Known]
Description=(2) Known
MaxPlayers=2
GameModes=Standard
`));
        let deferredGameplayLoads = 0;
        let deferredMapArchiveLoads = 0;
        const openedFiles: string[] = [];
        const customMap = new TextEncoder().encode(`
[Basic]
Name=Custom Arena
Official=yes
GameMode=standard
[Waypoints]
0=100
1=200
`);

        try {
            (Engine as any).activeProfile = GAME_PROFILES["mental-omega"];
            Engine.setActiveEngine(EngineType.YurisRevenge);
            (Engine as any).mapList = mapList;
            (Engine as any).mapListGameModes = modes;
            (Engine as any).mapListLoadPromise = undefined;
            (Engine as any).mapListLoadScheduled = false;
            (Engine as any).loadedMapListFiles = new Set(["ini/mentalomegamaps.ini"]);
            Engine.vfs = {
                loadDeferredExtraMixFiles: async () => { deferredGameplayLoads++; },
                loadDeferredMapArchives: async () => { deferredMapArchiveLoads++; },
                listArchives: () => [],
                fileExists: () => false,
                listRfsFileEntries: async () => [
                    {
                        path: "MapsMO (1)/Standard/Known.map",
                        effectivePath: "MapsMO/Standard/Known.map",
                        directoryIndex: 1,
                    },
                    {
                        path: "Maps/Custom.map",
                        effectivePath: "Maps/Custom.map",
                        directoryIndex: 2,
                    },
                ],
            } as any;
            Engine.rfs = {
                openFile: async (fileName: string) => {
                    openedFiles.push(fileName);
                    return VirtualFile.fromBytes(customMap, fileName);
                },
            } as any;

            const result = await Engine.loadMapList();

            expect(deferredGameplayLoads).toBe(0);
            expect(deferredMapArchiveLoads).toBe(0);
            expect(openedFiles).toEqual(["Maps/Custom.map"]);
            expect(result.getByName("MapsMO/Standard/Known.map")).toBeDefined();
            expect(result.getByName("maps/custom.map")?.uiName).toBe("NOSTR:Custom Arena");
        }
        finally {
            Engine.vfs = previous.vfs;
            Engine.rfs = previous.rfs;
            (Engine as any).activeProfile = previous.activeProfile;
            (Engine as any).mapList = previous.mapList;
            (Engine as any).mapListGameModes = previous.mapListGameModes;
            (Engine as any).mapListLoadPromise = previous.mapListLoadPromise;
            (Engine as any).mapListLoadScheduled = previous.mapListLoadScheduled;
            (Engine as any).loadedMapListFiles = previous.loadedMapListFiles;
            Engine.setActiveEngine(previous.activeEngine);
        }
    });
});
