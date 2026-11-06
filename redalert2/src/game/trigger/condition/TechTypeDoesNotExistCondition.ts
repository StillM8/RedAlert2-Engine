import { TechTypeExistsCondition } from "@/game/trigger/condition/TechTypeExistsCondition";

export class TechTypeDoesNotExistCondition extends TechTypeExistsCondition {
    check(context: any, events: any[]): boolean {
        return this.count(context) === 0;
    }
}
