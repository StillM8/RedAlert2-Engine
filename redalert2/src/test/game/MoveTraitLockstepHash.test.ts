import { describe, expect, test } from "bun:test";
import { MoveTrait } from "@/game/gameobject/trait/MoveTrait";
import { MoveState } from "@/game/gameobject/trait/MoveTrait";
import { CollisionState } from "@/game/gameobject/trait/MoveTrait";

/**
 * Lockstep coverage for movement state. MoveTrait and the active locomotor
 * previously contributed nothing to the canonical object hash, so diverged
 * velocity/phase/locomotor state desynced peers invisibly (the "Locomotors"
 * open row of docs/DeterministicStateCoverage.md).
 */

function makeTrait(): any {
    return new MoveTrait({} as any, {} as any);
}

describe("MoveTrait lockstep hash", () => {
    test("identical states hash identically and mutations diverge", () => {
        const a = makeTrait();
        const b = makeTrait();
        expect(a.getHash()).toBe(b.getHash());

        b.setDisabled(true);
        expect(a.getHash()).not.toBe(b.getHash());

        const c = makeTrait();
        (c as any).speedPenalty = 0.5;
        expect(a.getHash()).not.toBe(c.getHash());

        const d = makeTrait();
        (d as any).velocity.set(1, 0, 0);
        expect(a.getHash()).not.toBe(d.getHash());

        const e = makeTrait();
        (e as any).moveState = MoveState.Moving;
        expect(a.getHash()).not.toBe(e.getHash());

        const f = makeTrait();
        (f as any).collisionState = CollisionState.Waiting;
        expect(a.getHash()).not.toBe(f.getHash());
    });

    test("chrono-aftereffect lock participates in the hash", () => {
        const a = makeTrait();
        const b = makeTrait();
        b.setChronoAftereffectLocked(true);
        expect(a.getHash()).not.toBe(b.getHash());
        expect(b.isChronoAftereffectLocked()).toBe(true);
    });

    test("teleport bookkeeping and path reservations diverge", () => {
        const a = makeTrait();
        const b = makeTrait();
        (b as any).lastTeleportTick = 42;
        expect(a.getHash()).not.toBe(b.getHash());

        const c = makeTrait();
        (c as any).reservedPathNodes = [{ x: 1, y: 2 }];
        expect(a.getHash()).not.toBe(c.getHash());
        expect(makeTrait().getHash()).toBe(a.getHash());
    });

    test("locomotor private phase state diverges", () => {
        const a = makeTrait();
        const b = makeTrait();
        (a as any).locomotor = { phase: 1, cursor: 2, facing: 0.5 };
        (b as any).locomotor = { phase: 1, cursor: 3, facing: 0.5 };
        expect(a.getHash()).not.toBe(b.getHash());

        // Key order must not matter (stable sorted-key walk).
        const c = makeTrait();
        const d = makeTrait();
        (c as any).locomotor = { phase: 1, cursor: 2 };
        (d as any).locomotor = { cursor: 2, phase: 1 };
        expect(c.getHash()).toBe(d.getHash());
    });

    test("host references and cycles never enter the hash", () => {
        const a = makeTrait();
        const b = makeTrait();
        const locomotorA: any = { phase: 5 };
        locomotorA.self = locomotorA;
        locomotorA.gameObject = { id: 1, health: 100 };
        const locomotorB: any = { phase: 5 };
        locomotorB.self = locomotorB;
        locomotorB.gameObject = { id: 999, health: 1 };
        (a as any).locomotor = locomotorA;
        (b as any).locomotor = locomotorB;

        // Neither the cycle nor the host object graph may crash or diverge.
        expect(a.getHash()).toBe(b.getHash());
    });
});
