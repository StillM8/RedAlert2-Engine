import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class AllToHuntExecutor extends TriggerExecutor {
    execute(context: any): void {
        const player = resolveHousePlayer(context, this.action.params[1]);
        for (const object of player?.getOwnedObjects?.(true) ?? []) {
            if (!object.isUnit?.()) {
                continue;
            }
            object.unitOrderTrait?.clearOrders?.();
            object.guardMode = false;
        }
    }
}
