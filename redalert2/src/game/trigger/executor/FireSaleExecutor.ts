import { resolveHousePlayer } from '@/game/trigger/HouseReference';
import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';

export class FireSaleExecutor extends TriggerExecutor {
    execute(context: any): void {
        const targetPlayer = resolveHousePlayer(context, this.action.params[1]);
        if (!targetPlayer) {
            return;
        }
        for (const building of targetPlayer.buildings) {
            context.sellTrait.sell(building);
        }
    }
}
