import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class FlashCameoExecutor extends TriggerExecutor {
    execute(context: any): void {
        const request = {
            objectType: this.action.params[1],
            frames: this.action.params[6],
        };
        context.cameoFlash = request;
        context.flashCameo?.(request);
    }
}
