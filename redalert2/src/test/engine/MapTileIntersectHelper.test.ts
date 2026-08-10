import { describe, expect, test } from 'bun:test';
import { IsoCoords } from '@/engine/IsoCoords';
import { MapTileIntersectHelper } from '@/engine/util/MapTileIntersectHelper';

describe('MapTileIntersectHelper', () => {
    test('keeps tile centers aligned with the zoomed camera', () => {
        IsoCoords.init({ x: 0, y: 0 });
        const target = { rx: 4, ry: 2, z: 0 };
        const scene = {
            viewport: { x: 0, y: 0, width: 1200, height: 600 },
            cameraPan: { getPan: () => ({ x: 90, y: -35 }) },
            camera: { zoom: 1.75 },
        };
        const map = {
            tiles: {
                getByMapCoords: (x: number, y: number) => ({ rx: x, ry: y, z: 0 }),
            },
        };
        const helper = new MapTileIntersectHelper(map, scene);
        const screenPoint = helper.getTileCenterScreenPoint(target);

        expect(helper.getTileAtScreenPoint(screenPoint)).toMatchObject(target);
    });

    test('keeps viewport offsets in the same mapping', () => {
        IsoCoords.init({ x: 0, y: 0 });
        const target = { rx: 5, ry: 7, z: 0 };
        const scene = {
            viewport: { x: 140, y: 30, width: 900, height: 500 },
            cameraPan: { getPan: () => ({ x: -20, y: 40 }) },
            camera: { zoom: 1.4 },
        };
        const map = {
            tiles: {
                getByMapCoords: (x: number, y: number) => ({ rx: x, ry: y, z: 0 }),
            },
        };
        const helper = new MapTileIntersectHelper(map, scene);
        const screenPoint = helper.getTileCenterScreenPoint(target);

        expect(screenPoint.x).toBeGreaterThan(scene.viewport.x);
        expect(screenPoint.y).toBeGreaterThan(scene.viewport.y);
        expect(helper.getTileAtScreenPoint(screenPoint)).toMatchObject(target);
    });
});
