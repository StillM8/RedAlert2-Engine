import { describe, expect, test } from "bun:test";
import {
    resolveAlphaImageFacings,
    resolveAlphaImageFacingFrame,
} from "@/engine/renderable/AlphaRenderable";

describe("AlphaImage frame selection", () => {
    test("uses the largest power-of-two facing count", () => {
        expect(resolveAlphaImageFacings(1)).toEqual({ count: 1, offset: 0 });
        expect(resolveAlphaImageFacings(6)).toEqual({ count: 4, offset: 0 });
        expect(resolveAlphaImageFacings(8)).toEqual({ count: 8, offset: 0 });
        expect(resolveAlphaImageFacings(9)).toEqual({ count: 8, offset: 0 });
    });

    test("maps directions into the selected facing range", () => {
        expect(resolveAlphaImageFacingFrame(45, 8)).toBe(1);
        expect(resolveAlphaImageFacingFrame(90, 8)).toBe(2);
        expect(resolveAlphaImageFacingFrame(0, 8)).toBe(0);
        expect(resolveAlphaImageFacingFrame(45, 6)).toBe(0);
    });
});
