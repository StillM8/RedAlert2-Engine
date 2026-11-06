import { SuperWeaponsTrait } from '@/game/trait/SuperWeaponsTrait';
import { SuperWeaponType } from '@/game/type/SuperWeaponType';
import { resolveTriggerHousePlayer } from '@/game/trigger/HouseReference';
import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';
export class NukeStrikeExecutor extends TriggerExecutor {
    execute(game: Game): void {
        const waypoint = this.action.params[6];
        const targetTile = game.map.getTileAtWaypoint(waypoint);
        if (!targetTile) {
            console.warn(`No valid location found for waypoint ${waypoint}. ` +
                `Skipping action ${this.getDebugName()}.`);
            return;
        }
        const player = resolveTriggerHousePlayer(game, this.trigger);
        if (!player) {
            return;
        }
        const superWeapon = [...game.rules.superWeaponRules.values()].find((sw) => sw.type === SuperWeaponType.MultiMissile);
        if (superWeapon) {
            game.traits
                .get(SuperWeaponsTrait)
                .activateEffect(superWeapon, player, game, targetTile, undefined, true);
        }
    }
}
