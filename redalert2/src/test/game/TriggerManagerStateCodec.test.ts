import { describe, expect, test } from "bun:test";
import {
    TriggerManager,
    TRIGGER_MANAGER_STATE_VERSION,
    type TriggerManagerState,
} from "@/game/trigger/TriggerManager";
import { captureExtensionState, restoreExtensionState } from "@/game/state/ExtensionStateSnapshot";

/**
 * Versioned trigger slice for the extension snapshot walk: instance
 * completion/disabled state, remaining-target fingerprints, and variable
 * maps restore transactionally; in-flight events are counted but never
 * fabricated, and strict restore refuses snapshots holding them.
 */

function makeManager() {
    const manager = new TriggerManager();
    const targetA = { name: "A", type: 1, rx: 2, ry: 3 };
    const targetB = { name: "B", type: 1, rx: 5, ry: 6 };
    const instance = {
        trigger: { tag: { id: "tag-1" } },
        conditions: [],
        targets: [targetA, targetB],
        remainingTargets: new Set<any>([targetA]),
        disabled: false,
        finished: false,
    };
    (manager as any).triggerInstances.set("t-1", instance);
    manager.toggleGlobalVariable("g1", true);
    manager.toggleLocalVariable("l1", true);
    return { manager, instance, targetA, targetB };
}

describe("TriggerManager state codec", () => {
    test("capture/restore round-trips instances, targets, and variables", () => {
        const source = makeManager();
        source.instance.disabled = true;
        source.instance.finished = true;
        const snapshot = JSON.parse(JSON.stringify(source.manager.captureState()));

        const { manager: target, targetB } = makeManager();
        const targetInstance = (target as any).triggerInstances.get("t-1");
        targetInstance.disabled = false;
        targetInstance.finished = false;
        targetInstance.remainingTargets = new Set([targetB]);
        target.toggleGlobalVariable("g1", false);

        target.restoreState(snapshot, { strict: true });

        expect(target.captureState()).toEqual(source.manager.captureState());
    });

    test("strict restore resolves every reference before mutating anything", () => {
        const source = makeManager();
        const snapshot = source.manager.captureState();

        // Unknown trigger id.
        const unknownTrigger: TriggerManagerState = {
            ...snapshot,
            instances: [...snapshot.instances, { id: "missing", disabled: false, finished: false, remainingTargets: [] }],
        };
        // Unknown remaining-target fingerprint.
        const unknownTarget: TriggerManagerState = {
            ...snapshot,
            instances: snapshot.instances.map((entry) => ({
                ...entry,
                remainingTargets: ["Ghost|1|9|9"],
            })),
        };
        for (const broken of [unknownTrigger, unknownTarget]) {
            const { manager: target } = makeManager();
            const before = JSON.stringify(target.captureState());
            expect(() => target.restoreState(broken, { strict: true })).toThrow(/unresolved/i);
            // Transactional: nothing may have been applied.
            expect(JSON.stringify(target.captureState())).toBe(before);
        }
    });

    test("strict restore refuses in-flight trigger events", () => {
        const source = makeManager();
        (source.manager as any).pendingGameEvents.push({ type: 1 });
        const snapshot = source.manager.captureState();
        expect(snapshot.pendingEventCount).toBe(1);

        const { manager: target } = makeManager();
        expect(() => target.restoreState(snapshot, { strict: true })).toThrow(/in-flight/i);

        // Permissive restore proceeds and drops the live queue.
        (target as any).pendingGameEvents.push({ type: 2 });
        target.restoreState(snapshot);
        expect((target as any).pendingGameEvents).toHaveLength(0);
    });

    test("rejects unsupported versions and malformed payloads", () => {
        const { manager } = makeManager();
        expect(() => manager.restoreState({ version: 2, instances: [], globalVariables: [], localVariables: [], pendingEventCount: 0 }))
            .toThrow(/version/i);
        expect(() => manager.restoreState(null)).toThrow(/object/i);
        expect(() => manager.restoreState({ version: TRIGGER_MANAGER_STATE_VERSION, instances: {}, globalVariables: [], localVariables: [], pendingEventCount: 0 }))
            .toThrow(/arrays/i);
    });

    test("trigger state rides the extension snapshot walk", () => {
        const source = makeManager();
        source.instance.finished = true;
        const sourceGame = {
            playerList: { getAll: () => [] },
            world: { getAllObjects: () => [] },
            triggers: source.manager,
        };
        const snapshot = JSON.parse(JSON.stringify(captureExtensionState(sourceGame)));

        const { manager: target } = makeManager();
        const targetGame = {
            playerList: { getAll: () => [] },
            world: { getAllObjects: () => [] },
            triggers: target,
        };
        restoreExtensionState(targetGame, snapshot, { strict: true });
        expect(target.captureState()).toEqual(source.manager.captureState());
    });
});
