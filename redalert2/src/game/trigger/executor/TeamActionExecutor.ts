import { resolveTeamType } from "@/game/trigger/TeamReference";
import { resolveHousePlayer, resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class TeamActionExecutor extends TriggerExecutor {
    constructor(action: any, trigger: any, private readonly destroy: boolean) {
        super(action, trigger);
    }

    execute(context: any): void {
        const reference = String(this.action.params[1] ?? "");
        const teamType = resolveTeamType(context, reference);
        if (!teamType) {
            return;
        }
        const runtime = context.teamRuntime;
        if (!runtime) {
            return;
        }
        if (this.destroy) {
            runtime.destroy(teamType.id);
            return;
        }
        const house = String(teamType.section.getString("House") ?? "").trim();
        const owner = house && !["<none>", "none"].includes(house.toLocaleLowerCase("en-US"))
            ? resolveHousePlayer(context, house)
            : resolveTriggerHousePlayer(context, this.trigger);
        if (owner) {
            runtime.recruit(context, teamType, owner);
        }
    }
}
