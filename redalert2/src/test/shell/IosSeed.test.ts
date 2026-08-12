import { describe, expect, test } from 'bun:test';
import { computeSeedFingerprint, seedSentinelMatches, selectNativeMenuVideoSource, type SeedManifest } from '@/shell/iosSeed';

const manifest: SeedManifest = {
    files: [
        { path: 'ra2.mix', size: 281888480 },
        { path: 'expandmo95.mix', size: 326735460 },
    ],
};

describe('native shell game-resource seeding', () => {
    test('computes the same fingerprint regardless of manifest order', async () => {
        const reordered = { files: [...manifest.files].reverse() };

        await expect(computeSeedFingerprint(manifest)).resolves.toBe(await computeSeedFingerprint(reordered));
    });

    test('changes the fingerprint when a bundled path or size changes', async () => {
        const fingerprint = await computeSeedFingerprint(manifest);
        const changed = await computeSeedFingerprint({
            files: [
                { path: 'ra2.mix', size: 281888481 },
                { path: 'expandmo95.mix', size: 326735460 },
            ],
        });

        expect(changed).not.toBe(fingerprint);
    });

    test('reseeds when the sentinel is missing or stale, but skips when it matches', () => {
        expect(seedSentinelMatches(undefined, 'current')).toBe(false);
        expect(seedSentinelMatches('old', 'current')).toBe(false);
        expect(seedSentinelMatches('current', 'current')).toBe(true);
    });

    test('selects the iOS-owned menu video endpoint before trying the next candidate', async () => {
        const previousWindow = (globalThis as any).window;
        const previousFetch = globalThis.fetch;
        const probes: string[] = [];
        (globalThis as any).window = {
            location: {
                href: 'ra2app://app/index.html?shell=1&platform=ios',
                search: '?shell=1&platform=ios',
            },
        };
        (globalThis as any).fetch = async (input: RequestInfo | URL) => {
            probes.push(String(input));
            return { ok: probes.length === 2 } as Response;
        };
        try {
            await expect(selectNativeMenuVideoSource(['ra2ts_l_yr.bik', 'ra2ts_l.bik'])).resolves.toBe(
                'ra2app://app/native-media/ios/menu-video/ra2ts_l.bik',
            );
            expect(probes).toEqual([
                'ra2app://app/native-media/ios/menu-video/ra2ts_l_yr.bik?probe=1',
                'ra2app://app/native-media/ios/menu-video/ra2ts_l.bik?probe=1',
            ]);
        }
        finally {
            (globalThis as any).fetch = previousFetch;
            if (previousWindow === undefined) {
                delete (globalThis as any).window;
            }
            else {
                (globalThis as any).window = previousWindow;
            }
        }
    });
});
