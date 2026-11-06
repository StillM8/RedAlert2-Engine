import { ObjectType } from '@/engine/type/ObjectType';
import { CheerTask } from '@/game/gameobject/task/CheerTask';
import { resolveHousePlayer } from '@/game/trigger/HouseReference';
import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';

export class CheerExecutor extends TriggerExecutor {
    execute(context: any): void {
        const player = resolveHousePlayer(context, this.action.params[1]);
        if (!player || player.defeated) {
            return;
        }
        for (const infantry of player.getOwnedObjectsByType(ObjectType.Infantry)) {
            if (infantry.unitOrderTrait.isIdle()) {
                infantry.unitOrderTrait.addTask(new CheerTask());
            }
        }
    }
}
