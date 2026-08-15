import { describe, expect, test } from 'bun:test';
import { AresPoweredByTrait } from '@/game/gameobject/trait/AresPoweredByTrait';
import { NotifyTick } from '@/game/gameobject/trait/interface/NotifyTick';

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
        empTrait: { isUnderEMP: () => false },
        operatorTrait: { isOffline: () => false },
        isUnit: () => true,
        isDestroyed: false,
    };
    unit.owner.buildings.add({
        rules: { name: "PowerCore" },
        warpedOutTrait: { isActive: () => false },
        empTrait: { isUnderEMP: () => false },
        poweredTrait: { isPoweredOn: () => providerOnline },
    });
    return unit;
}

describe('Ares PoweredBy trait presentation state', () => {
    test('reports offline and disables movement/attack when no provider is online', () => {
        const unit = makeUnit(false);
        const trait = new AresPoweredByTrait(unit, 0);
        trait[NotifyTick.onTick](unit);
        expect(trait.isPowered()).toBe(false);
        expect(trait.isOffline()).toBe(true);
        expect(unit.moveTrait.disabled).toBe(true);
        expect(unit.attackTrait.disabled).toBe(true);
    });

    test('reports powered and enables movement/attack when the provider is online', () => {
        const unit = makeUnit(true);
        const trait = new AresPoweredByTrait(unit, 0);
        trait[NotifyTick.onTick](unit);
        expect(trait.isPowered()).toBe(true);
        expect(trait.isOffline()).toBe(false);
        expect(unit.moveTrait.disabled).toBe(false);
        expect(unit.attackTrait.disabled).toBe(false);
    });

    test('transitions offline->online and restores movement/attack', () => {
        const unit = makeUnit(false);
        const trait = new AresPoweredByTrait(unit, 0);
        trait[NotifyTick.onTick](unit);
        expect(trait.isOffline()).toBe(true);

        unit.owner.buildings.values().next().value.poweredTrait.isPoweredOn = () => true;
        trait[NotifyTick.onTick](unit);
        expect(trait.isOffline()).toBe(false);
        expect(trait.isPowered()).toBe(true);
        expect(unit.moveTrait.disabled).toBe(false);
        expect(unit.attackTrait.disabled).toBe(false);
    });
});
