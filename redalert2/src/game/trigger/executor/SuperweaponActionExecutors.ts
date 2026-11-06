import { SuperWeaponStatus } from "@/game/SuperWeapon";
import { resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class SuperweaponSetRechargeTimeExecutor extends TriggerExecutor {
    execute(context: any): void {
        const player = resolveTriggerHousePlayer(context, this.trigger);
        const weapon = player?.superWeaponsTrait?.get?.(String(this.action.params[1]));
        if (!weapon) {
            return;
        }
        const rechargeTicks = Math.max(0, Math.floor(Number(this.action.params[6])));
        weapon.rechargeTicks = rechargeTicks;
        weapon.chargeTicks = Math.min(weapon.chargeTicks, rechargeTicks);
        if (weapon.chargeTicks === 0) {
            weapon.status = SuperWeaponStatus.Ready;
        }
    }
}

export class SuperweaponResetExecutor extends TriggerExecutor {
    execute(context: any): void {
        const player = resolveTriggerHousePlayer(context, this.trigger);
        const weapon = player?.superWeaponsTrait?.get?.(String(this.action.params[1]));
        if (!weapon) {
            return;
        }
        weapon.chargeTicks = 0;
        weapon.status = SuperWeaponStatus.Ready;
        weapon.shotsFired = 0;
    }
}
