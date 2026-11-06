import { EventType } from "@/game/event/EventType";
import { resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class ObjectSelectedCondition extends TriggerCondition {
    check(context: any, events: any[]): any[] {
        const player = this.player ?? resolveTriggerHousePlayer(context, this.trigger);
        if (!player) {
            return [];
        }
        return events
            .filter((event: any) =>
                event.type === EventType.ObjectSelected &&
                this.targets.includes(event.target) &&
                event.player === player)
            .map((event: any) => event.target);
    }
}
