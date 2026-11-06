import { EventType } from "@/game/event/EventType";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class DestroyedUnitsCondition extends TriggerCondition {
    private count = 0;
    private readonly threshold: number;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.threshold = Number(event.params[1]);
    }

    check(context: any, events: any[]): boolean {
        if (!this.player) {
            return false;
        }
        if (this.count >= this.threshold) {
            return true;
        }
        this.count += events.filter((event) =>
            event.type === EventType.ObjectDestroy &&
            event.target.isUnit() &&
            event.target.owner === this.player).length;
        return this.count >= this.threshold;
    }
}
