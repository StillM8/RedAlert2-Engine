import { describe, expect, test } from "bun:test";
import { SidebarCategory } from "@/gui/screen/game/component/hud/viewmodel/SidebarModel";
import { getSidebarTabIconConfig, resolveSidebarTabIcon } from "@/gui/screen/game/component/hud/viewmodel/SidebarTabIconConfig";

describe("sidebar category icon mapping", () => {
    test("maps the four production categories to retail tab art", () => {
        expect([SidebarCategory.Structures, SidebarCategory.Armory, SidebarCategory.Infantry, SidebarCategory.Vehicles]
            .map((category) => getSidebarTabIconConfig(category)?.imageName))
            .toEqual(["tab00.shp", "tab01.shp", "tab02.shp", "tab03.shp"]);
    });

    test("keeps descriptive aliases bound to the canonical retail categories", () => {
        expect(SidebarCategory.Items).toBe(SidebarCategory.Structures);
        expect(SidebarCategory.Defense).toBe(SidebarCategory.Armory);
        expect(SidebarCategory.Tanks).toBe(SidebarCategory.Vehicles);
    });

    test("does not substitute another category when a side archive omits an icon", () => {
        const images = new Map([
            ["tab00.shp", { category: "items" }],
            ["tab03.shp", { category: "tanks" }],
        ]);

        expect(resolveSidebarTabIcon(SidebarCategory.Armory, images)).toBeUndefined();
        expect(resolveSidebarTabIcon(SidebarCategory.Tanks, images)).toEqual({
            imageName: "tab03.shp",
            image: { category: "tanks" },
        });
    });

    test("returns no icon when the exact category asset is unavailable", () => {
        expect(resolveSidebarTabIcon(SidebarCategory.Infantry, new Map())).toBeUndefined();
    });
});
