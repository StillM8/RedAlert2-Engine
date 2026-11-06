import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class NoEventCondition extends TriggerCondition {
    check(context: any, events: any[]): boolean {
        return false;
    }
}
