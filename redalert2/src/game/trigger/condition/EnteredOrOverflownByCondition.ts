import { EventType } from "@/game/event/EventType";
import { isAnyHouseReference } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class EnteredOrOverflownByCondition extends TriggerCondition {
    check(context: any, events: any[]): any[] {
        const houseReference = this.event.params[1];
        return events
            .filter((event) =>
                event.type === EventType.EnterTile &&
                this.targets.includes(event.target) &&
                (isAnyHouseReference(houseReference) ||
                    this.matchesHouse(context, event.source.owner, houseReference)))
            .map((event) => event.target);
    }
}
