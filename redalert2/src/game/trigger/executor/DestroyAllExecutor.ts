import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class DestroyAllExecutor extends TriggerExecutor {
    execute(context: any): void {
        const player = resolveHousePlayer(context, this.action.params[1]);
        if (!player) {
            return;
        }
        for (const object of [...(player.getOwnedObjects?.(true) ?? [])]) {
            if (!object.isDestroyed && !object.isDisposed) {
                context.destroyObject(object, player, true);
            }
        }
    }
}
