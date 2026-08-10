import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import {
    getFoundationBlockingCells,
    getFoundationBounds,
    getFoundationCells,
    getFoundationRallyCell,
    getNearestFoundationCell,
    parseFoundation,
} from "@/game/art/Foundation";
import { TileOccupation } from "@/game/map/TileOccupation";
import { TileOcclusion } from "@/game/map/TileOcclusion";
import { TerrainType } from "@/engine/type/TerrainType";
import { LandType } from "@/game/type/LandType";

describe("Ares custom foundations", () => {
    test("parses occupied cells and an outline outside the bounding box", () => {
        const section = new IniSection("CustomBuilding");
        section.set("Foundation", "Custom");
        section.set("Foundation.X", "3");
        section.set("Foundation.Y", "3");
        section.set("Foundation.0", "0,0");
        section.set("Foundation.1", "1,0");
        section.set("Foundation.2", "2,0");
        section.set("Foundation.3", "0,1");
        section.set("Foundation.4", "1,1");
        section.set("Foundation.5", "0,2");
        section.set("Foundation.6", "1,2");
        section.set("Foundation.7", "2,2");
        section.set("FoundationOutline.Length", "4");
        section.set("FoundationOutline.0", "-1,-1");
        section.set("FoundationOutline.1", "0,-1");
        section.set("FoundationOutline.2", "3,1");
        section.set("FoundationOutline.3", "3,3");

        const foundation = parseFoundation(section);
        expect(foundation.width).toBe(3);
        expect(foundation.height).toBe(3);
        expect(foundation.cells).toHaveLength(8);
        expect(foundation.cells).not.toContainEqual({ x: 2, y: 1 });
        expect(foundation.outline).toEqual([
            { x: -1, y: -1 },
            { x: 0, y: -1 },
            { x: 3, y: 1 },
            { x: 3, y: 3 },
        ]);
        expect(getFoundationBounds(foundation)).toEqual({ x: 0, y: 0, width: 3, height: 3 });
        expect(getFoundationBounds(foundation, true)).toEqual({ x: -1, y: -1, width: 5, height: 5 });
        expect(getFoundationBlockingCells(foundation).map(({ x, y }) => `${x},${y}`)).not.toContain("2,1");
        expect(getNearestFoundationCell(foundation, { x: 2, y: 1 })).toEqual({ x: 2, y: 0 });
        expect(getFoundationRallyCell(foundation)).toEqual({ x: 3, y: 1 });
    });

    test("keeps vanilla rectangular foundations unchanged", () => {
        const section = new IniSection("VanillaBuilding");
        section.set("Foundation", "2x3");

        const foundation = parseFoundation(section);
        expect(foundation).toEqual({ width: 2, height: 3 });
        expect(getFoundationCells(foundation)).toHaveLength(6);
    });

    test("falls back safely when a custom foundation has no cells", () => {
        const section = new IniSection("MalformedCustomBuilding");
        section.set("Foundation", "Custom");
        section.set("Foundation.X", "2");
        section.set("Foundation.Y", "2");

        const foundation = parseFoundation(section);
        expect(foundation.cells).toBeUndefined();
        expect(getFoundationCells(foundation)).toEqual([
            { x: 0, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
        ]);
    });

    test("occupies only declared custom foundation cells", () => {
        const section = new IniSection("CustomBuilding");
        section.set("Foundation", "Custom");
        section.set("Foundation.X", "2");
        section.set("Foundation.Y", "2");
        section.set("Foundation.0", "0,0");
        section.set("Foundation.1", "1,0");
        section.set("Foundation.2", "0,1");
        const foundation = parseFoundation(section);
        const tiles = Array.from({ length: 4 }, (_, index) => ({
            rx: 10 + index % 2,
            ry: 20 + Math.floor(index / 2),
            terrainType: TerrainType.Clear,
            landType: LandType.Clear,
        }));
        const tileCollection = {
            getAll: () => tiles,
            getByMapCoords: (x: number, y: number) => tiles.find((tile) => tile.rx === x && tile.ry === y),
        };
        const occupation = new TileOccupation(tileCollection);
        const occupied = occupation.calculateTilesForGameObject(
            { rx: 10, ry: 20 },
            { getFoundation: () => foundation },
        );

        expect(occupied.map((tile: any) => `${tile.rx},${tile.ry}`)).toEqual([
            "10,20",
            "11,20",
            "10,21",
        ]);

        const building = {
            getFoundation: () => foundation,
            isOverlay: () => false,
            isBuilding: () => true,
            rules: { wall: false },
        };
        occupation.occupyTileRange({ rx: 10, ry: 20 }, building);
        expect(occupation.getObjectsOnTile(tiles[0])).toHaveLength(1);
        expect(occupation.getObjectsOnTile(tiles[3])).toHaveLength(0);
        occupation.unoccupyTileRange({ rx: 10, ry: 20 }, building);
        expect(occupation.getObjectsOnTile(tiles[0])).toHaveLength(0);
    });

    test("uses custom occupied cells for building occlusion instead of the rectangle", () => {
        const foundation = {
            width: 3,
            height: 3,
            cells: [{ x: 0, y: 0 }],
        };
        const tiles = Array.from({ length: 8 * 8 }, (_, index) => ({
            rx: index % 8,
            ry: Math.floor(index / 8),
        }));
        const tileCollection = {
            getAll: () => tiles,
            getByMapCoords: (x: number, y: number) => tiles.find((tile) => tile.rx === x && tile.ry === y),
        };
        const occlusion = new TileOcclusion(tileCollection);
        const shadowTiles = occlusion.calculateTilesForGameObject({
            tile: { rx: 3, ry: 3 },
            art: {
                occupyHeight: 3,
                addOccupy: [],
                removeOccupy: [],
            },
            getFoundation: () => foundation,
        });

        expect(shadowTiles.map((tile: any) => `${tile.rx},${tile.ry}`)).toEqual(["2,2"]);
    });
});
