import { Order } from "./Order";
import { OrderType } from "./OrderType";
import { OrderFeedbackType } from "./OrderFeedbackType";
import { PointerType } from "@/engine/type/PointerType";

/**
 * Ares restored remote detonation: the bomb owner can detonate a placed
 * Ivan/time bomb before its timer expires. This order is only valid when the
 * selected unit owns an active charge on the target.
 */
export class DetonateBombOrder extends Order {
    public targetOptional: boolean = false;
    public terminal: boolean = true;
    public feedbackType: OrderFeedbackType = OrderFeedbackType.SpecialAttack;
    constructor() {
        super(OrderType.DetonateBomb);
    }
    getPointerType(isMini: boolean): PointerType {
        return this.isAllowed()
            ? (isMini ? PointerType.AttackMini : PointerType.AttackRange)
            : (isMini ? PointerType.NoActionMini : PointerType.NoMove);
    }
    isValid(): boolean {
        const target = this.target.obj;
        if (!target?.tntChargeTrait?.hasCharge?.()) return false;
        const owner = target.tntChargeTrait.getChargeOwner();
        return owner !== undefined && owner === this.sourceObject.owner;
    }
    isAllowed(): boolean {
        if (!this.isValid()) return false;
        return this.target.obj.tntChargeTrait.canBeManuallyDetonated?.() !== false;
    }
    process() {
        const target = this.target.obj;
        target.tntChargeTrait.removeCharge();
        return [];
    }
}
