import { describe, expect, test } from "bun:test";
import { TriggerManager } from "@/game/trigger/TriggerManager";
import { scalarStateHash } from "@/util/stateHash";

/**
 * Lockstep coverage for trigger state (the Triggers row of
 * docs/DeterministicStateCoverage.md): completion/disabled flags, remaining
 * targets, variables, and pending events all steer future action execution.
 */

function makeInstance(over: Record<string, unknown> = {}) {
    return {
        trigger: { tag: { id: "tag-1" } },
        conditions: [],
        targets: [],
        remainingTargets: new Set<any>(),
        disabled: false,
        finished: false,
        ...over,
    };
}

function managerWith(instance: any): TriggerManager {
    const manager = new TriggerManager();
    (manager as any).triggerInstances.set("t-1", instance);
    return manager;
}

describe("TriggerManager lockstep hash", () => {
    test("identical states hash identically", () => {
        expect(new TriggerManager().getHash()).toBe(new TriggerManager().getHash());
        const a = managerWith(makeInstance());
        const b = managerWith(makeInstance());
        expect(a.getHash()).toBe(b.getHash());
    });

    test("completion, disabled state, and remaining targets diverge", () => {
        const base = managerWith(makeInstance()).getHash();
        expect(managerWith(makeInstance({ finished: true })).getHash()).not.toBe(base);
        expect(managerWith(makeInstance({ disabled: true })).getHash()).not.toBe(base);

        const targetA = { name: "A", type: 1, rx: 2, ry: 3 };
        const withRemaining = managerWith(makeInstance({
            remainingTargets: new Set([targetA]),
        }));
        expect(withRemaining.getHash()).not.toBe(base);

        // Remaining-target identity counts, and order does not.
        const targetB = { name: "B", type: 1, rx: 5, ry: 6 };
        const one = managerWith(makeInstance({ remainingTargets: new Set([targetA, targetB]) }));
        const two = managerWith(makeInstance({ remainingTargets: new Set([targetB, targetA]) }));
        expect(one.getHash()).toBe(two.getHash());
    });

    test("variables diverge and insertion order does not", () => {
        const a = new TriggerManager();
        const b = new TriggerManager();
        a.toggleGlobalVariable("g1", true);
        b.toggleGlobalVariable("g1", true);
        expect(a.getHash()).toBe(b.getHash());

        b.toggleLocalVariable("l1", true);
        expect(a.getHash()).not.toBe(b.getHash());

        const c = new TriggerManager();
        c.toggleGlobalVariable("g1", true);
        c.toggleGlobalVariable("g2", true);
        const d = new TriggerManager();
        d.toggleGlobalVariable("g2", true);
        d.toggleGlobalVariable("g1", true);
        expect(c.getHash()).toBe(d.getHash());
    });

    test("pending events diverge by payload and canonical object identity", () => {
        const a = managerWith(makeInstance());
        const b = managerWith(makeInstance());
        (a as any).pendingGameEvents.push({ type: 7, value: 1 });
        expect(a.getHash()).not.toBe(b.getHash());

        const c = managerWith(makeInstance());
        const d = managerWith(makeInstance());
        (c as any).pendingGameEvents.push({ type: 7, object: { id: 1, hp: 3 } });
        (d as any).pendingGameEvents.push({ type: 7, object: { id: 1, hp: 999 } });
        // Canonical object identity (id) replaces the walked object graph.
        expect(c.getHash()).toBe(d.getHash());
        (d as any).pendingGameEvents.length = 0;
        (d as any).pendingGameEvents.push({ type: 7, object: { id: 2, hp: 3 } });
        expect(c.getHash()).not.toBe(d.getHash());
    });

    test("pending event graphs are cycle-safe", () => {
        const manager = managerWith(makeInstance());
        const event: any = { type: 11 };
        event.self = event;
        (manager as any).pendingGameEvents.push(event);
        expect(() => manager.getHash()).not.toThrow();
    });

    test("scalarStateHash applies canonical identity rules", () => {
        expect(scalarStateHash("x", { playerListIndex: 2, credits: 100 }))
            .toBe(scalarStateHash("x", { playerListIndex: 2, credits: 5 }));
        expect(scalarStateHash("x", { id: 4, a: 1 })).toBe(scalarStateHash("x", { id: 4, a: 2 }));
        expect(scalarStateHash("x", { id: 4 })).not.toBe(scalarStateHash("x", { id: 5 }));
    });
});
