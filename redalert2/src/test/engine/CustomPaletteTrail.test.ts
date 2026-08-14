import { describe, expect, test } from "bun:test";
import * as THREE from "three";

(globalThis as any).window = globalThis;
(globalThis as any).THREE = THREE;
const { TrailerSmokePlugin } = await import("@/engine/renderable/entity/plugin/TrailerSmokePlugin");

describe("custom palette trail rendering", () => {
    test("passes an animation's custom palette filename to the shared trailer renderer", () => {
        const position = new THREE.Vector3(2, 0, 3);
        const calls: any[][] = [];
        let effect: any;
        const gameObject: any = {
            position: { worldPosition: position, },
            art: { trailer: "CONFUBEAMTR", spawnDelay: 2, },
            isAircraft: () => false,
            isProjectile: () => true,
            isDebris: () => false,
        };
        const animation = {
            paletteType: "custom",
            customPaletteName: "oldunitpal.pal",
            art: { getBool: () => false, },
            translucent: false,
            translucency: 0,
        };
        const art = { getAnimation: () => animation };
        const plugin = new TrailerSmokePlugin(
            gameObject,
            art,
            { getPalette: (...args: any[]) => { calls.push(args); return {}; }, },
            { findByObjectArt: () => ({ numImages: 1, width: 1, height: 1, }), },
            { value: 1 },
        );

        plugin.onCreate({ addEffect: (value: any) => { effect = value; } });
        position.x += 1;
        plugin.update(0);

        expect(calls).toEqual([["custom", "oldunitpal.pal"]]);
        expect(effect).toBeDefined();
    });
});
