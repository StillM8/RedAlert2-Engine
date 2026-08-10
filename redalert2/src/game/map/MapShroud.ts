import { EventDispatcher } from '../../util/event';
import { GameSpeed } from '../GameSpeed';
import { TerrainType } from '../../engine/type/TerrainType';
import { clamp } from '../../util/math';
export enum ShroudType {
    Unexplored = 0,
    TemporaryReveal = 1,
    Explored = 2
}
export enum ShroudFlag {
    Darken = 8
}
interface Size {
    width: number;
    height: number;
}
interface ShroudCoords {
    sx: number;
    sy: number;
}
interface WorldCoords {
    rx: number;
    ry: number;
}
interface Tile {
    rx: number;
    ry: number;
    z: number;
    terrainType: TerrainType;
}
interface TileMap {
    getMapSize(): Size;
    getMaxTileHeight(): number;
    getAll(): Tile[];
    getByMapCoords(rx: number, ry: number): Tile | undefined;
}
interface Invalidation {
    center: ShroudCoords;
    elevation: number;
    radius?: number;
    rectangles: Array<{ width: number; height: number }>;
}
export class MapShroud {
    private invalidations: Map<number, Invalidation>;
    private temporaryReveals: Map<ShroudCoords, number>;
    private fullInvalidation: boolean;
    private _onChange: EventDispatcher;
    private padding: number;
    private size: Size;
    private tiles: Uint8Array;
    private tileElevation: Uint8Array;
    private static readonly TEMPORARY_REVEAL_DURATION = 5;
    private static readonly OBJECT_REVEAL_RADIUS = 4.25;
    private static readonly SHROUD_TYPE_BITS = 3;
    private static readonly SHROUD_TYPE_MASK = (1 << MapShroud.SHROUD_TYPE_BITS) - 1;
    constructor() {
        this.invalidations = new Map();
        this.temporaryReveals = new Map();
        this.fullInvalidation = false;
        this._onChange = new EventDispatcher();
    }
    get onChange() {
        return this._onChange.asEvent();
    }
    fromTiles(map: TileMap): this {
        const mapSize = map.getMapSize();
        const maxHeight = map.getMaxTileHeight();
        this.padding = (maxHeight + (maxHeight % 2)) / 2;
        this.size = {
            width: mapSize.width + this.padding,
            height: mapSize.height + this.padding
        };
        this.tiles = new Uint8Array(this.size.width * this.size.height);
        this.tiles.fill(ShroudType.Unexplored);
        this.tileElevation = new Uint8Array(this.size.width * this.size.height);
        for (const tile of map.getAll()) {
            const index = this.getTileIndex(tile);
            this.tileElevation[index] = Math.max(this.tileElevation[index], tile.terrainType === TerrainType.Cliff && tile.z > 0 ? tile.z - 1 : tile.z);
        }
        return this;
    }
    getSize(): Size {
        return this.size;
    }
    getTileIndex(tile: Tile): number {
        const { sx, sy } = this.rxyzToSxy(tile.rx, tile.ry, tile.z);
        return sx + sy * this.size.width;
    }
    rxyzToSxy(rx: number, ry: number, z: number): ShroudCoords {
        const adjustedZ = (z |= 0) + (z % 2);
        return {
            sx: rx - adjustedZ / 2 + this.padding,
            sy: ry - adjustedZ / 2 + this.padding
        };
    }
    sxyzToRxy(sx: number, sy: number, z: number): WorldCoords {
        return {
            rx: sx + Math.ceil(z / 2) - this.padding,
            ry: sy + Math.ceil(z / 2) - this.padding
        };
    }
    shroudCoordsToWorld(coords: ShroudCoords): WorldCoords {
        return this.sxyzToRxy(coords.sx, coords.sy, 0);
    }
    findTilesAtShroudCoords(coords: ShroudCoords, map: TileMap): Tile[] {
        const maxHeight = map.getMaxTileHeight();
        const adjustedMaxHeight = maxHeight + (maxHeight % 2);
        const tiles: Tile[] = [];
        for (let z = 0; z <= adjustedMaxHeight; z += 2) {
            const adjustedZ = z + (z % 2);
            const { rx, ry } = this.sxyzToRxy(coords.sx, coords.sy, adjustedZ);
            const tile = map.getByMapCoords(rx, ry);
            if (tile?.z === z) {
                tiles.push(tile);
            }
        }
        return tiles;
    }
    clone(): MapShroud {
        const clone = new MapShroud();
        clone.tiles = this.tiles.slice();
        clone.size = this.size;
        clone.padding = this.padding;
        clone.tileElevation = this.tileElevation;
        return clone;
    }
    copy(other: MapShroud): void {
        this.tiles = other.tiles.slice();
        this.size = other.size;
        this.padding = other.padding;
        this.tileElevation = other.tileElevation;
    }
    merge(other: MapShroud): void {
        if (this.size.width !== other.size.width || this.size.height !== other.size.height) {
            throw new Error("Size mismatch");
        }
        const otherTiles = other.tiles;
        for (let i = 0, len = this.tiles.length; i < len; i++) {
            this.tiles[i] =
                Math.max(otherTiles[i] & MapShroud.SHROUD_TYPE_MASK, this.tiles[i] & MapShroud.SHROUD_TYPE_MASK) |
                    (((otherTiles[i] | this.tiles[i]) >> MapShroud.SHROUD_TYPE_BITS) << MapShroud.SHROUD_TYPE_BITS);
        }
    }
    isShrouded(tile: Tile, offset: number = 0): boolean {
        const coords = this.rxyzToSxy(tile.rx, tile.ry, tile.z + offset);
        return this.getShroudTypeByShroudCoords(coords) === ShroudType.Unexplored;
    }
    getShroudType(tile: Tile): ShroudType {
        return this.tiles[this.getTileIndex(tile)] & MapShroud.SHROUD_TYPE_MASK;
    }
    isFlagged(tile: Tile, flag: number): boolean {
        return (this.tiles[this.getTileIndex(tile)] & flag) !== 0;
    }
    getShroudTypeByTileCoords(rx: number, ry: number, z: number): ShroudType {
        return this.getShroudTypeByShroudCoords(this.rxyzToSxy(rx, ry, z));
    }
    getShroudTypeByShroudCoords({ sx, sy }: ShroudCoords): ShroudType {
        return sx < 0 || sy < 0 || sx >= this.size.width || sy >= this.size.height
            ? ShroudType.Unexplored
            : this.tiles[sx + sy * this.size.width] & MapShroud.SHROUD_TYPE_MASK;
    }
    invalidateFull(): void {
        this.fullInvalidation = true;
    }
    invalidate(coords: ShroudCoords, elevation: number, radius: number): void {
        const index = coords.sx + coords.sy * this.size.width;
        let invalidation = this.invalidations.get(index);
        if (!invalidation) {
            invalidation = { center: coords, elevation: 0, rectangles: [] };
            this.invalidations.set(index, invalidation);
        }
        invalidation.elevation = Math.max(invalidation.elevation, elevation);
        invalidation.radius = Math.max(invalidation.radius ?? 0, radius);
    }
    invalidateRectangle(coords: ShroudCoords, elevation: number, width: number, height: number): void {
        const normalizedWidth = Math.max(0, Math.trunc(width));
        const normalizedHeight = Math.max(0, Math.trunc(height));
        if (normalizedWidth <= 0 || normalizedHeight <= 0) return;

        const index = coords.sx + coords.sy * this.size.width;
        let invalidation = this.invalidations.get(index);
        if (!invalidation) {
            invalidation = { center: coords, elevation: 0, rectangles: [] };
            this.invalidations.set(index, invalidation);
        }
        invalidation.elevation = Math.max(invalidation.elevation, elevation);
        const existing = invalidation.rectangles.find((rectangle) =>
            rectangle.width === normalizedWidth && rectangle.height === normalizedHeight);
        if (!existing) {
            invalidation.rectangles.push({ width: normalizedWidth, height: normalizedHeight });
        }
    }
    revealFrom(object: {
        isBuilding(): boolean;
        wallTrait?: boolean;
        sight?: number;
        tile: Tile;
        tileElevation: number;
    }): void {
        if (!object.isBuilding() || !object.wallTrait) {
            if (object.sight) {
                const elevation = object.tile.z + object.tileElevation;
                const coords = this.rxyzToSxy(object.tile.rx, object.tile.ry, elevation);
                this.invalidate(coords, elevation, object.sight);
            }
        }
    }
    revealAround(tile: Tile, radius: number): void {
        const coords = this.rxyzToSxy(tile.rx, tile.ry, tile.z);
        this.invalidate(coords, Number.POSITIVE_INFINITY, radius);
    }
    /**
     * Reveal a circular or rectangular Ares-style area. A negative width is
     * the full-map sentinel; rectangle coordinates are centered on the
     * supplied tile and use the same half-width convention as Ares.
     */
    revealArea(tile: Tile, widthOrRange: number, height: number): void {
        if (widthOrRange < 0) {
            this.revealAll();
            return;
        }
        const coords = this.rxyzToSxy(tile.rx, tile.ry, tile.z);
        if (height > 0) {
            this.invalidateRectangle(coords, Number.POSITIVE_INFINITY, widthOrRange, height);
        }
        else {
            this.invalidate(coords, Number.POSITIVE_INFINITY, widthOrRange);
        }
    }
    unrevealAround(tile: Tile, radius: number): void {
        const coords: ShroudCoords[] = [];
        const center = this.rxyzToSxy(tile.rx, tile.ry, tile.z);
        this.setValueAround(center, radius, Number.POSITIVE_INFINITY, coords, ShroudType.Unexplored, ShroudType.Explored);
        this._onChange.dispatch(this, {
            type: "incremental",
            coords
        });
    }
    revealTemporarily(object: {
        tile: Tile;
        tileElevation: number;
    }): void {
        const coords = this.rxyzToSxy(object.tile.rx, object.tile.ry, object.tile.z + object.tileElevation);
        this.temporaryReveals.set(coords, MapShroud.TEMPORARY_REVEAL_DURATION * GameSpeed.BASE_TICKS_PER_SECOND);
    }
    revealObject(object: {
        tile: Tile;
        tileElevation: number;
    }): void {
        const coords = this.rxyzToSxy(object.tile.rx, object.tile.ry, object.tile.z + object.tileElevation);
        this.invalidate(coords, Number.POSITIVE_INFINITY, MapShroud.OBJECT_REVEAL_RADIUS);
    }
    toggleFlagsAround(tile: Tile, radius: number, flags: number, set: boolean): void {
        const coords: ShroudCoords[] = [];
        const center = this.rxyzToSxy(tile.rx, tile.ry, tile.z);
        this.setValueAround(center, radius, Number.POSITIVE_INFINITY, coords, undefined, undefined, set ? { setFlags: flags } : { clearFlags: flags });
        this._onChange.dispatch(this, {
            type: "incremental",
            coords
        });
    }
    update(): void {
        const changedCoords: ShroudCoords[] = [];
        if (this.invalidations.size) {
            for (const invalidation of this.invalidations.values()) {
                if (invalidation.radius !== undefined) {
                    this.setValueAround(invalidation.center, invalidation.radius, invalidation.elevation, changedCoords, ShroudType.Explored, [ShroudType.Unexplored, ShroudType.TemporaryReveal]);
                }
                for (const rectangle of invalidation.rectangles) {
                    this.setValueInRectangle(invalidation.center, rectangle.width, rectangle.height, invalidation.elevation, changedCoords, ShroudType.Explored, [ShroudType.Unexplored, ShroudType.TemporaryReveal]);
                }
            }
            this.invalidations.clear();
        }
        if (this.temporaryReveals.size) {
            this.temporaryReveals.forEach((duration, coords) => {
                if (duration <= 0) {
                    this.setValueAround(coords, MapShroud.SHROUD_TYPE_BITS, Number.POSITIVE_INFINITY, changedCoords, ShroudType.Unexplored, ShroudType.TemporaryReveal);
                    this.temporaryReveals.delete(coords);
                }
                else {
                    if (duration === MapShroud.TEMPORARY_REVEAL_DURATION * GameSpeed.BASE_TICKS_PER_SECOND) {
                        this.setValueAround(coords, MapShroud.SHROUD_TYPE_BITS, Number.POSITIVE_INFINITY, changedCoords, ShroudType.TemporaryReveal, ShroudType.Unexplored);
                    }
                    this.temporaryReveals.set(coords, duration - 1);
                }
            });
        }
        if (this.fullInvalidation) {
            this.fullInvalidation = false;
            this._onChange.dispatch(this, { type: "full" });
        }
        else if (changedCoords.length) {
            this._onChange.dispatch(this, {
                type: "incremental",
                coords: changedCoords
            });
        }
    }
    private setValueAround(center: ShroudCoords, radius: number, maxElevation: number, changedCoords: ShroudCoords[], newValue?: ShroudType, oldValue?: ShroudType | ShroudType[], flags?: {
        setFlags?: number;
        clearFlags?: number;
    }): void {
        const radiusCeil = Math.ceil(radius);
        const minX = clamp(center.sx - radiusCeil, 0, this.size.width - 1);
        const maxX = clamp(center.sx + radiusCeil, 0, this.size.width - 1);
        const minY = clamp(center.sy - radiusCeil, 0, this.size.height - 1);
        const maxY = clamp(center.sy + radiusCeil, 0, this.size.height - 1);
        const width = this.size.width;
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                const index = x + y * width;
                const currentType = this.tiles[index] & MapShroud.SHROUD_TYPE_MASK;
                const currentFlags = (this.tiles[index] >> MapShroud.SHROUD_TYPE_BITS) << MapShroud.SHROUD_TYPE_BITS;
                let newFlags = currentFlags;
                if (flags?.setFlags !== undefined) {
                    newFlags |= flags.setFlags;
                }
                if (flags?.clearFlags !== undefined) {
                    newFlags &= ~flags.clearFlags;
                }
                const matchesOldValue = oldValue === undefined
                    ? true
                    : Array.isArray(oldValue)
                        ? oldValue.includes(currentType)
                        : oldValue === currentType;
                const inRadius = (x - center.sx) * (x - center.sx) + (y - center.sy) * (y - center.sy) <=
                    radius * radius + 1;
                const belowElevationLimit = this.tileElevation[index] < maxElevation + 4;
                if (!matchesOldValue || !inRadius || !belowElevationLimit) {
                    continue;
                }
                const nextType = newValue ?? currentType;
                this.tiles[index] = nextType | newFlags;
                if (currentType !== nextType || currentFlags !== newFlags) {
                    changedCoords.push({ sx: x, sy: y });
                }
            }
        }
    }
    private setValueInRectangle(center: ShroudCoords, width: number, height: number, maxElevation: number, changedCoords: ShroudCoords[], newValue?: ShroudType, oldValue?: ShroudType | ShroudType[], flags?: {
        setFlags?: number;
        clearFlags?: number;
    }): void {
        const rawMinX = center.sx - Math.trunc(width / 2);
        const rawMinY = center.sy - Math.trunc(height / 2);
        const minX = clamp(rawMinX, 0, this.size.width - 1);
        const minY = clamp(rawMinY, 0, this.size.height - 1);
        const maxX = clamp(rawMinX + width - 1, 0, this.size.width - 1);
        const maxY = clamp(rawMinY + height - 1, 0, this.size.height - 1);
        const mapWidth = this.size.width;
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                const index = x + y * mapWidth;
                const currentType = this.tiles[index] & MapShroud.SHROUD_TYPE_MASK;
                const currentFlags = (this.tiles[index] >> MapShroud.SHROUD_TYPE_BITS) << MapShroud.SHROUD_TYPE_BITS;
                let newFlags = currentFlags;
                if (flags?.setFlags !== undefined) newFlags |= flags.setFlags;
                if (flags?.clearFlags !== undefined) newFlags &= ~flags.clearFlags;
                const matchesOldValue = oldValue === undefined
                    ? true
                    : Array.isArray(oldValue)
                        ? oldValue.includes(currentType)
                        : oldValue === currentType;
                if (!matchesOldValue || this.tileElevation[index] >= maxElevation + 4) continue;
                const nextType = newValue ?? currentType;
                this.tiles[index] = nextType | newFlags;
                if (currentType !== nextType || currentFlags !== newFlags) {
                    changedCoords.push({ sx: x, sy: y });
                }
            }
        }
    }
    revealAll(): void {
        this.tiles.fill(ShroudType.Explored);
        this._onChange.dispatch(this, { type: "clear" });
    }
    reset(): void {
        this.tiles.fill(ShroudType.Unexplored);
        this._onChange.dispatch(this, { type: "cover" });
    }
}
