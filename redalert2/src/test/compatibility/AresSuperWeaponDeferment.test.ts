import { describe, expect, test } from 'bun:test';
import { scanMentalOmegaIniSources } from '@/extensions/ares/AresCompatibilityScanner';
import { IniFile } from '@/data/IniFile';
import { parseAresSuperWeaponDefinition } from '@/extensions/ares/AresSuperWeapons';
import { LightningStormEffect } from '@/game/superweapon/LightningStormEffect';
import { PsychicDominatorEffect } from '@/game/superweapon/PsychicDominatorEffect';

describe('Ares SW.Deferment', () => {
    test('parses the explicit delay and assigns a distinct scanner capability', () => {
        const ini = new IniFile(`
[Storm]
Type=LightningStorm
SW.Deferment=17
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection('Storm')!);
        const report = scanMentalOmegaIniSources([{
            name: 'rulesmo.ini',
            contents: '[Storm]\nType=LightningStorm\nSW.Deferment=17\n',
        }]);

        expect(definition?.swDeferment).toBe(17);
        expect(report.featureUsage.find((usage) => usage.featureId === 'ares.superweapon-deferment')?.occurrences).toBe(1);
        expect(report.featureUsage.find((usage) => usage.featureId === 'ares.superweapon-deferment')?.support?.runtimeImplemented).toBe(true);
    });

    test('overrides Lightning Storm deferment without losing the general fallback', () => {
        const game = {
            rules: {
                general: {
                    lightningStorm: { deferment: 12 },
                },
            },
        };

        const fallback = new LightningStormEffect('LightningStorm', {} as any, {} as any);
        fallback.onStart(game as any);
        expect((fallback as any).manifestStartTimer).toBe(12);

        const explicitZero = new LightningStormEffect('LightningStorm', {} as any, {} as any, 0);
        explicitZero.onStart(game as any);
        expect((explicitZero as any).manifestStartTimer).toBe(0);

        const explicit = new LightningStormEffect('LightningStorm', {} as any, {} as any, 4.9);
        explicit.onStart(game as any);
        expect((explicit as any).manifestStartTimer).toBe(4);
    });

    test('delays Psychic Dominator before the first animation and preserves its build-up timing', () => {
        const events: any[] = [];
        const game = {
            events: { dispatch: (event: any) => events.push(event) },
        };
        const effect = new PsychicDominatorEffect('PsychicDominator', {} as any, {} as any, 5);

        effect.onStart(game as any);
        expect(events).toHaveLength(0);

        for (let i = 0; i < 4; i++) {
            expect(effect.onTick(game as any)).toBe(false);
        }
        expect(events).toHaveLength(0);

        expect(effect.onTick(game as any)).toBe(false);
        expect(events).toHaveLength(1);
        expect((effect as any).ticksLeft).toBe(44);
    });
});

