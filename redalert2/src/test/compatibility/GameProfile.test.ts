import { describe, expect, test } from 'bun:test';
import { detectContentProfile, detectGameProfile, getGameProfile, validateMentalOmegaInstallation } from '@/engine/GameProfile';
import {
    canonicalizeFileProviderCopyPath,
    compareFileProviderCopyGeneration,
    gamePathKey,
    normalizeGamePath,
    parseFileProviderCopySuffix,
} from '@/engine/GamePath';

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

    test('detects profiles case-insensitively through an imported directory prefix', () => {
        expect(detectGameProfile([
            'Imported Game\\LANGUAGE.MIX',
            'Imported Game/multi.mix',
            'Imported Game/RA2.MIX',
        ])).toBe('ra2');

        expect(detectGameProfile([
            'Imported Game\\LANGUAGE.MIX',
            'Imported Game/multi.mix',
            'Imported Game/RA2.MIX',
            'Imported Game/LANGMD.MIX',
            'Imported Game/MULTIMD.MIX',
            'Imported Game/RA2MD.MIX',
        ])).toBe('yr');
    });

    test('ignores unsafe paths while detecting valid retail files', () => {
        expect(detectGameProfile([
            '../ra2md.mix',
            '/absolute/langmd.mix',
            'language.mix',
            'multi.mix',
            'ra2.mix',
        ])).toBe('ra2');
    });

    test('does not classify Yuri without all three expansion archives', () => {
        expect(detectGameProfile([
            'language.mix', 'multi.mix', 'ra2.mix',
            'langmd.mix', 'multimd.mix',
        ])).toBe('ra2');
    });

    test('keeps Mental Omega explicit and does not auto-detect it as a vanilla profile', () => {
        const paths = [
            'language.mix', 'multi.mix', 'ra2.mix',
            'langmd.mix', 'multimd.mix', 'ra2md.mix',
            'rulesmo.ini', 'artmo.ini', 'expandmo95.mix',
        ];
        expect(detectGameProfile(paths)).toBe('yr');
        expect(getGameProfile('mental-omega').engine).toBe(getGameProfile('yr').engine);
        expect(getGameProfile('mental-omega').extensionRuntime).toBe('ares');
        expect(getGameProfile('mental-omega').fileNameOverrides).toEqual({
            'rules.ini': 'rulesmo.ini',
            'art.ini': 'artmo.ini',
            'ai.ini': 'aimo.ini',
        });
        expect(getGameProfile('mental-omega').optionalFileNameOverrides).toEqual({
            'ui.ini': 'uimd.ini',
            'eva.ini': 'evamo.ini',
            'sound.ini': 'soundmo.ini',
            'missions.pkt': 'missionsmo.pkt',
        });
        expect(getGameProfile('mental-omega').resolveCanonicalFile('rules.ini')).toBe('rulesmo.ini');
        expect(getGameProfile('mental-omega').resolveCanonicalFile('ui.ini')).toBe('uimd.ini');
        expect(getGameProfile('mental-omega').resolveCanonicalFile('eva.ini')).toBe('evamo.ini');
        expect(getGameProfile('mental-omega').resolveCanonicalFile('sound.ini')).toBe('soundmo.ini');
        expect(getGameProfile('mental-omega').resolveCanonicalFile('sound.ini', () => false)).toBe('soundmd.ini');
        expect(getGameProfile('mental-omega').resolveCanonicalFile('eva.ini', () => false)).toBe('evamd.ini');
    });

    test('detects a partial Yuri mod without requiring the imported YR base archives', () => {
        expect(detectContentProfile([
            'rulesmd.ini', 'artmd.ini', 'expandmd12.mix', 'maps/example.yro',
        ])).toBe('yr');
        expect(detectContentProfile([
            'rulesmo.ini', 'artmo.ini', 'expandmo99.mix',
        ])).toBe('mental-omega');
        expect(detectContentProfile([
            'rules.ini', 'art.ini', 'expand02.mix',
        ])).toBe('ra2');
    });

    test('validates Mental Omega only when its own content signatures are present', () => {
        const yrOnly = validateMentalOmegaInstallation([
            'language.mix', 'multi.mix', 'ra2.mix',
            'langmd.mix', 'multimd.mix', 'ra2md.mix',
        ]);
        expect(yrOnly.valid).toBe(false);
        expect(yrOnly.baseGameValid).toBe(true);
        expect(yrOnly.missing).toContain('Mental Omega rules: rulesmo.ini');

        const mo = validateMentalOmegaInstallation([
            'Install/MIX/LANGUAGE.MIX',
            'Install/MIX/MULTI.MIX',
            'Install/MIX/RA2.MIX',
            'Install/MIX/LANGMD.MIX',
            'Install/MIX/MULTIMD.MIX',
            'Install/MIX/RA2MD.MIX',
            'Install/RULESMO.INI',
            'Install/ARTMO.INI',
            'Install/EXPANDMO95.MIX',
        ]);
        expect(mo.valid).toBe(true);
        expect(mo.baseGameValid).toBe(true);
        expect(mo.extensionFilesValid).toBe(true);
        expect(mo.modFilesValid).toBe(true);
        expect(mo.warnings).toHaveLength(1);
    });

    test('rejects unsafe paths during Mental Omega validation', () => {
        const result = validateMentalOmegaInstallation([
            '../rulesmo.ini',
            '/absolute/artmo.ini',
            'language.mix', 'multi.mix', 'ra2.mix',
            'langmd.mix', 'multimd.mix', 'ra2md.mix',
        ]);
        expect(result.valid).toBe(false);
        expect(result.extensionFilesValid).toBe(false);
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

    test('parses file-provider copy generations without changing authored paths implicitly', () => {
        expect(parseFileProviderCopySuffix('expandmo99 (1).mix')).toEqual({
            canonicalSegment: 'expandmo99.mix',
            copyIndex: 1,
        });
        expect(parseFileProviderCopySuffix('INI (2)')).toEqual({
            canonicalSegment: 'INI',
            copyIndex: 2,
        });
        expect(parseFileProviderCopySuffix('Arena (1).map')?.canonicalSegment).toBe('Arena.map');
        expect(parseFileProviderCopySuffix('Arena.map')).toBeUndefined();
        expect(canonicalizeFileProviderCopyPath('INI (1)/Map Code/rules (2).ini'))
            .toBe('INI/Map Code/rules.ini');
        expect(compareFileProviderCopyGeneration('INI (1)/rules.ini', 'INI/rules (2).ini'))
            .toBeGreaterThan(0);
    });
});
