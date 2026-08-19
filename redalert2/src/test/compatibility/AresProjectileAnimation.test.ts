import { describe, expect, test } from "bun:test";
import { resolveAresProjectileAnimationFrame } from "@/extensions/ares/AresProjectileExtensions";

describe("Ares projectile AnimLength/AnimRate", () => {
    test("animates inside each rotating facing using simulation age", () => {
        const common = { direction: 45, rotates: true, animLength: 4, animRate: 2, frameCount: 128 };
        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 0 })).toBe(0);
        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 1 })).toBe(0);
        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 2 })).toBe(1);
        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 6 })).toBe(3);
        expect(resolveAresProjectileAnimationFrame({ ...common, ageTicks: 8 })).toBe(0);
    });

    test("keeps legacy one-frame facing layout when AnimLength is one", () => {
        const direction = 90;
        const expectedFacing = Math.round((((direction - 45 + 360) % 360) / 360) * 32) % 32;
        expect(resolveAresProjectileAnimationFrame({ direction, rotates: true, animLength: 1, animRate: 1, ageTicks: 99, frameCount: 32 })).toBe(expectedFacing);
        expect(resolveAresProjectileAnimationFrame({ direction, rotates: false, animLength: 4, animRate: 1, ageTicks: 99, frameCount: 8 })).toBe(0);
    });
});
