import { describe, expect, test } from 'bun:test';
import { detectGameProfile } from '@/engine/GameProfile';
import { gamePathKey, normalizeGamePath } from '@/engine/GamePath';

describe('GameProfile detection', () => {
    test('detects Red Alert 2 when Yuri archives are absent', () => {
        expect(detectGameProfile([
            'language.mix', 'multi.mix', 'ra2.mix',
        ])).toBe('ra2');
    });

    test('detects Yuri\'s Revenge from its three expansion archives', () => {
        expect(detectGameProfile([
            'language.mix', 'multi.mix', 'ra2.mix',
            'langmd.mix', 'multimd.mix', 'ra2md.mix',
        ])).toBe('yr');
    });
});

describe('GamePath', () => {
    test('normalizes Windows separators and casefolds lookups', () => {
        expect(normalizeGamePath('./Maps/Standard/test.map')).toBe('Maps/Standard/test.map');
        expect(gamePathKey('RULESMD.INI')).toBe('rulesmd.ini');
    });

    test('rejects traversal and absolute paths', () => {
        expect(() => normalizeGamePath('../rules.ini')).toThrow();
        expect(() => normalizeGamePath('/absolute/rules.ini')).toThrow();
        expect(() => normalizeGamePath('unsafe:name.ini')).toThrow();
    });
});
