import { SidebarCategory } from "./SidebarModel";

export interface SidebarTabIconConfig {
    category: SidebarCategory;
    /** Retail RA2/YR filename for this semantic production category. */
    imageName: string;
    /** Generic tab art used when an incomplete side archive omits the icon. */
    fallbackImageName: string;
}

/**
 * RA2/YR keep the tab art in semantic production order, not in queue-type
 * declaration order: Items, Defense, Infantry, Tanks.  Keep this table
 * shared by HUD presentation and tests so custom Ares sides inherit the same
 * mapping without a profile or mod-name branch.
 */
export const SIDEBAR_TAB_ICON_CONFIG: readonly SidebarTabIconConfig[] = [
    { category: SidebarCategory.Items, imageName: "tab00.shp", fallbackImageName: "tab00.shp" },
    { category: SidebarCategory.Defense, imageName: "tab01.shp", fallbackImageName: "tab00.shp" },
    { category: SidebarCategory.Infantry, imageName: "tab02.shp", fallbackImageName: "tab00.shp" },
    { category: SidebarCategory.Tanks, imageName: "tab03.shp", fallbackImageName: "tab00.shp" },
];

export function getSidebarTabIconConfig(category: SidebarCategory): SidebarTabIconConfig {
    return SIDEBAR_TAB_ICON_CONFIG.find((config) => config.category === category)
        ?? SIDEBAR_TAB_ICON_CONFIG[SidebarCategory.Items];
}

export function resolveSidebarTabIcon<T>(
    category: SidebarCategory,
    images: ReadonlyMap<string, T>,
): { imageName: string; image: T } | undefined {
    const config = getSidebarTabIconConfig(category);
    for (const imageName of [config.imageName, config.fallbackImageName]) {
        const image = images.get(imageName);
        if (image !== undefined) {
            return { imageName, image };
        }
    }
    return undefined;
}
