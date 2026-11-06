import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class CreditsBelowCondition extends TriggerCondition {
    private readonly threshold: number;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.threshold = Number(event.params[1]);
    }

    check(context: any, events: any[]): boolean {
        return !!this.player && this.player.credits < this.threshold;
    }
}
