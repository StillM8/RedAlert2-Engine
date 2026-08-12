import { describe, expect, test } from "bun:test";
import { SidebarCategory } from "@/gui/screen/game/component/hud/viewmodel/SidebarModel";
import { getSidebarTabIconConfig, resolveSidebarTabIcon } from "@/gui/screen/game/component/hud/viewmodel/SidebarTabIconConfig";

describe("sidebar category icon mapping", () => {
    test("maps the four production categories to retail tab art", () => {
        expect([SidebarCategory.Items, SidebarCategory.Defense, SidebarCategory.Infantry, SidebarCategory.Tanks]
            .map((category) => getSidebarTabIconConfig(category).imageName))
            .toEqual(["tab00.shp", "tab01.shp", "tab02.shp", "tab03.shp"]);
    });

    test("falls back to the generic Items tab when a category asset is absent", () => {
        const images = new Map([
            ["tab00.shp", { category: "items" }],
            ["tab03.shp", { category: "tanks" }],
        ]);

        expect(resolveSidebarTabIcon(SidebarCategory.Defense, images)).toEqual({
            imageName: "tab00.shp",
            image: { category: "items" },
        });
        expect(resolveSidebarTabIcon(SidebarCategory.Tanks, images)).toEqual({
            imageName: "tab03.shp",
            image: { category: "tanks" },
        });
    });

    test("returns no icon when even the generic fallback is unavailable", () => {
        expect(resolveSidebarTabIcon(SidebarCategory.Infantry, new Map())).toBeUndefined();
    });
});
