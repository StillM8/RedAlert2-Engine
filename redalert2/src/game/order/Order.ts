import { PointerType } from "@/engine/type/PointerType";
import { OrderFeedbackType } from "./OrderFeedbackType";
export abstract class Order {
    public orderType: any;
    public targetOptional: boolean = true;
    public minimapAllowed: boolean = true;
    public singleSelectionRequired: boolean = false;
    public terminal: boolean = false;
    public feedbackType: OrderFeedbackType = OrderFeedbackType.None;
    public sourceObject: any;
    public target: any;
    constructor(orderType: any) {
        this.orderType = orderType;
    }
    getPointerType(isMini: boolean, target?: any): PointerType {
        return isMini ? PointerType.Mini : PointerType.Default;
    }
    set(sourceObject: any, target: any): Order {
        this.sourceObject = sourceObject;
        this.target = target;
        return this;
    }
    /**
     * Constructor flags that `orderType` alone does not determine. For example
     * `PlaceBomb` and `Attack` both construct an `AttackOrder` and both report
     * `OrderType.Attack`, but they differ in whether an Ivan bomb may be used,
     * so the type number alone cannot round-trip. Subclasses override this with
     * their own scalar flags; the base contributes nothing.
     */
    captureState(): Record<string, unknown> {
        return {};
    }
    isValid(): boolean {
        return true;
    }
    isAllowed(): boolean {
        return true;
    }
    onAdd(tasks: any[], isQueued: boolean): boolean {
        return true;
    }
}
