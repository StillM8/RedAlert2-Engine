import { describe, expect, test } from 'bun:test';
import { CloakableTrait } from '@/game/gameobject/trait/CloakableTrait';
import { NotifyTick } from '@/game/gameobject/trait/interface/NotifyTick';
import { EventType } from '@/game/event/EventType';

function makeTarget(operatorOffline: boolean) {
    const events: any[] = [];
    return {
        isVehicle: () => false,
        submergibleTrait: undefined,
        temporalTrait: { getTarget: () => undefined },
        operatorTrait: { isOffline: () => operatorOffline },
        _events: events,
        _context: { events: { dispatch: (event: any) => events.push(event) } },
    };
}

describe('Ares Operator cloak rule', () => {
    test('operated units cloak normally', () => {
        const target = makeTarget(false);
        const trait = new CloakableTrait(target, 0);
        (trait as any).cooldownTicks = 0;
        trait[NotifyTick.onTick](target, target._context);
        expect(trait.isCloaked()).toBe(true);
    });

    test('unoperated units do not cloak themselves', () => {
        const target = makeTarget(true);
        const trait = new CloakableTrait(target, 0);
        (trait as any).cooldownTicks = 0;
        trait[NotifyTick.onTick](target, target._context);
        expect(trait.isCloaked()).toBe(false);
    });

    test('uncloaks when the operator is lost', () => {
        let operatorOffline = false;
        const target: any = makeTarget(false);
        target.operatorTrait = { isOffline: () => operatorOffline };
        const trait = new CloakableTrait(target, 0);
        (trait as any).cooldownTicks = 0;
        trait[NotifyTick.onTick](target, target._context);
        expect(trait.isCloaked()).toBe(true);

        operatorOffline = true;
        trait.uncloak(target._context);
        (trait as any).cooldownTicks = 0;
        trait[NotifyTick.onTick](target, target._context);
        expect(trait.isCloaked()).toBe(false);
    });
});
