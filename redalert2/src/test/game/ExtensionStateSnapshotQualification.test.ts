import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { Rules } from "@/game/rules/Rules";
import { parseAresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import { captureExtensionState, restoreExtensionState } from "@/game/state/ExtensionStateSnapshot";
import {
    createQualifiedWorld,
    qualifyRestore,
    RESTORE_QUALIFICATION_TICK,
    type QualifiedWorld,
} from "@/test/helpers/DeterministicRestoreHarness";

function objectTechLevelRules(): any {
    const infantry = { name: "E1", type: ObjectType.Infantry, techLevel: 5 };
    const rules = Object.create(Rules.prototype) as any;
    rules.buildingRules = new Map();
    rules.infantryRules = new Map([[infantry.name, infantry]]);
    rules.vehicleRules = new Map();
    rules.aircraftRules = new Map();
    rules.objectTechLevelOverrides = new Map();
    return rules;
}

/**
 * End-to-end restore qualification for the extension-state snapshot walk over
 * real engine objects: a freshly built world restores the captured extension
 * slice (plus the canonical identity axes the harness compares) without
 * replaying pre-snapshot history, then both worlds simulate identically.
 */

interface QualificationSlice {
    tick: number;
    prng: unknown;
    nextObjectId: number;
    extension: unknown;
}

function sliceOptions(extra: Partial<Parameters<typeof qualifyRestore>[0]> = {}) {
    return {
        seed: 20260214,
        objectCount: 12,
        ticksBeforeSnapshot: RESTORE_QUALIFICATION_TICK,
        ticksAfterSnapshot: RESTORE_QUALIFICATION_TICK,
        effect: () => undefined,
        capture: (source: QualifiedWorld): QualificationSlice => ({
            tick: source.game.currentTick,
            prng: source.game.prng.captureState(),
            nextObjectId: source.game.nextObjectId.value,
            extension: JSON.parse(JSON.stringify(captureExtensionState(source.game))),
        }),
        restore: (target: QualifiedWorld, snapshot: unknown): void => {
            const slice = snapshot as QualificationSlice;
            target.game.currentTick = slice.tick;
            target.game.prng.restoreState(slice.prng);
            target.game.nextObjectId.value = slice.nextObjectId;
            restoreExtensionState(target.game, slice.extension, { strict: true });
        },
        ...extra,
    } as Parameters<typeof qualifyRestore>[0];
}

describe("extension state snapshot restore qualification", () => {
    test("restored worlds continue identically without pre-snapshot replay", () => {
        const result = qualifyRestore(sliceOptions());
        expect(result.firstDivergence).toBeUndefined();
        expect(result.passed).toBe(true);
        expect(result.checkpointsCompared).toBeGreaterThan(0);
    });

    test("restored worlds with live AttachEffects continue identically", () => {
        const definition = parseAresAttachEffectDefinition(
            new IniFile("[FX]\nDuration=30\n").getSection("FX")!,
        );
        expect(definition).toBeDefined();

        const result = qualifyRestore(sliceOptions({
            attachEffectDefinition: definition!,
            attachAutomaticEffectId: "qual-fx",
        }));
        expect(result.firstDivergence).toBeUndefined();
        expect(result.passed).toBe(true);
    });

    test("object tech level overrides restore into an identical game hash", () => {
        const source = createQualifiedWorld({ seed: 19, objectCount: 2 });
        const sourceRules = objectTechLevelRules();
        source.game.rules = sourceRules;
        sourceRules.setObjectTechLevelOverride("E1", 0);
        const snapshot = JSON.parse(JSON.stringify(captureExtensionState(source.game)));

        const target = createQualifiedWorld({ seed: 19, objectCount: 2 });
        target.game.rules = objectTechLevelRules();
        restoreExtensionState(target.game, snapshot, { strict: true });

        expect(target.game.getHash()).toBe(source.game.getHash());
        sourceRules.setObjectTechLevelOverride("E1", 1);
        expect(target.game.getHash()).not.toBe(source.game.getHash());
    });

    test("strict restore refuses snapshots with unresolved references", () => {
        const source = createQualifiedWorld({ seed: 7, objectCount: 4 });
        const snapshot = captureExtensionState(source.game) as any;
        snapshot.attachEffects.push({ objectId: 999, state: {} });
        const target = createQualifiedWorld({ seed: 7, objectCount: 4 });
        expect(() => restoreExtensionState(target.game, snapshot, { strict: true })).toThrow(/unresolved/i);
    });
});
