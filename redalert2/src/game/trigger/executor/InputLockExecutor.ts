import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class InputLockExecutor extends TriggerExecutor {
    constructor(action: any, trigger: any, private readonly locked: boolean) {
        super(action, trigger);
    }

    execute(context: any): void {
        context.inputLocked = this.locked;
        if (this.locked) {
            context.lockInput?.();
        }
        else {
            context.unlockInput?.();
        }
    }
}
