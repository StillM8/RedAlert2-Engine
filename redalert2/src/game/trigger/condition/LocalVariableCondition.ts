import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class LocalVariableCondition extends TriggerCondition {
    private readonly variableIndex: number;

    constructor(event: any, trigger: any, private readonly expected: boolean) {
        super(event, trigger);
        this.blocking = true;
        this.variableIndex = Number(event.params[1]);
    }

    check(context: any, events: any[]): boolean {
        return context.triggers.getLocalVariable(this.variableIndex) === this.expected;
    }
}
