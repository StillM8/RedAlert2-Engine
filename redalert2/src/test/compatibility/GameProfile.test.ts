import { describe, expect, test } from 'bun:test';
import { detectGameProfile, hasMentalOmegaSignature } from '@/engine/GameProfile';
import { gamePathKey, normalizeGamePath } from '@/engine/GamePath';

describe('GameProfile detection', () => {
    test('does not identify a plain Yuri installation as Mental Omega', () => {
        expect(detectGameProfile([
            'language.mix', 'multi.mix', 'ra2.mix',
            'langmd.mix', 'multimd.mix', 'ra2md.mix',
        ])).toBe('yr');
    });

    test('recognizes MO regardless of expand archive number and path case', () => {
        expect(hasMentalOmegaSignature([
            'EXPANDMO94.MIX',
            'MapsMO/Standard/ZeroPressure.map',
        ])).toBe(true);
        expect(detectGameProfile([
            'expandmo99.mix',
            'mapsmo/challenge/test.map',
            'ra2.mix', 'ra2md.mix', 'langmd.mix', 'multimd.mix',
        ])).toBe('mental-omega');
    });
});

describe('GamePath', () => {
    test('normalizes Windows separators and casefolds lookups', () => {
        expect(normalizeGamePath('./MapsMO\\Standard\\test.map')).toBe('MapsMO/Standard/test.map');
        expect(gamePathKey('RULESMD.INI')).toBe('rulesmd.ini');
    });

    test('rejects traversal and absolute paths', () => {
        expect(() => normalizeGamePath('../rules.ini')).toThrow();
        expect(() => normalizeGamePath('/absolute/rules.ini')).toThrow();
        expect(() => normalizeGamePath('unsafe:name.ini')).toThrow();
    });
});
