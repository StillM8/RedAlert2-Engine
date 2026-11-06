import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class AiTriggersExecutor extends TriggerExecutor {
    constructor(action: any, trigger: any, private readonly enabled: boolean) {
        super(action, trigger);
    }

    execute(context: any): void {
        const player = resolveHousePlayer(context, this.action.params[1]);
        if (player) {
            player.aiTriggersEnabled = this.enabled;
        }
    }
}
