import { GameObject } from '@/game/gameobject/GameObject';
import { resolveHousePlayer } from '@/game/trigger/HouseReference';
import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';

export class ChangeHouseExecutor extends TriggerExecutor {
    execute(context: any, objects: any[]): void {
        const targetPlayer = resolveHousePlayer(context, this.action.params[1]);
        if (!targetPlayer) {
            return;
        }
        for (const object of objects) {
            if (object instanceof GameObject && object.isSpawned) {
                context.changeObjectOwner(object, targetPlayer);
            }
        }
    }
}
