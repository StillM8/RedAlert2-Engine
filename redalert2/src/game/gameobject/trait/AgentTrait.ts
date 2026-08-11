import { FactoryType } from "@/game/rules/TechnoRules";
import { clamp } from "@/util/math";
import { getAvailableBuildingSuperWeapon } from "@/game/gameobject/trait/SuperWeaponTrait";
export class AgentTrait {
    infiltrate(agent: any, target: any, game: any): void {
        if (target.rules.radar &&
            ![...target.owner.buildings].some((b: any) => b.rules.spySat)) {
            game.mapShroudTrait.resetShroud(target.owner, game);
        }
        if (target.rules.power > 0) {
            const blackoutTime = game.rules.general.spyPowerBlackout;
            target.owner.powerTrait?.setBlackoutFor(blackoutTime, game);
        }
        getAvailableBuildingSuperWeapon(target)?.superWeapon.resetTimer();
        if (target.rules.storage > 0) {
            const stealPercent = clamp(game.rules.general.spyMoneyStealPercent, 0, 1);
            const stolenAmount = Math.floor(target.owner.credits * stealPercent);
            target.owner.credits -= stolenAmount;
            agent.owner.credits += stolenAmount;
        }
        if (game.rules.ai.buildTech.includes(target.name)) {
            const sideId = target.rules.aiBasePlanningSideId;
            const legacySide = target.rules.aiBasePlanningSide;
            if (sideId !== undefined) {
                agent.owner.production.addStolenTech(sideId);
            }
            if (legacySide !== undefined) {
                // Keep the numeric value for vanilla Prerequisite.StolenTechs
                // and old RequiresStolen* checks. Dynamic content uses the
                // stable ID above and never needs a SideType enum mapping.
                agent.owner.production.addStolenTech(legacySide);
            }
        }
        if (target.factoryTrait &&
            [FactoryType.InfantryType, FactoryType.UnitType].includes(target.factoryTrait.type)) {
            agent.owner.production?.addVeteranType(target.factoryTrait.type);
        }
    }
}
