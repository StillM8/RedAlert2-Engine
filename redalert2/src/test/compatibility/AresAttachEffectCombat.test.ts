import { describe, expect, test } from "bun:test";
import { resolveAresAttachEffectCombat } from "@/extensions/ares/AresAttachEffectCombat";

describe("Ares AttachEffect combat consumer", () => {
    test("uses neutral aggregate defaults without changing base values", () => {
        const base = Object.freeze({ speed: 2, armor: 3, firepower: 4, rof: 5 });

        const decision = resolveAresAttachEffectCombat(base);

        expect(decision).toEqual({
            base: { speed: 2, armor: 3, firepower: 4, rof: 5 },
            multipliers: { speed: 1, armor: 1, firepower: 1, rof: 1 },
            effective: { speed: 2, armor: 3, firepower: 4, rof: 5 },
            changedFields: [],
            isNeutral: true,
        });
        expect(base).toEqual({ speed: 2, armor: 3, firepower: 4, rof: 5 });
    });

    test("maps the existing aggregate products to effective combat values", () => {
        const base = { speed: 10, armor: 100, firepower: 20, rof: 12 };
        const aggregate = Object.freeze({
            speed: 0.8,
            armor: 1.25,
            firepower: 1.5,
            rof: 0.5,
        });

        const decision = resolveAresAttachEffectCombat(base, aggregate);

        expect(decision.multipliers).toEqual(aggregate);
        expect(decision.effective).toEqual({
            speed: 8,
            armor: 125,
            firepower: 30,
            rof: 6,
        });
        expect(decision.changedFields).toEqual(["speed", "armor", "firepower", "rof"]);
        expect(decision.isNeutral).toBe(false);
        expect(base).toEqual({ speed: 10, armor: 100, firepower: 20, rof: 12 });
        expect(aggregate).toEqual({ speed: 0.8, armor: 1.25, firepower: 1.5, rof: 0.5 });
    });

    test("keeps partial and finite non-neutral multipliers deterministic", () => {
        const decision = resolveAresAttachEffectCombat(
            { speed: 4, armor: 10, firepower: 8, rof: 20 },
            { speed: 0, firepower: -1 },
        );

        expect(decision).toMatchObject({
            multipliers: { speed: 0, armor: 1, firepower: -1, rof: 1 },
            effective: { speed: 0, armor: 10, firepower: -8, rof: 20 },
            changedFields: ["speed", "firepower"],
            isNeutral: false,
        });
    });

    test("falls back to neutral values for missing or non-finite inputs", () => {
        const decision = resolveAresAttachEffectCombat(
            { speed: Number.NaN, armor: 2, firepower: Number.POSITIVE_INFINITY, rof: 4 },
            { speed: Number.NaN, armor: Number.POSITIVE_INFINITY, firepower: undefined },
        );

        expect(decision).toEqual({
            base: { speed: 1, armor: 2, firepower: 1, rof: 4 },
            multipliers: { speed: 1, armor: 1, firepower: 1, rof: 1 },
            effective: { speed: 1, armor: 2, firepower: 1, rof: 4 },
            changedFields: [],
            isNeutral: true,
        });
    });

    test("guards overflow without mutating the normalized decision", () => {
        const decision = resolveAresAttachEffectCombat(
            { speed: Number.MAX_VALUE, armor: 1, firepower: 1, rof: 1 },
            { speed: 2 },
        );

        expect(decision.effective).toEqual({ speed: Number.MAX_VALUE, armor: 1, firepower: 1, rof: 1 });
        expect(decision.changedFields).toEqual(["speed"]);
        expect(decision.isNeutral).toBe(false);
    });
});
