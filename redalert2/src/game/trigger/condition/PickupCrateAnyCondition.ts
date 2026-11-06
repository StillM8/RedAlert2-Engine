import { EventType } from "@/game/event/EventType";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class PickupCrateAnyCondition extends TriggerCondition {
    check(context: any, events: any[]): boolean {
        return events.some((event) => event.type === EventType.CratePickup);
    }
}
