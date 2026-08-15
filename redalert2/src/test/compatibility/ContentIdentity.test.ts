import { describe, expect, test } from 'bun:test';
import { composeContentIdentity } from '@/engine/Engine';

describe('composeContentIdentity', () => {
    test('is deterministic for identical inputs', () => {
        const a = composeContentIdentity("1a2b3c", "mental-omega", "mental-omega", "ares");
        const b = composeContentIdentity("1a2b3c", "mental-omega", "mental-omega", "ares");
        expect(a).toBe(b);
        expect(a).toContain("1a2b3c");
        expect(a).toContain("mental-omega");
        expect(a).toContain("mod:mental-omega");
        expect(a).toContain("ares");
    });

    test('differs when the effective content hash differs', () => {
        const a = composeContentIdentity("1a2b3c", "mental-omega", "mental-omega", "ares");
        const b = composeContentIdentity("deadbeef", "mental-omega", "mental-omega", "ares");
        expect(a).not.toBe(b);
    });

    test('differs when the profile differs', () => {
        const a = composeContentIdentity("1a2b3c", "yr", undefined, undefined);
        const b = composeContentIdentity("1a2b3c", "ra2", undefined, undefined);
        expect(a).not.toBe(b);
        expect(a).toContain("mod:none");
    });

    test('differs when the mod differs', () => {
        const a = composeContentIdentity("1a2b3c", "yr", "mental-omega", "ares");
        const b = composeContentIdentity("1a2b3c", "yr", "another-ares-mod", "ares");
        expect(a).not.toBe(b);
    });

    test('differs when the extension runtime differs', () => {
        const a = composeContentIdentity("1a2b3c", "yr", "mental-omega", "ares");
        const b = composeContentIdentity("1a2b3c", "yr", "mental-omega", "phobos");
        expect(a).not.toBe(b);
    });

    test('never collides between a mod and no mod for the same hash', () => {
        const withMod = composeContentIdentity("1a2b3c", "yr", "mental-omega", "ares");
        const withoutMod = composeContentIdentity("1a2b3c", "yr", undefined, undefined);
        expect(withMod).not.toBe(withoutMod);
    });
});
