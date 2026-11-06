import { EventType } from "@/game/event/EventType";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class DestroyedByAnythingCondition extends TriggerCondition {
    constructor(event: any, trigger: any, private readonly includeInfiltration: boolean = true) {
        super(event, trigger);
    }

    check(context: any, events: any[]): any[] {
        return events
            .filter((event) => {
                const target = event.target;
                if (!target ||
                    (typeof target.isTechno === "function" && !target.isTechno()) ||
                    !this.targets.includes(target)) {
                    return false;
                }
                if (event.type === EventType.ObjectDestroy ||
                    event.type === EventType.ObjectSell ||
                    event.type === EventType.ObjectOwnerChange ||
                    event.type === EventType.BuildingCapture) {
                    return true;
                }
                return this.includeInfiltration && event.type === EventType.BuildingInfiltration;
            })
            .map((event) => event.target);
    }
}
