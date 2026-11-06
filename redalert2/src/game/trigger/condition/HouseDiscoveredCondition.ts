import { EventType } from "@/game/event/EventType";
import { resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class HouseDiscoveredCondition extends TriggerCondition {
    check(context: any, events: any[]): boolean {
        const player = this.player ?? resolveTriggerHousePlayer(context, this.trigger);
        const houseReference = this.event.params[1];
        return !!player && events.some((event: any) => {
            const house = event.house ?? event.target;
            return event.type === EventType.HouseDiscovered &&
                event.player === player &&
                !!house &&
                this.matchesHouse(context, house, houseReference);
        });
    }
}
