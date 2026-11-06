import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class WinLoseExecutor extends TriggerExecutor {
    constructor(action: any, trigger: any, private readonly outcome: "won" | "lost") {
        super(action, trigger);
    }

    execute(context: any): void {
        const player = resolveHousePlayer(context, this.action.params[1]);
        context.triggerOutcome = {
            outcome: this.outcome,
            player: player?.name,
            playerIndex: player ? context.getPlayerNumber?.(player) : undefined,
        };
        context.end();
    }
}
