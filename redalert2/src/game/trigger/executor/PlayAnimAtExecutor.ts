import { TriggerAnimEvent } from '@/game/event/TriggerAnimEvent';
import { resolveTriggerHousePlayer } from '@/game/trigger/HouseReference';
import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';
export class PlayAnimAtExecutor extends TriggerExecutor {
    execute(context: any) {
        const action = this.action;
        const animIndex = Number(action.params[1]);
        const animName = context.rules.getAnimationName(animIndex);
        if (animName !== undefined) {
            const waypoint = action.params[6];
            const tile = context.map.getTileAtWaypoint(waypoint);
            if (tile) {
                const triggerOwner = resolveTriggerHousePlayer(context, this.trigger);
                const event = new TriggerAnimEvent(
                    animName,
                    tile,
                    undefined,
                    triggerOwner,
                    undefined,
                );
                event.triggerOwner = triggerOwner;
                context.events.dispatch(event);
            }
            else {
                console.warn(`No valid location found for waypoint ${waypoint}. ` +
                    `Skipping action ${this.getDebugName()}.`);
            }
        }
        else {
            console.warn(`No animation found for index "${animIndex}". Skipping action ` +
                this.getDebugName());
        }
    }
}
