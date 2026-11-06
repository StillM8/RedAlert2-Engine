import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class AnyEventCondition extends TriggerCondition {
    check(context: any, events: any[]): boolean {
        return true;
    }
}
