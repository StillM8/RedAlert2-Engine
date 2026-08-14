import { describe, expect, test } from "bun:test";
import {
    getSimulationFrameForElapsed,
    getSimulationInterpolation,
} from "@/engine/GameAnimationLoop";

describe("game animation timing", () => {
    test("does not advance a turn before its full interval elapses", () => {
        expect(getSimulationFrameForElapsed(17, 33)).toBe(0);
        expect(getSimulationFrameForElapsed(33, 33)).toBe(1);
        expect(getSimulationFrameForElapsed(67, 33)).toBe(2);
    });

    test("keeps interpolation within the renderer's valid range", () => {
        expect(getSimulationInterpolation(17, 0, 33)).toBeCloseTo(17 / 33);
        expect(getSimulationInterpolation(33, 1, 33)).toBe(0);
        expect(getSimulationInterpolation(100, 0, 33)).toBe(1);
        expect(getSimulationInterpolation(-1, 0, 33)).toBe(0);
    });
});
