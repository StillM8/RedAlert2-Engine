import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";
import { resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";

export class DropZoneFlareExecutor extends TriggerExecutor {
    execute(context: any): void {
        const tile = context.map.getTileAtWaypoint(this.action.params[6]);
        if (!tile) {
            return;
        }
        for (const combatant of context.getCombatants?.() ?? []) {
            context.mapShroudTrait
                ?.getPlayerShroud?.(combatant)
                ?.revealAround(tile, context.rules.general.revealTriggerRadius);
        }
        const animation = context.rules.audioVisual?.dropZoneAnimation ??
            context.rules.audioVisual?.dropZoneAnim;
        if (animation) {
            context.events.dispatch(new TriggerAnimEvent(
                animation,
                tile,
                undefined,
                resolveTriggerHousePlayer(context, this.trigger),
            ));
        }
    }
}
