import { resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class SetBaseCenterCellExecutor extends TriggerExecutor {
    execute(context: any): void {
        const player = resolveTriggerHousePlayer(context, this.trigger);
        const tile = context.map.getTileAtWaypoint(this.action.params[6]);
        if (!player || !tile) {
            return;
        }
        player.baseCenterTile = tile;
        player.triggerBaseCenter = { x: tile.rx, y: tile.ry };
    }
}
