import { describe, expect, test } from "bun:test";
import { AresPoweredByTrait } from "@/game/gameobject/trait/AresPoweredByTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";

function makeUnit(providerOnline: boolean) {
    const unit: any = {
        rules: {
            ares: {
                poweredBy: { providers: ["PowerCore"], relation: "any" },
            },
        },
        owner: { buildings: new Set<any>() },
        moveTrait: { disabled: false, setDisabled(value: boolean) { this.disabled = value; } },
        attackTrait: { disabled: false, setDisabled(value: boolean) { this.disabled = value; } },
        unitOrderTrait: { getTasks: () => [] },
        isUnit: () => true,
    };
    unit.owner.buildings.add({
        rules: { name: "PowerCore" },
        warpedOutTrait: { isActive: () => false },
        empTrait: { isUnderEMP: () => false },
        poweredTrait: { isPoweredOn: () => providerOnline },
    });
    return unit;
}

describe("Ares PoweredBy trait", () => {
    test("disables and restores a unit as a matching provider changes power state", () => {
        const unit = makeUnit(false);
        const trait = new AresPoweredByTrait(unit, 0);

        trait[NotifyTick.onTick](unit);
        expect(trait.isOffline()).toBe(true);
        expect(trait.isPowered()).toBe(false);
        expect(unit.moveTrait.disabled).toBe(true);
        expect(unit.attackTrait.disabled).toBe(true);

        unit.owner.buildings.values().next().value.poweredTrait.isPoweredOn = () => true;
        trait[NotifyTick.onTick](unit);
        expect(trait.isOffline()).toBe(false);
        expect(trait.isPowered()).toBe(true);
        expect(unit.moveTrait.disabled).toBe(false);
        expect(unit.attackTrait.disabled).toBe(false);
    });

    test("does not power down a unit held inside a building", () => {
        const unit = makeUnit(false);
        const building: any = { garrisonTrait: { units: [unit] } };
        unit.owner.buildings.add(building);
        const trait = new AresPoweredByTrait(unit, 0);

        trait[NotifyTick.onTick](unit);
        expect(trait.isOffline()).toBe(false);
        expect(unit.moveTrait.disabled).toBe(false);
    });
});
