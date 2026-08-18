import { ObjectSellEvent } from '../event/ObjectSellEvent';
import { NotifySell } from '../gameobject/trait/interface/NotifySell';
export class SellTrait {
    private game: any;
    private generalRules: any;
    constructor(game: any, generalRules: any) {
        this.game = game;
        this.generalRules = generalRules;
    }
    sell(target: any): void {
        // Ares Bunker.Raidable buildings are only temporarily controlled by
        // their squatters and explicitly cannot be sold until they revert to
        // the true owner.
        if (target.isBuilding?.() && target.garrisonTrait?.isTemporarilyOccupied?.()) {
            return;
        }
        if (!target.isBuilding() || !target.rules.unsellable) {
            let refundValue = this.computeRefundValue(target);
            if (refundValue) {
                if (target.rules.wall) {
                    refundValue = 0;
                }
                target.traits
                    .filter(NotifySell)
                    .forEach((trait: any) => {
                    trait[NotifySell.onSell](target, this.game);
                });
                if (target.isBuilding()) {
                    this.game
                        .getConstructionWorker(target.owner)
                        .unplace(target, () => this.afterObjectUnspawned(target, refundValue));
                }
                else {
                    this.game.unspawnObject(target);
                    this.afterObjectUnspawned(target, refundValue);
                }
            }
        }
    }
    private afterObjectUnspawned(target: any, refundValue: number): void {
        target.owner.credits += refundValue;
        this.game.events.dispatch(new ObjectSellEvent(target));
        target.dispose();
    }
    computeRefundValue(target: any): number {
        let refundValue = 0;
        if (target.rules.soylent > 0) {
            refundValue = target.rules.soylent;
        }
        else if (target.rules.cost) {
            refundValue = target.purchaseValue;
            if (!target.owner.isAi) {
                refundValue = Math.floor(refundValue * this.generalRules.refundPercent);
            }
        }
        return refundValue;
    }
    computePurchaseValue(target: any, cost: any): number {
        return target.cost;
    }
    dispose(): void {
        this.game = undefined;
    }
}
