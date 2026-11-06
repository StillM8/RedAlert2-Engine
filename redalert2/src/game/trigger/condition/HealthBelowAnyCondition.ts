import { EventType } from "@/game/event/EventType";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class HealthBelowAnyCondition extends TriggerCondition {
    constructor(
        event: any,
        trigger: any,
        private readonly threshold: number,
    ) {
        super(event, trigger);
    }

    check(context: any, events: any[]): any[] {
        return events
            .filter((event) => {
                if (event.type !== EventType.HealthChange) {
                    return false;
                }
                const target = event.target;
                return target.isTechno() &&
                    this.targets.includes(target) &&
                    event.currentHealth < this.threshold &&
                    event.prevHealth >= this.threshold;
            })
            .map((event) => event.target);
    }
}
