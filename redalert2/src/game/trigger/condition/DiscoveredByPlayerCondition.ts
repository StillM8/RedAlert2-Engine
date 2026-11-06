import { EventType } from "@/game/event/EventType";
import { resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class DiscoveredByPlayerCondition extends TriggerCondition {
    check(context: any, events: any[]): boolean {
        const player = this.player ?? resolveTriggerHousePlayer(context, this.trigger);
        return !!player && events.some((event: any) =>
            event.type === EventType.ObjectDiscovered &&
            event.target &&
            this.targets.includes(event.target) &&
            event.player === player);
    }
}
