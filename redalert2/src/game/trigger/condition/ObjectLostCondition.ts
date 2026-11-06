import { DestroyedByAnythingCondition } from "@/game/trigger/condition/DestroyedByAnythingCondition";

export class ObjectLostCondition extends DestroyedByAnythingCondition {
    constructor(event: any, trigger: any) {
        super(event, trigger, false);
    }
}
