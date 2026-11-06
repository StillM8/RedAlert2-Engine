import {
    applyCustomAresSpyInfiltration,
    applyRetailAresSpyInfiltration,
    resolveAresSpyEffectRules,
} from "@/extensions/ares/AresSpyBehavior";

export class AgentTrait {
    infiltrate(agent: any, target: any, game: any): void {
        if (agent.owner === target.owner ||
            game.areFriendly?.(agent, target) ||
            game.alliances?.areAllied?.(agent.owner, target.owner)) return;
        const effect = resolveAresSpyEffectRules(target.rules);
        if (effect.custom) {
            applyCustomAresSpyInfiltration(agent, target, game, effect);
        }
        else {
            applyRetailAresSpyInfiltration(agent, target, game);
        }
    }
}
