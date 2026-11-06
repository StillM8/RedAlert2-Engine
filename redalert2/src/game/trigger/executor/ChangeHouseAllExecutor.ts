import { resolveHousePlayer, resolveTriggerHousePlayer } from '@/game/trigger/HouseReference';
import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';

export class ChangeHouseAllExecutor extends TriggerExecutor {
    execute(context: any): void {
        const sourcePlayer = resolveTriggerHousePlayer(context, this.trigger);
        const targetPlayer = resolveHousePlayer(context, this.action.params[1]);
        if (!sourcePlayer || !targetPlayer) {
            return;
        }
        for (const object of sourcePlayer.getOwnedObjects(true)) {
            context.changeObjectOwner(object, targetPlayer);
        }
    }
}
