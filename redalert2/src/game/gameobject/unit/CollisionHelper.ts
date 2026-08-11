import { TerrainType } from '@/engine/type/TerrainType';
import { LandType } from '@/game/type/LandType';
import { CollisionType } from '@/game/gameobject/unit/CollisionType';
import { ZoneType } from '@/game/gameobject/unit/ZoneType';
interface TileOccupation {
    getObjectsOnTile(tile: any): any[];
    getBridgeOnTile(tile: any): any;
    getTileByMapCoords?(rx: number, ry: number): any;
}
interface CollisionOptions {
    walls?: boolean;
    firestorm?: (object: any) => boolean;
    units?: (owner: any) => boolean;
    shore?: boolean;
    ground?: boolean;
    cliffs?: boolean;
}
interface CollisionResult {
    type: CollisionType;
    target?: any;
}
export class CollisionHelper {
    private tileOccupation: TileOccupation;
    constructor(tileOccupation: TileOccupation) {
        this.tileOccupation = tileOccupation;
    }
    checkCollisions(source: any, target: any, options: CollisionOptions): CollisionResult {
        const sourceTile = source.tile;
        let bridge: any, unit: any, wall: any, firestormWall: any;
        for (const obj of this.tileOccupation.getObjectsOnTile(sourceTile)) {
            if (obj.isOverlay() && obj.isBridge())
                bridge = obj;
            if (obj.isOverlay() && obj.wallTrait)
                wall = obj;
            if (obj.isTechno() && !obj.isDestroyed)
                unit = obj;
        }
        if (options.firestorm) {
            for (const tile of this.getPathTiles(target?.tile, sourceTile)) {
                const pathWall = this.tileOccupation.getObjectsOnTile(tile)
                    .find(obj => options.firestorm!(obj));
                if (pathWall) {
                    firestormWall = pathWall;
                    break;
                }
            }
        }
        // Firestorm is an independent projectile-interception layer. It is
        // checked even when the projectile is not subject to ordinary walls.
        if (firestormWall) {
            return { type: CollisionType.Wall, target: firestormWall };
        }
        if (options.walls) {
            if (source.tileElevation <= 2 && sourceTile.landType === LandType.Wall) {
                return { type: CollisionType.Wall, target: wall };
            }
            if (options.units &&
                unit?.tile === sourceTile &&
                (!unit.isUnit() || unit.zone === ZoneType.Ground) &&
                source.tileElevation <= 1.1 &&
                options.units(unit.owner)) {
                return { type: CollisionType.Wall, target: unit };
            }
        }
        if (options.shore && sourceTile.landType !== LandType.Water) {
            return { type: CollisionType.Shore };
        }
        if (options.ground && source.tileElevation < 0) {
            return { type: CollisionType.Ground };
        }
        const sourceHeight = source.tileElevation + sourceTile.z;
        const targetHeight = target.tileElevation + target.tile.z;
        if (bridge?.isHighBridge()) {
            const bridgeHeight = bridge.tile.z + bridge.tileElevation;
            if ((bridgeHeight < targetHeight && sourceHeight <= bridgeHeight) ||
                (targetHeight < bridgeHeight && bridgeHeight - 1 <= sourceHeight)) {
                return targetHeight < bridgeHeight
                    ? { type: CollisionType.UnderBridge, target: bridge }
                    : { type: CollisionType.OnBridge, target: bridge };
            }
        }
        else if (bridge?.isLowBridge() && options.shore) {
            return { type: CollisionType.UnderBridge, target: bridge };
        }
        if (options.cliffs) {
            const heightDiff = sourceTile.z - target.tile.z;
            if (source.tileElevation < 0 && heightDiff >= 4) {
                return { type: CollisionType.Cliff };
            }
        }
        return { type: CollisionType.None };
    }
    private getPathTiles(start: any, end: any): any[] {
        if (!start || !end ||
            start.rx === undefined || start.ry === undefined ||
            end.rx === undefined || end.ry === undefined ||
            !this.tileOccupation.getTileByMapCoords) {
            return [end ?? start];
        }
        const dx = end.rx - start.rx;
        const dy = end.ry - start.ry;
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        const result: any[] = [];
        const seen = new Set<string>();
        for (let step = 0; step <= steps; step++) {
            const rx = Math.round(start.rx + dx * (step / Math.max(1, steps)));
            const ry = Math.round(start.ry + dy * (step / Math.max(1, steps)));
            const key = `${rx},${ry}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const tile = this.tileOccupation.getTileByMapCoords(rx, ry);
            if (tile) result.push(tile);
        }
        return result.length ? result : [end];
    }
    computeDetonationZone(tile: any, height: number, collisionType: CollisionType): ZoneType {
        const bridge = this.tileOccupation.getBridgeOnTile(tile);
        if (collisionType === CollisionType.None && height > 1.5 + (bridge?.tileElevation ?? 0)) {
            return ZoneType.Air;
        }
        if ((bridge && height > 1.5) ||
            tile.terrainType !== TerrainType.Water ||
            bridge?.isLowBridge()) {
            return ZoneType.Ground;
        }
        return ZoneType.Water;
    }
}
