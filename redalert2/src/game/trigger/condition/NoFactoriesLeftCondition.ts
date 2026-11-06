import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class NoFactoriesLeftCondition extends TriggerCondition {
    check(context: any, events: any[]): boolean {
        if (!this.player) {
            return false;
        }
        return ![...this.player.buildings].some((building: any) => building.factoryTrait);
    }
}
