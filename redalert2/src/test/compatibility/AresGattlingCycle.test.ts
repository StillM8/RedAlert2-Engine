import { describe, expect, test } from "bun:test";
import { GattlingTrait } from "@/game/gameobject/trait/GattlingTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";

function host(cycle: boolean): { object: any; selected: number[] } {
    const selected: number[] = [];
    const object: any = {
        rules: {
            weaponStages: 2,
            rateUp: 54,
            rateDown: 1,
            gattlingCycle: cycle,
        },
        veteranLevel: 0,
        attackTrait: {
            isIdle: () => false,
            isDisabled: () => false,
        },
        armedTrait: {
            selectGattlingStage: (stage: number) => selected.push(stage),
        },
        unitOrderTrait: {
            getCurrentTask: () => undefined,
        },
    };
    return { object, selected };
}

describe("Ares Gattling.Cycle", () => {
    test("wraps from the completed final stage back to the first without losing engagement", () => {
        const { object, selected } = host(true);
        const trait = new GattlingTrait();

        trait[NotifyTick.onTick](object);
        expect(trait.getStage()).toBe(1);
        expect(trait.getCounter()).toBe(54);

        trait[NotifyTick.onTick](object);
        expect(trait.getStage()).toBe(0);
        expect(trait.getCounter()).toBe(0);
        expect(selected).toEqual([1, 0]);
    });

    test("retains Yuri's Revenge top-stage clamp when cycling is disabled", () => {
        const { object, selected } = host(false);
        const trait = new GattlingTrait();

        trait[NotifyTick.onTick](object);
        trait[NotifyTick.onTick](object);

        expect(trait.getStage()).toBe(1);
        expect(trait.getCounter()).toBe(107);
        expect(selected).toEqual([1]);
    });

    test("preserves RateUp overshoot across the cycle boundary", () => {
        const { object } = host(true);
        object.rules.rateUp = 70;
        const trait = new GattlingTrait();

        trait[NotifyTick.onTick](object);
        expect(trait.getCounter()).toBe(70);
        trait[NotifyTick.onTick](object);
        expect(trait.getCounter()).toBe(32);
        expect(trait.getStage()).toBe(0);
    });
});
