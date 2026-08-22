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

/**
 * Adversarial coverage for the historical shots-fired map.
 *
 * The global availability evaluator consults historical shot counts even for
 * superweapons the player does NOT currently own (grant/revoke/reacquire),
 * so the history collection must be hashed in full, independently of the
 * owned-weapon collection. The cases below are collisions the previous
 * hash (owned weapons + bare history size) could not detect.
 */
describe("SuperWeaponsTrait shot-history hash coverage", () => {
    test("same history size, different historical superweapon names collide no longer", () => {
        const peerA = new SuperWeaponsTrait();
        peerA.recordAresSuperWeaponShot("FooSpecial", 1);
        const peerB = new SuperWeaponsTrait();
        peerB.recordAresSuperWeaponShot("BarSpecial", 1);
        expect(peerB.getHash()).not.toBe(peerA.getHash());
    });

    test("same historical name, different shot count changes the hash", () => {
        const one = new SuperWeaponsTrait();
        one.recordAresSuperWeaponShot("FooSpecial", 1);
        const two = new SuperWeaponsTrait();
        two.recordAresSuperWeaponShot("FooSpecial", 2);
        expect(two.getHash()).not.toBe(one.getHash());
    });

    test("removed superweapon with retained history stays hashed", () => {
        const removed = new SuperWeaponsTrait();
        removed.add(makeWeapon({ name: "FooSpecial" }));
        removed.recordAresSuperWeaponShot("FooSpecial", 1);
        removed.remove("FooSpecial");
        expect(removed.has("FooSpecial")).toBe(false);
        expect(removed.getAresShotsFired("FooSpecial")).toBe(1);

        const neverOwned = new SuperWeaponsTrait();
        neverOwned.recordAresSuperWeaponShot("BarSpecial", 1);
        // Equal sizes, both empty owned collections — the old hash collided.
        expect(neverOwned.getHash()).not.toBe(removed.getHash());
    });

    test("removal, availability reevaluation, reacquisition keeps deterministic history", () => {
        const first = new SuperWeaponsTrait();
        first.add(makeWeapon({ name: "FooSpecial" }));
        first.recordAresSuperWeaponShot("FooSpecial", 3);
        // Provider lost: the SW leaves the owned set, history persists.
        first.remove("FooSpecial");
        const midHash = first.getHash();
        // Provider rebuilt: the SW returns and restores its historical count.
        first.add(makeWeapon({ name: "FooSpecial" }));
        expect(first.getHash()).not.toBe(midHash);

        const second = new SuperWeaponsTrait();
        second.recordAresSuperWeaponShot("FooSpecial", 3);
        second.add(makeWeapon({ name: "FooSpecial" }));
        // Same semantic state built in a different operation order.
        expect(second.getHash()).toBe(first.getHash());
    });

    test("identical semantic histories hash identically regardless of insertion order", () => {
        const forward = new SuperWeaponsTrait();
        forward.recordAresSuperWeaponShot("Alpha", 1);
        forward.recordAresSuperWeaponShot("Beta", 2);
        forward.recordAresSuperWeaponShot("Gamma", 3);
        const backward = new SuperWeaponsTrait();
        backward.recordAresSuperWeaponShot("Gamma", 3);
        backward.recordAresSuperWeaponShot("Beta", 2);
        backward.recordAresSuperWeaponShot("Alpha", 1);
        expect(backward.getHash()).toBe(forward.getHash());
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
