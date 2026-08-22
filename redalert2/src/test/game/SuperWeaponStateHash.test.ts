import { describe, expect, test } from "bun:test";
import { SuperWeaponsTrait } from "@/game/player/trait/SuperWeaponsTrait";

/**
 * Lockstep hash coverage for player superweapon state.
 *
 * Superweapon readiness is future-affecting canonical state: a ready
 * superweapon can fire this tick while a charging one cannot. Two lockstep
 * peers that disagree about charge state MUST produce different canonical
 * hashes or the desync goes undetected until gameplay visibly breaks.
 */

function makeWeapon(overrides: Partial<{ status: number; chargeTicks: number; rechargeTicks: number; name: string }> = {}): any {
    return {
        name: overrides.name ?? "NukeSpecial",
        status: overrides.status ?? 1,
        chargeTicks: overrides.chargeTicks ?? 100,
        rechargeTicks: overrides.rechargeTicks ?? 500,
    };
}

describe("SuperWeaponsTrait lockstep hash", () => {
    test("identical state built independently hashes identically", () => {
        const first = new SuperWeaponsTrait();
        const second = new SuperWeaponsTrait();
        for (const name of ["NukeSpecial", "LightningSpecial"]) {
            first.add(makeWeapon({ name }));
            second.add(makeWeapon({ name }));
            first.recordAresSuperWeaponShot(name, 2);
            second.recordAresSuperWeaponShot(name, 2);
        }
        expect(second.getHash()).toBe(first.getHash());
    });

    test("readiness divergence changes the hash", () => {
        const ready = new SuperWeaponsTrait();
        ready.add(makeWeapon({ status: 0, chargeTicks: 0 }));
        const charging = new SuperWeaponsTrait();
        charging.add(makeWeapon({ status: 2, chargeTicks: 300 }));
        expect(charging.getHash()).not.toBe(ready.getHash());
    });

    test("charge tick drift changes the hash", () => {
        const at100 = new SuperWeaponsTrait();
        at100.add(makeWeapon({ chargeTicks: 100 }));
        const at99 = new SuperWeaponsTrait();
        at99.add(makeWeapon({ chargeTicks: 99 }));
        expect(at99.getHash()).not.toBe(at100.getHash());
    });

    test("shots-fired divergence changes the hash", () => {
        const firedOnce = new SuperWeaponsTrait();
        firedOnce.add(makeWeapon());
        firedOnce.recordAresSuperWeaponShot("NukeSpecial", 1);
        const firedTwice = new SuperWeaponsTrait();
        firedTwice.add(makeWeapon());
        firedTwice.recordAresSuperWeaponShot("NukeSpecial", 2);
        expect(firedTwice.getHash()).not.toBe(firedOnce.getHash());
    });

    test("ownership set difference changes the hash", () => {
        const one = new SuperWeaponsTrait();
        one.add(makeWeapon());
        const two = new SuperWeaponsTrait();
        two.add(makeWeapon());
        two.add(makeWeapon({ name: "ChronoSpecial" }));
        expect(two.getHash()).not.toBe(one.getHash());
    });

    test("insertion order does not affect the hash", () => {
        const forward = new SuperWeaponsTrait();
        forward.add(makeWeapon({ name: "Alpha" }));
        forward.add(makeWeapon({ name: "Beta" }));
        const backward = new SuperWeightsOrderStub();
        expect(backward.hashFor(["Beta", "Alpha"])).toBe(forward.getHash());
    });
});

/** Mirrors the trait's sorted-key algorithm with reversed insertion order. */
class SuperWeightsOrderStub extends SuperWeaponsTrait {
    hashFor(names: string[]): number {
        // Insert in reverse to prove sorted iteration neutralizes order.
        for (const name of names) {
            this.add(makeWeapon({ name }));
        }
        return this.getHash();
    }
}
