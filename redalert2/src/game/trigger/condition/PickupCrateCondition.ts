import { EventType } from "@/game/event/EventType";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class PickupCrateCondition extends TriggerCondition {
    check(context: any, events: any[]): any[] {
        return events
            .filter((event) =>
                event.type === EventType.CratePickup && this.targets.includes(event.source))
            .map((event) => event.source);
    }
}
