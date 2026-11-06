import { TerrainType } from '@/engine/type/TerrainType';
import { LandType } from '@/game/type/LandType';
import { CollisionType } from '@/game/gameobject/unit/CollisionType';
import { ZoneType } from '@/game/gameobject/unit/ZoneType';
import { Coords } from '@/game/Coords';
import { getFoundationCells } from '@/game/art/Foundation';
import { isLaserFenceActive, isLaserFenceArt } from '@/extensions/ares/AresLaserFences';
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
interface WorldPoint {
    x: number;
    y: number;
    z: number;
}
interface SolidBuildingCollisionCandidate {
    target: any;
    fraction: number;
    pathIndex: number;
    cellX: number;
    cellY: number;
}
function segmentBoxEntry(
    start: WorldPoint,
    end: WorldPoint,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
): number | undefined {
    const origins = [start.x, start.y, start.z];
    const directions = [end.x - start.x, end.y - start.y, end.z - start.z];
    const minimums = [minX, minY, minZ];
    const maximums = [maxX, maxY, maxZ];
    let entry = 0;
    let exit = 1;
    for (let axis = 0; axis < 3; axis++) {
        const origin = origins[axis];
        const direction = directions[axis];
        if (Math.abs(direction) < Number.EPSILON) {
            if (origin < minimums[axis] || origin > maximums[axis]) return undefined;
            continue;
        }
        let first = (minimums[axis] - origin) / direction;
        let second = (maximums[axis] - origin) / direction;
        if (first > second) [first, second] = [second, first];
        entry = Math.max(entry, first);
        exit = Math.min(exit, second);
        if (entry > exit) return undefined;
    }
    return entry;
}
function compareSolidBuildingCandidates(
    candidate: SolidBuildingCollisionCandidate,
    current: SolidBuildingCollisionCandidate,
): boolean {
    if (candidate.fraction !== current.fraction) return candidate.fraction < current.fraction;
    if (candidate.pathIndex !== current.pathIndex) return candidate.pathIndex < current.pathIndex;
    const candidateId = Number(candidate.target.id);
    const currentId = Number(current.target.id);
    const candidateHasId = Number.isFinite(candidateId);
    const currentHasId = Number.isFinite(currentId);
    if (candidateHasId !== currentHasId) return candidateHasId;
    if (candidateHasId && candidateId !== currentId) return candidateId < currentId;
    const candidateName = String(candidate.target.name ?? '').toLocaleLowerCase('en-US');
    const currentName = String(current.target.name ?? '').toLocaleLowerCase('en-US');
    if (candidateName !== currentName) return candidateName.localeCompare(currentName, 'en-US') < 0;
    if (candidate.cellX !== current.cellX) return candidate.cellX < current.cellX;
    return candidate.cellY < current.cellY;
}
export class CollisionHelper {
    private tileOccupation: TileOccupation;
    constructor(tileOccupation: TileOccupation) {
        this.tileOccupation = tileOccupation;
    }
    checkCollisions(source: any, target: any, options: CollisionOptions): CollisionResult {
        const sourceTile = source.tile;
        let bridge: any, unit: any, wall: any, firestormWall: any, laserFence: any;
        for (const obj of this.tileOccupation.getObjectsOnTile(sourceTile)) {
            if (obj.isOverlay() && obj.isBridge())
                bridge = obj;
            if (obj.isOverlay() && obj.wallTrait)
                wall = obj;
            if (isLaserFenceArt(obj) && isLaserFenceActive(obj))
                laserFence = obj;
            if (obj.isTechno() && !obj.isDestroyed && !isLaserFenceArt(obj))
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
        for (const tile of this.getPathTiles(sourceTile, target?.tile)) {
            const pathFence = this.tileOccupation.getObjectsOnTile(tile)
                .find(obj => isLaserFenceArt(obj) && isLaserFenceActive(obj));
            if (pathFence) {
                laserFence = pathFence;
                break;
            }
        }
        // Firestorm is an independent projectile-interception layer. It is
        // checked even when the projectile is not subject to ordinary walls.
        if (firestormWall) {
            return { type: CollisionType.Wall, target: firestormWall };
        }
        if (source.tileElevation <= 2 && laserFence) {
            return { type: CollisionType.Wall, target: laserFence };
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
    checkSolidBuildingCollisions(source: any, target: any): CollisionResult {
        const start = target?.worldPosition as WorldPoint | undefined;
        const end = source?.worldPosition as WorldPoint | undefined;
        if (!start || !end ||
            ![start.x, start.y, start.z, end.x, end.y, end.z].every(Number.isFinite)) {
            return { type: CollisionType.None };
        }
        let first: SolidBuildingCollisionCandidate | undefined;
        const foundations = new Map<any, Set<string>>();
        const pathTiles = this.getSolidBuildingPathTiles(start, end, target?.tile, source?.tile);
        pathTiles.forEach((tile, pathIndex) => {
            for (const building of this.tileOccupation.getObjectsOnTile(tile)) {
                if (!building?.isBuilding?.() || building.isDestroyed || building.isDisposed) continue;
                if (isLaserFenceArt(building) && !isLaserFenceActive(building)) continue;
                const solidHeight = Number(building.art?.solidHeight);
                const basePosition = building.position?.worldPosition as WorldPoint | undefined;
                const anchor = building.tile;
                if (!Number.isFinite(solidHeight) || solidHeight <= 0 ||
                    !basePosition || !Number.isFinite(basePosition.y) ||
                    !anchor || !Number.isInteger(anchor.rx) || !Number.isInteger(anchor.ry)) {
                    continue;
                }
                const foundation = building.getFoundation?.();
                if (!foundation) continue;
                const cellX = tile.rx - anchor.rx;
                const cellY = tile.ry - anchor.ry;
                let occupied = foundations.get(building);
                if (!occupied) {
                    occupied = new Set(getFoundationCells(foundation).map(cell =>
                        `${cell.x},${cell.y}`));
                    foundations.set(building, occupied);
                }
                if (!occupied.has(`${cellX},${cellY}`)) continue;
                const fraction = segmentBoxEntry(
                    start,
                    end,
                    (anchor.rx + cellX) * Coords.LEPTONS_PER_TILE,
                    basePosition.y,
                    (anchor.ry + cellY) * Coords.LEPTONS_PER_TILE,
                    (anchor.rx + cellX + 1) * Coords.LEPTONS_PER_TILE,
                    basePosition.y + Coords.tileHeightToWorld(solidHeight),
                    (anchor.ry + cellY + 1) * Coords.LEPTONS_PER_TILE,
                );
                if (fraction === undefined) continue;
                const candidate = { target: building, fraction, pathIndex, cellX, cellY };
                if (!first || compareSolidBuildingCandidates(candidate, first)) first = candidate;
            }
        });
        return first
            ? { type: CollisionType.Wall, target: first.target }
            : { type: CollisionType.None };
    }
    private getSolidBuildingPathTiles(
        start: WorldPoint,
        end: WorldPoint,
        oldTile: any,
        newTile: any,
    ): any[] {
        const getTile = this.tileOccupation.getTileByMapCoords?.bind(this.tileOccupation);
        if (!getTile) return this.getPathTiles(oldTile, newTile);
        let rx = Math.floor(start.x / Coords.LEPTONS_PER_TILE);
        let ry = Math.floor(start.z / Coords.LEPTONS_PER_TILE);
        const endRx = Math.floor(end.x / Coords.LEPTONS_PER_TILE);
        const endRy = Math.floor(end.z / Coords.LEPTONS_PER_TILE);
        const deltaX = end.x - start.x;
        const deltaZ = end.z - start.z;
        const stepX = deltaX > 0 ? 1 : deltaX < 0 ? -1 : 0;
        const stepZ = deltaZ > 0 ? 1 : deltaZ < 0 ? -1 : 0;
        const deltaTimeX = stepX ? Math.abs(Coords.LEPTONS_PER_TILE / deltaX) : Number.POSITIVE_INFINITY;
        const deltaTimeZ = stepZ ? Math.abs(Coords.LEPTONS_PER_TILE / deltaZ) : Number.POSITIVE_INFINITY;
        let timeX = stepX
            ? ((stepX > 0 ? (rx + 1) * Coords.LEPTONS_PER_TILE : rx * Coords.LEPTONS_PER_TILE) - start.x) / deltaX
            : Number.POSITIVE_INFINITY;
        let timeZ = stepZ
            ? ((stepZ > 0 ? (ry + 1) * Coords.LEPTONS_PER_TILE : ry * Coords.LEPTONS_PER_TILE) - start.z) / deltaZ
            : Number.POSITIVE_INFINITY;
        const result: any[] = [];
        const seen = new Set<string>();
        const addTile = (x: number, y: number) => {
            const key = `${x},${y}`;
            if (seen.has(key)) return;
            seen.add(key);
            const tile = getTile(x, y);
            if (tile) result.push(tile);
        };
        const maxSteps = Math.ceil(
            (Math.abs(deltaX) + Math.abs(deltaZ)) / Coords.LEPTONS_PER_TILE,
        ) + 8;
        for (let step = 0; step <= maxSteps; step++) {
            addTile(rx, ry);
            if (rx === endRx && ry === endRy) break;
            if (timeX > 1 && timeZ > 1) {
                rx = endRx;
                ry = endRy;
                continue;
            }
            if (timeX < timeZ) {
                rx += stepX;
                timeX += deltaTimeX;
            }
            else if (timeZ < timeX) {
                ry += stepZ;
                timeZ += deltaTimeZ;
            }
            else {
                const nextRx = rx + stepX;
                const nextRy = ry + stepZ;
                addTile(nextRx, ry);
                addTile(rx, nextRy);
                rx = nextRx;
                ry = nextRy;
                timeX += deltaTimeX;
                timeZ += deltaTimeZ;
            }
        }
        return result.length ? result : this.getPathTiles(oldTile, newTile);
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
