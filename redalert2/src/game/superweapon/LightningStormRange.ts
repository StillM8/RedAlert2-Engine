import type { AresSuperWeaponRange } from "@/game/superweapon/AresSuperWeaponRange";

/**
 * Lightning Storm uses SW.Range for its random strike area. A single value is
 * the diameter of the circular area in the Ares documentation; two values
 * describe a rectangle. This is intentionally separate from the object-area
 * resolver because Lightning's one-value default is expressed as a diameter.
 */
export function isLightningStormTileInRange(
    center: { rx: number; ry: number } | undefined,
    tile: { rx: number; ry: number } | undefined,
    range: AresSuperWeaponRange,
): boolean {
    if (!center || !tile || range.widthOrRange < 0) return false;
    if (range.height > 0) {
        const width = Math.max(0, Math.trunc(range.widthOrRange));
        const height = Math.max(0, Math.trunc(range.height));
        const left = center.rx - Math.trunc(width / 2);
        const top = center.ry - Math.trunc(height / 2);
        return tile.rx >= left && tile.rx < left + width &&
            tile.ry >= top && tile.ry < top + height;
    }
    const radius = range.widthOrRange / 2;
    const dx = tile.rx - center.rx;
    const dy = tile.ry - center.ry;
    return dx * dx + dy * dy <= radius * radius;
}
