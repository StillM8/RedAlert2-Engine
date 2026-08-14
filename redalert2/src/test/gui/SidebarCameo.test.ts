import { describe, expect, test } from "bun:test";
import { ShpImage } from "@/data/ShpImage";
import { normalizeSidebarCameoFrame } from "@/gui/screen/game/component/hud/SidebarCameo";

describe("sidebar cameo frame normalization", () => {
    test("copies a cropped frame into the fixed slot canvas", () => {
        const image = new ShpImage(
            Uint8Array.from([1, 2, 3, 4, 5, 6]),
            3,
            2,
            2,
            1,
        );

        const normalized = normalizeSidebarCameoFrame(image, { width: 8, height: 6 });

        expect(normalized.width).toBe(8);
        expect(normalized.height).toBe(6);
        expect(normalized.x).toBe(0);
        expect(normalized.y).toBe(0);
        expect([...normalized.imageData]).toEqual([
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 1, 2, 3, 0, 0, 0,
            0, 0, 4, 5, 6, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
        ]);
    });

    test("clips negative and out-of-bounds frame offsets", () => {
        const image = new ShpImage(
            Uint8Array.from([1, 2, 3, 4, 5, 6]),
            3,
            2,
            -1,
            2,
        );

        const normalized = normalizeSidebarCameoFrame(image, { width: 2, height: 3 });

        expect([...normalized.imageData]).toEqual([
            0, 0,
            0, 0,
            2, 3,
        ]);
    });
});
