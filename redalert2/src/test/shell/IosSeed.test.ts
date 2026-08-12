import { describe, expect, test } from 'bun:test';
import { computeSeedFingerprint, seedSentinelMatches, type SeedManifest } from '@/shell/iosSeed';

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
});
