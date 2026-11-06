import { SuperWeaponsTrait } from '@/game/trait/SuperWeaponsTrait';
import { SuperWeaponType } from '@/game/type/SuperWeaponType';
import { resolveTriggerHousePlayer } from '@/game/trigger/HouseReference';
import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';
export class IronCurtainExecutor extends TriggerExecutor {
    execute(game: Game): void {
        const waypoint = this.action.params[6];
        const tile = game.map.getTileAtWaypoint(waypoint);
        if (!tile) {
            console.warn(`No valid location found for waypoint ${waypoint}. ` +
                `Skipping action ${this.getDebugName()}.`);
            return;
        }
        const player = resolveTriggerHousePlayer(game, this.trigger);
        if (!player) {
            return;
        }
        const ironCurtainRule = [...game.rules.superWeaponRules.values()].find((rule) => rule.type === SuperWeaponType.IronCurtain);
        if (ironCurtainRule) {
            game.traits
                .get(SuperWeaponsTrait)
                .activateEffect(ironCurtainRule, player, game, tile, undefined, true);
        }
    }
}
