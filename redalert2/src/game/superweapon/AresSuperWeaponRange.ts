import type { TileCoord } from "@/game/superweapon/SuperWeaponEffect";

/**
 * The common Ares SW.Range shape. A positive height selects a rectangle;
 * zero/omitted height selects a circular cell range. A negative width is the
 * documented full-map sentinel.
 */
export interface AresSuperWeaponRange {
    widthOrRange: number;
    height: number;
}

export interface AresRangeFallback {
    widthOrRange: number;
    height: number;
}

function finiteOr(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Normalize the one- or two-value SW.Range syntax. A single authored value is
 * a circle/radius, while two values describe a rectangle. This mirrors the
 * Antares helper's distinction between width/height and radius.
 */
export function resolveAresSuperWeaponRange(
    range: readonly number[] | undefined,
    fallback: AresRangeFallback,
): AresSuperWeaponRange {
    if (!range || range.length === 0) {
        return {
            widthOrRange: fallback.widthOrRange,
            height: fallback.height,
        };
    }

    return {
        widthOrRange: finiteOr(range[0], fallback.widthOrRange),
        height: range.length > 1 ? finiteOr(range[1], -1) : -1,
    };
}

function objectTiles(object: any, tileOccupation?: any): any[] {
    if (object?.tile && tileOccupation?.calculateTilesForGameObject) {
        try {
            const tiles = tileOccupation.calculateTilesForGameObject(object.tile, object);
            if (Array.isArray(tiles) && tiles.length) return tiles;
        }
        catch {
            // Lightweight hosts/test doubles may not provide complete
            // foundation data. Fall back to the object's anchor tile.
        }
    }
    const tile = object?.centerTile ?? object?.tile;
    return tile ? [tile] : [];
}

/**
 * Check whether any occupied cell of an object intersects an Ares area.
 * Multi-cell objects are intentionally evaluated by occupied cells rather
 * than by their visual/bounding rectangle.
 */
export function isAresSuperWeaponInRange(
    center: TileCoord | undefined,
    object: any,
    range: AresSuperWeaponRange,
    tileOccupation?: any,
): boolean {
    if (range.widthOrRange < 0) return true;
    if (!center) return false;

    const tiles = objectTiles(object, tileOccupation);
    if (!tiles.length) return false;

    if (range.height > 0) {
        const width = Math.max(0, Math.trunc(range.widthOrRange));
        const height = Math.max(0, Math.trunc(range.height));
        if (width <= 0 || height <= 0) return false;

        const left = center.rx - Math.trunc(width / 2);
        const top = center.ry - Math.trunc(height / 2);
        const right = left + width;
        const bottom = top + height;
        return tiles.some(tile =>
            tile.rx >= left && tile.rx < right &&
            tile.ry >= top && tile.ry < bottom,
        );
    }

    const radiusSquared = range.widthOrRange * range.widthOrRange;
    return tiles.some(tile => {
        const dx = tile.rx - center.rx;
        const dy = tile.ry - center.ry;
        return dx * dx + dy * dy <= radiusSquared;
    });
}
