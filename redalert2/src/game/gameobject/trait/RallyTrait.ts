import { TerrainType } from '@/engine/type/TerrainType';
import { RadialTileFinder } from '@/game/map/tileFinder/RadialTileFinder';
import { FactoryType } from '@/game/rules/TechnoRules';
import { MovementZone } from '@/game/type/MovementZone';
import { SpeedType } from '@/game/type/SpeedType';
import { Tile } from '@/game/map/Tile';
import { GameMap } from '@/game/GameMap';
import { GameObject } from '@/game/gameobject/GameObject';
import { getFoundationCells } from '@/game/art/Foundation';
type RallyContext = {
    map: GameMap;
};
export class RallyTrait {
    private rallyPoint?: Tile;
    getRallyPoint(): Tile | undefined {
        return this.rallyPoint;
    }
    changeRallyPoint(targetTile: Tile, gameObject: GameObject, world: RallyContext): void {
        const validPoint = this.findValidRallyPoint(gameObject, targetTile, world.map);
        if (validPoint) {
            this.rallyPoint = validPoint;
        }
    }
    findValidRallyPoint(gameObject: GameObject, targetTile: Tile, map: GameMap): Tile | undefined {
        const finder = new RadialTileFinder(map.tiles, map.mapBounds, targetTile, { width: 1, height: 1 }, 0, 20, (tile) => (gameObject.rules.naval || tile.terrainType !== TerrainType.Water) &&
            !map.tileOccupation.isTileOccupiedBy(tile, gameObject));
        let validTile = finder.getNextTile();
        if (!validTile && gameObject.factoryTrait?.type === FactoryType.NavalUnitType) {
            for (const cell of getFoundationCells(gameObject.getFoundation())) {
                const tile = map.tiles.getByMapCoords(gameObject.tile.rx + cell.x, gameObject.tile.ry + cell.y);
                if (tile && map.terrain.getPassableSpeed(tile, SpeedType.Float, false, false) > 0) {
                    validTile = tile;
                    break;
                }
                if (validTile)
                    break;
            }
        }
        return validTile;
    }
    findRallyNodeForUnit(unit: GameObject, map: GameMap): {
        tile: Tile;
        onBridge?: any;
    } | undefined {
        if (this.rallyPoint) {
            const rallyTile = this.findRallyPointforUnit(unit, this.rallyPoint, map, true);
            return {
                tile: rallyTile,
                onBridge: unit.rules.naval ? undefined : map.tileOccupation.getBridgeOnTile(rallyTile)
            };
        }
    }
    findRallyPointforUnit(unit: GameObject, targetTile: Tile, map: GameMap, checkBuildings: boolean, targetElevation?: number): Tile {
        const bridge = unit.rules.naval ? undefined : map.tileOccupation.getBridgeOnTile(targetTile);
        const isFlying = unit.rules.movementZone === MovementZone.Fly;
        const finder = new RadialTileFinder(map.tiles, map.mapBounds, targetTile, { width: 1, height: 1 }, 0, 5, (tile) => {
            const tileBridge = !bridge || bridge.isHighBridge()
                ? map.tileOccupation.getBridgeOnTile(tile)
                : undefined;
            return (!(isFlying ? [] : map.terrain.findObstacles({ tile, onBridge: tileBridge }, unit as any)).length &&
                (targetElevation === undefined || Math.abs(targetElevation - (tile.z + (tileBridge?.tileElevation ?? 0))) < 4) &&
                (!checkBuildings || !map.getObjectsOnTile(tile).find(obj => obj.isBuilding() && !obj.isDestroyed)) &&
                (isFlying || map.terrain.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), !!tileBridge) > 0));
        });
        return finder.getNextTile() ?? targetTile;
    }
}
