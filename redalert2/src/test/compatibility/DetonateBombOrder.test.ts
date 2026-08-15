import { describe, expect, test } from "bun:test";
import { DetonateBombOrder } from "@/game/order/DetonateBombOrder";
import { OrderType } from "@/game/order/OrderType";

function makeOrder(target: any, sourceOwner: any) {
    const order = new DetonateBombOrder();
    (order as any).target = { obj: target };
    (order as any).sourceObject = { owner: sourceOwner };
    return order;
}

describe("DetonateBombOrder", () => {
    test("is valid when the source owns the active charge", () => {
        const owner = { id: 1 };
        const target = {
            tntChargeTrait: {
                hasCharge: () => true,
                getChargeOwner: () => owner,
                canBeManuallyDetonated: () => true,
            },
        };
        const order = makeOrder(target, owner);
        expect(order.isValid()).toBe(true);
        expect(order.isAllowed()).toBe(true);
    });

    test("is invalid when the source does not own the charge", () => {
        const owner = { id: 1 };
        const otherOwner = { id: 2 };
        const target = {
            tntChargeTrait: {
                hasCharge: () => true,
                getChargeOwner: () => owner,
                canBeManuallyDetonated: () => true,
            },
        };
        const order = makeOrder(target, otherOwner);
        expect(order.isValid()).toBe(false);
    });

    test("is invalid when there is no active charge", () => {
        const owner = { id: 1 };
        const target = {
            tntChargeTrait: {
                hasCharge: () => false,
                getChargeOwner: () => owner,
                canBeManuallyDetonated: () => true,
            },
        };
        const order = makeOrder(target, owner);
        expect(order.isValid()).toBe(false);
    });

    test("respects canBeManuallyDetonated=false", () => {
        const owner = { id: 1 };
        const target = {
            tntChargeTrait: {
                hasCharge: () => true,
                getChargeOwner: () => owner,
                canBeManuallyDetonated: () => false,
            },
        };
        const order = makeOrder(target, owner);
        expect(order.isValid()).toBe(true);
        expect(order.isAllowed()).toBe(false);
    });

    test("removes the charge when processed", () => {
        const owner = { id: 1 };
        let removed = false;
        const target = {
            tntChargeTrait: {
                hasCharge: () => true,
                getChargeOwner: () => owner,
                canBeManuallyDetonated: () => true,
                removeCharge: () => { removed = true; },
            },
        };
        const order = makeOrder(target, owner);
        order.process();
        expect(removed).toBe(true);
    });
});
