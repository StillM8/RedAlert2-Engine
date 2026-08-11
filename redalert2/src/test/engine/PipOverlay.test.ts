import { describe, expect, test } from "bun:test";
import { HEALTH_LEVEL_TO_IMAGE } from "@/engine/renderable/entity/PipOverlay";
import { HealthLevel } from "@/game/gameobject/unit/HealthLevel";

describe("PipOverlay health pip frames", () => {
    test("uses the green/yellow/red unit-health frames from pips.shp", () => {
        expect(HEALTH_LEVEL_TO_IMAGE.get(HealthLevel.Green)).toBe(16);
        expect(HEALTH_LEVEL_TO_IMAGE.get(HealthLevel.Yellow)).toBe(17);
        expect(HEALTH_LEVEL_TO_IMAGE.get(HealthLevel.Red)).toBe(18);
    });
});
