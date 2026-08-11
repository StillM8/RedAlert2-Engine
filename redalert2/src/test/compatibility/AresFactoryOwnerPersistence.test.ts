import { describe, expect, test } from 'bun:test';
import { ARES_PRODUCTION_STATE_VERSION } from '@/extensions/ares/AresProductionState';
import { Production } from '@/game/player/production/Production';

function makeProduction(): any {
    const production = Object.create(Production.prototype) as any;
    production.stolenTech = new Set();
    production.permanentFactoryOwnerPlans = new Set();
    production.reverseEngineeredPlans = new Set();
    production.player = { buildings: new Set() };
    return production;
}

describe('Ares FactoryOwners.Permanent persistence', () => {
    test('serializes production extension state deterministically and case-insensitively', () => {
        const production = makeProduction();
        production.addStolenTech('Gamma');
        production.addStolenTech('gamma');
        production.addStolenTech(2);
        production.addPermanentFactoryOwnerPlans(' BetaCountry ');
        production.addPermanentFactoryOwnerPlans('AlphaCountry');
        production.addPermanentFactoryOwnerPlans('alphacountry');

        expect(production.serializeState()).toEqual({
            version: ARES_PRODUCTION_STATE_VERSION,
            stolenTechs: [2, 'Gamma'],
            permanentFactoryOwnerPlans: ['AlphaCountry', 'BetaCountry'],
            reverseEngineeredPlans: [],
        });
    });

    test('restores permanent plans after the source factory is gone', () => {
        const source = makeProduction();
        source.addPermanentFactoryOwnerPlans('AlphaCountry');
        source.addStolenTech(2);
        const serialized = source.serializeState();

        const restored = makeProduction();
        restored.restoreState(serialized);

        expect(restored.serializeState()).toEqual(serialized);
        expect(restored.getHash()).toBe(source.getHash());
        expect(restored.debugGetState()).toEqual({
            stolenTechs: [2],
            permanentFactoryOwnerPlans: ['AlphaCountry'],
            reverseEngineeredPlans: [],
        });
    });

    test('replaces old state rather than merging stale captured plans', () => {
        const production = makeProduction();
        production.addPermanentFactoryOwnerPlans('OldCountry');
        production.addStolenTech(1);

        production.restoreState({
            version: ARES_PRODUCTION_STATE_VERSION,
            stolenTechs: ['NewSide'],
            permanentFactoryOwnerPlans: ['NewCountry'],
            reverseEngineeredPlans: [],
        });

        expect(production.serializeState()).toEqual({
            version: ARES_PRODUCTION_STATE_VERSION,
            stolenTechs: ['NewSide'],
            permanentFactoryOwnerPlans: ['NewCountry'],
            reverseEngineeredPlans: [],
        });
    });

    test('rejects unsupported versions and malformed collections', () => {
        const production = makeProduction();

        expect(() => production.restoreState({
            version: ARES_PRODUCTION_STATE_VERSION + 1,
            stolenTechs: [],
            permanentFactoryOwnerPlans: [],
            reverseEngineeredPlans: [],
        })).toThrow('Unsupported Ares production state version');

        expect(() => production.restoreState({
            version: ARES_PRODUCTION_STATE_VERSION,
            stolenTechs: 'not-an-array',
            permanentFactoryOwnerPlans: [],
            reverseEngineeredPlans: [],
        })).toThrow('collections must be arrays');

        expect(() => production.restoreState({
            version: ARES_PRODUCTION_STATE_VERSION,
            stolenTechs: [1.5],
            permanentFactoryOwnerPlans: [],
            reverseEngineeredPlans: [],
        })).toThrow('Invalid Ares stolen-tech index');
    });
});
