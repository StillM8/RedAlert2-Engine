import { SpeedType } from '@/game/type/SpeedType';
import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';

const REVEAL_RADIUS = 2;

export class RevealWaypointZoneExecutor extends TriggerExecutor {
    execute(context: any): void {
        const waypointId = Number(this.action.params?.[1]);
        if (!Number.isSafeInteger(waypointId) || waypointId < 0) {
            return;
        }

        const map = context.map;
        const waypoint = map?.getTileAtWaypoint?.(waypointId);
        if (!waypoint || !this.isPlayable(map, waypoint)) {
            console.warn(`No valid location found for waypoint ${waypointId}. ` +
                `Skipping action ${this.getDebugName()}.`);
            return;
        }

        const humanPlayers = this.getHumanPlayers(context);
        if (!humanPlayers.length) {
            return;
        }

        const terrain = map?.terrain;
        if (typeof terrain?.areInSameMovementZone !== 'function') {
            return;
        }

        const waypointOnBridge = this.isOnBridge(map, waypoint);
        const matchingCells = this.getPlayableCells(map).filter((cell: any) =>
            terrain.areInSameMovementZone(
                waypoint,
                cell,
                SpeedType.Track,
                waypointOnBridge,
                this.isOnBridge(map, cell),
            ),
        );

        for (const player of humanPlayers) {
            const shroud = context.mapShroudTrait?.getPlayerShroud?.(player);
            if (!shroud) {
                continue;
            }
            for (const cell of matchingCells) {
                shroud.revealAround(cell, REVEAL_RADIUS, cell.z);
            }
        }
    }

    private getHumanPlayers(context: any): any[] {
        const players = typeof context.getCombatants === 'function'
            ? context.getCombatants()
            : context.getAllPlayers?.();
        if (!Array.isArray(players)) {
            return [];
        }
        return players.filter((player: any) => {
            if (!player || player.isAi === true || player.isObserver === true ||
                player.isNeutral === true || player.isHuman === false ||
                player.isVisionary === true || player.defeated === true) {
                return false;
            }
            if (player.isCombatant === false) {
                return false;
            }
            if (typeof player.isCombatant === 'function') {
                return player.isCombatant();
            }
            return true;
        });
    }

    private getPlayableCells(map: any): any[] {
        const tiles = map?.tiles?.getAll?.();
        if (!Array.isArray(tiles)) {
            return [];
        }
        return tiles.filter((tile: any) => this.isPlayable(map, tile));
    }

    private isPlayable(map: any, tile: any): boolean {
        if (typeof map?.isWithinBounds === 'function') {
            return !!map.isWithinBounds(tile);
        }
        if (typeof map?.mapBounds?.isWithinBounds === 'function') {
            return !!map.mapBounds.isWithinBounds(tile);
        }
        return false;
    }

    private isOnBridge(map: any, tile: any): boolean {
        if (tile?.onBridge === true || tile?.onBridgeLandType !== undefined) {
            return true;
        }
        return !!map?.tileOccupation?.getBridgeOnTile?.(tile);
    }
}
