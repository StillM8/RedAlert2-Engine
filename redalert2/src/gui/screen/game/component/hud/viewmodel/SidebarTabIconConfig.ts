import { SidebarCategory } from "./SidebarModel";

export interface SidebarTabIconConfig {
    category: SidebarCategory;
    /** Retail RA2/YR filename for this semantic production category. */
    imageName: string;
}

/**
 * The tab files are semantic retail assets. Their names must be resolved
 * independently from the queue enum and must never fall back to another
 * category: a missing tab asset is an archive/provenance error, not a reason
 * to display the Structures icon for every tab.
 */
export const SIDEBAR_TAB_ICON_CONFIG: readonly SidebarTabIconConfig[] = [
    { category: SidebarCategory.Structures, imageName: "tab00.shp" },
    { category: SidebarCategory.Armory, imageName: "tab01.shp" },
    { category: SidebarCategory.Infantry, imageName: "tab02.shp" },
    { category: SidebarCategory.Vehicles, imageName: "tab03.shp" },
];

export function getSidebarTabIconConfig(category: SidebarCategory): SidebarTabIconConfig | undefined {
    return SIDEBAR_TAB_ICON_CONFIG.find((config) => config.category === category)
}

export function resolveSidebarTabIcon<T>(
    category: SidebarCategory,
    images: ReadonlyMap<string, T>,
): { imageName: string; image: T } | undefined {
    const config = getSidebarTabIconConfig(category);
    if (!config) {
        return undefined;
    }
    const image = images.get(config.imageName);
    if (image !== undefined) {
        return { imageName: config.imageName, image };
    }
    return undefined;
}
