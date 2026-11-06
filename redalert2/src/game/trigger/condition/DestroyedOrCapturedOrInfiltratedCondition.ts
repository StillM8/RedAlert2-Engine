import { DestroyedByAnythingCondition } from "@/game/trigger/condition/DestroyedByAnythingCondition";

export class DestroyedOrCapturedOrInfiltratedCondition extends DestroyedByAnythingCondition {
    constructor(event: any, trigger: any) {
        super(event, trigger, true);
    }
}
