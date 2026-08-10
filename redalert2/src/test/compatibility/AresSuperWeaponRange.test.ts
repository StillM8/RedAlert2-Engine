import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { createDefaultAresFeatureRegistry } from "@/extensions/ares/AresFeatureRegistry";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import {
    isAresSuperWeaponInRange,
    resolveAresSuperWeaponRange,
} from "@/game/superweapon/AresSuperWeaponRange";
import { MapShroud, ShroudType } from "@/game/map/MapShroud";
import { TerrainType } from "@/engine/type/TerrainType";

describe("Ares superweapon range", () => {
    test("parses SW.Range and reports the documented capability", () => {
        const ini = new IniFile(`
[Dominator]
Type=PsychicDominator
SW.Range=3,3
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("Dominator")!);
        const report = scanMentalOmegaIniSources([
            { name: "rulesmd.ini", contents: ini.toString() },
        ], createDefaultAresFeatureRegistry());

        expect(definition?.swRange).toEqual([3, 3]);
        expect(report.featureUsage.find((usage) => usage.featureId === "ares.superweapon-range")).toMatchObject({
            occurrences: 1,
            support: { parserImplemented: true, runtimeImplemented: true },
        });
    });

    test("resolves circle, rectangle, fallback, and full-map ranges", () => {
        expect(resolveAresSuperWeaponRange(undefined, { widthOrRange: 4, height: 5 })).toEqual({
            widthOrRange: 4,
            height: 5,
        });
        expect(resolveAresSuperWeaponRange([3], { widthOrRange: 4, height: 5 })).toEqual({
            widthOrRange: 3,
            height: -1,
        });

        const center = { rx: 10, ry: 10, z: 0 };
        expect(isAresSuperWeaponInRange(center, { tile: { rx: 12, ry: 10, z: 0 } }, { widthOrRange: 3, height: -1 })).toBe(true);
        expect(isAresSuperWeaponInRange(center, { tile: { rx: 14, ry: 10, z: 0 } }, { widthOrRange: 3, height: -1 })).toBe(false);
        expect(isAresSuperWeaponInRange(center, { tile: { rx: 9, ry: 9, z: 0 } }, { widthOrRange: 3, height: 3 })).toBe(true);
        expect(isAresSuperWeaponInRange(center, { tile: { rx: 13, ry: 10, z: 0 } }, { widthOrRange: 3, height: 3 })).toBe(false);
        expect(isAresSuperWeaponInRange(undefined, { tile: { rx: 999, ry: 999, z: 0 } }, { widthOrRange: -1, height: -1 })).toBe(true);
    });

    test("matches a multi-cell object when any occupied cell intersects", () => {
        const center = { rx: 10, ry: 10, z: 0 };
        const object = {
            tile: { rx: 12, ry: 10, z: 0 },
        };
        const tileOccupation = {
            calculateTilesForGameObject: () => [
                { rx: 12, ry: 10, z: 0 },
                { rx: 10, ry: 10, z: 0 },
            ],
        };

        expect(isAresSuperWeaponInRange(
            center,
            object,
            { widthOrRange: 0, height: -1 },
            tileOccupation,
        )).toBe(true);
    });

    test("applies a rectangular range to shroud without widening it to a circle", () => {
        const tiles = Array.from({ length: 8 }, (_, ry) =>
            Array.from({ length: 8 }, (_, rx) => ({ rx, ry, z: 0, terrainType: TerrainType.Clear }))
        ).flat();
        const map = {
            getMapSize: () => ({ width: 8, height: 8 }),
            getMaxTileHeight: () => 0,
            getAll: () => tiles,
            getByMapCoords: (rx: number, ry: number) => tiles.find((tile) => tile.rx === rx && tile.ry === ry),
        };
        const shroud = new MapShroud().fromTiles(map);

        shroud.revealArea({ rx: 4, ry: 4, z: 0, terrainType: TerrainType.Clear }, 4, 2);
        shroud.update();

        expect(shroud.getShroudTypeByTileCoords(2, 3, 0)).toBe(ShroudType.Explored);
        expect(shroud.getShroudTypeByTileCoords(5, 4, 0)).toBe(ShroudType.Explored);
        expect(shroud.getShroudTypeByTileCoords(1, 4, 0)).toBe(ShroudType.Unexplored);
        expect(shroud.getShroudTypeByTileCoords(4, 2, 0)).toBe(ShroudType.Unexplored);
    });

});
