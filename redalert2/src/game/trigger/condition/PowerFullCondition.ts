import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class PowerFullCondition extends TriggerCondition {
    check(context: any, events: any[]): boolean {
        const player = resolveHousePlayer(context, this.event.params[1]);
        const power = player?.powerTrait;
        return !!power && !power.isLowPower?.() && Number(power.power) >= Number(power.drain);
    }
}
