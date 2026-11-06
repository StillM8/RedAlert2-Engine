import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class LowPowerCondition extends TriggerCondition {
    private targetPlayer?: any;

    constructor(event: any, trigger: any) {
        super(event, trigger);
    }

    init(game: any): void {
        super.init(game);
        this.targetPlayer = resolveHousePlayer(game, this.event.params[1]);
    }

    check(context: any, events: any[]): boolean {
        return !!this.targetPlayer?.powerTrait?.isLowPower?.();
    }
}
