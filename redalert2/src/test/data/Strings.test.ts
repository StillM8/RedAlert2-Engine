import { describe, expect, test } from 'bun:test';
import { Strings } from '@/data/Strings';

describe('layered game strings', () => {
    test('profile strings override retail strings while retaining provenance', () => {
        const strings = new Strings();
        strings.fromJson({
            'GUI:Options': 'Options',
            'NAME:BASE': 'Base label',
        }, 'retail-base', { file: 'ra2.csf', archive: 'language.mix' });
        strings.fromJson({
            'GUI:Options': 'Mental Omega Options',
            'NAME:MO_ONLY': 'MO-only label',
        }, 'profile', { file: 'stringtable09.csf', archive: 'expandmo98.mix' });

        expect(strings.get('gui:options')).toBe('Mental Omega Options');
        expect(strings.get('name:base')).toBe('Base label');
        expect(strings.get('name:mo_only')).toBe('MO-only label');

        expect(strings.explain('GUI:OPTIONS')).toEqual({
            requested: 'GUI:OPTIONS',
            normalized: 'gui:options',
            found: true,
            winner: {
                value: 'Mental Omega Options',
                layer: 'profile',
                file: 'stringtable09.csf',
                archive: 'expandmo98.mix',
            },
            shadowed: [{
                value: 'Options',
                layer: 'retail-base',
                file: 'ra2.csf',
                archive: 'language.mix',
            }],
        });
    });

    test('application fallback does not replace a mounted game label', () => {
        const strings = new Strings({ 'GUI:Options': 'Web fallback' });
        strings.fromJson({ 'GUI:Options': 'Retail label' }, 'retail-expansion', { file: 'ra2md.csf' });
        strings.setLayerValue('GUI:Options', 'Built-in override', 'application-override', { file: 'test' });

        expect(strings.get('GUI:Options')).toBe('Built-in override');
        expect(strings.explain('GUI:Options').shadowed.map((candidate) => candidate.value)).toEqual([
            'Retail label',
            'Web fallback',
        ]);
    });

    test('same-layer files use deterministic later-file precedence', () => {
        const strings = new Strings();
        strings.fromJson({ 'NAME:TEST': 'first' }, 'profile', { file: 'stringtable09.csf' });
        strings.fromJson({ 'NAME:TEST': 'second' }, 'profile', { file: 'stringtable10.csf' });

        expect(strings.get('NAME:TEST')).toBe('second');
        expect(strings.explain('NAME:TEST').winner?.file).toBe('stringtable10.csf');
        expect(strings.explain('NAME:TEST').shadowed[0].file).toBe('stringtable09.csf');
    });

    test('empty labels remain present and %hs is normalized for sprintf', () => {
        const strings = new Strings();
        strings.fromJson({ 'EMPTY': '', 'FORMAT': '%hs ready' }, 'retail-base');

        expect(strings.has('empty')).toBe(true);
        expect(strings.get('empty')).toBe('');
        expect(strings.get('format')).toBe('%s ready');
    });
});
