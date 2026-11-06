import { QueueStatus } from "@/game/player/production/ProductionQueue";
import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class ProductionBeginsExecutor extends TriggerExecutor {
    execute(context: any): void {
        const player = resolveHousePlayer(context, this.action.params[1]);
        if (!player) {
            return;
        }
        player.productionEnabled = true;
        for (const queue of player.production?.getAllQueues?.() ?? []) {
            if (queue.status === QueueStatus.OnHold) {
                queue.status = QueueStatus.Active;
            }
        }
    }
}
