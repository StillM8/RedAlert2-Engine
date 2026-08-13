import { describe, expect, test } from "bun:test";
import {
    DEFAULT_MAX_CATCH_UP_TURNS,
    limitGameTurnsForFrame,
} from "@/engine/GameAnimationLoop";

describe("GameAnimationLoop fixed-step scheduling", () => {
    test("runs every due turn when rendering falls behind", () => {
        expect(limitGameTurnsForFrame(4, true)).toBe(4);
        expect(limitGameTurnsForFrame(12, true, 20)).toBe(12);
    });

    test("retains a bounded catch-up limit without dropping the debt", () => {
        expect(limitGameTurnsForFrame(240, true)).toBe(DEFAULT_MAX_CATCH_UP_TURNS);
        expect(limitGameTurnsForFrame(240, true, 0)).toBe(1);
    });

    test("keeps the one-turn behavior when frame skipping is disabled", () => {
        expect(limitGameTurnsForFrame(4, false)).toBe(1);
        expect(limitGameTurnsForFrame(1, false)).toBe(1);
    });
});
