import { describe, expect, test } from "bun:test";
import { MapLighting } from "@/data/map/MapLighting";
import { AresSuperWeaponLightingFx } from "@/engine/gfx/lighting/AresSuperWeaponLightingFx";

describe("Ares superweapon lighting", () => {
    test("applies authored colors and leaves -1 values at map defaults", () => {
        const fx = new AresSuperWeaponLightingFx({
            lightEnabled: true,
            lightAmbient: 120,
            lightRed: -1,
            lightGreen: 20,
            lightBlue: 30,
        }, 3.8);
        const base = new MapLighting();
        base.ambient = 1;
        base.red = 0.8;
        base.green = 0.8;
        base.blue = 0.8;
        fx.mapLighting.copy(base);
        (fx as any).startTime = 0;

        expect(fx.update(0, 1)).toEqual({ done: false, updated: true });
        expect(fx.mapLighting.ambient).toBe(120);
        expect(fx.mapLighting.red).toBe(0.8);
        expect(fx.mapLighting.green).toBe(20);
        expect(fx.mapLighting.blue).toBe(30);
        expect(fx.update(4000, 1).done).toBe(true);
    });
});
