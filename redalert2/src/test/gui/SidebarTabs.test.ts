import { describe, expect, test } from "bun:test";
import { getSidebarTabFrame } from "@/gui/screen/game/component/hud/SidebarTabs";

describe("sidebar tab frame offsets", () => {
    test("preserves aggregate offsets for the four retail states", () => {
        expect([0, 1, 2, 3].map((state) => getSidebarTabFrame(12, state, 4)))
            .toEqual([12, 13, 14, 15]);
    });

    test("clamps a static custom-side tab to its only frame", () => {
        expect(getSidebarTabFrame(27, 3, 1)).toBe(27);
    });

    test("does not cross into the next aggregated asset", () => {
        expect(getSidebarTabFrame(40, 99, 4)).toBe(43);
    });
});
