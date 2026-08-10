import { MoveTask } from "@/game/gameobject/task/move/MoveTask";
import { getNearestFoundationCell } from "@/game/art/Foundation";
export class MoveInsideTask extends MoveTask {
    private target: any;
    static chooseTargetFoundationTile(target: any, game: any) {
        if (target.isBuilding()) {
            const foundation = target.getFoundation();
            const cell = getNearestFoundationCell(foundation, {
                x: Math.floor(foundation.width / 2),
                y: Math.floor(foundation.height / 2),
            });
            let tile = game.map.tiles.getByMapCoords(target.tile.rx + cell.x, target.tile.ry + cell.y) ?? target.centerTile;
            if (!game.map.mapBounds.isWithinBounds(tile)) {
                tile = game.map.tileOccupation
                    .calculateTilesForGameObject(target.tile, target)
                    .find((tile) => game.map.mapBounds.isWithinBounds(tile)) ?? target.tile;
            }
            return tile;
        }
        return target.tile;
    }
    constructor(game: any, target: any) {
        super(game, MoveInsideTask.chooseTargetFoundationTile(target, game), false, {
            ignoredBlockers: [target],
            closeEnoughTiles: 0,
        });
        this.target = target;
    }
    hasReachedDestination(unit: any): boolean {
        return (super.hasReachedDestination(unit) ||
            this.canStopAtTile(unit, unit.tile, unit.onBridge));
    }
    canStopAtTile(unit: any, tile: any, onBridge: any): boolean {
        const isOccupied = this.game.map.tileOccupation.isTileOccupiedBy(tile, this.target);
        return (!this.isCancelling() || !isOccupied) && !(!this.isCancelling() && !isOccupied);
    }
    isCloseEnoughToDest(unit: any, tile: any, onBridge: any): boolean {
        return this.game.map.tileOccupation.isTileOccupiedBy(tile, this.target);
    }
}
