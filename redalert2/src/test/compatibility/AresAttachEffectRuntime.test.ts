import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { parseAresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import {
    advanceAresAttachEffects,
    advanceAresAttachEffectsInPlace,
    applyAresAttachEffect,
    discardAresAttachEffectsOnEntry,
    type AresAttachEffectInstance,
} from "@/extensions/ares/AresAttachEffectRuntime";

function definition(values: Record<string, string> = {}) {
    const section = new IniSection("RuntimeEffect");
    for (const [key, value] of Object.entries(values)) section.set(key, value);
    return parseAresAttachEffectDefinition(section);
}

describe("Ares AttachEffect runtime-ready state model", () => {
    test("applies finite effects with documented default state and expires per tick", () => {
        const result = applyAresAttachEffect(definition({
            "AttachEffect.Duration": "2",
        }), "effect-a");

        expect(result).toMatchObject({
            decision: "applied",
            forceDecloak: false,
            resetAnimation: false,
            instances: [{ effectId: "effect-a", remainingFrames: 2, discardOnEntry: false }],
        });

        const afterFirstTick = advanceAresAttachEffects(result.instances);
        expect(afterFirstTick).toEqual({
            instances: [{ effectId: "effect-a", remainingFrames: 1, discardOnEntry: false }],
            expiredEffectIds: [],
        });

        expect(advanceAresAttachEffects(afterFirstTick.instances)).toEqual({
            instances: [],
            expiredEffectIds: ["effect-a"],
        });
    });

    test("refreshes one non-cumulative instance and requests animation reset only when documented", () => {
        const initial = applyAresAttachEffect(definition({
            "AttachEffect.Duration": "3",
            "AttachEffect.Animation": "EffectAnim",
        }), "effect-a");
        const reapplied = applyAresAttachEffect(definition({
            "AttachEffect.Duration": "5",
            "AttachEffect.Animation": "EffectAnim",
            "AttachEffect.AnimResetOnReapply": "yes",
            "AttachEffect.ForceDecloak": "yes",
        }), "effect-a", initial.instances);

        expect(reapplied).toMatchObject({
            decision: "reapplied",
            forceDecloak: true,
            resetAnimation: true,
            instances: [{ effectId: "effect-a", remainingFrames: 5, discardOnEntry: false }],
        });
    });

    test("stacks cumulative instances and keeps their expiry independent", () => {
        const stackDefinition = definition({
            "AttachEffect.Duration": "1",
            "AttachEffect.Cumulative": "true",
        });
        const first = applyAresAttachEffect(stackDefinition, "effect-a");
        const second = applyAresAttachEffect(stackDefinition, "effect-a", first.instances);

        expect(second.decision).toBe("stacked");
        expect(second.instances).toHaveLength(2);
        expect(advanceAresAttachEffects(second.instances)).toEqual({
            instances: [],
            expiredEffectIds: ["effect-a", "effect-a"],
        });
    });

    test("blocks protected targets unless the definition penetrates Iron Curtain or Force Shield", () => {
        const blocked = applyAresAttachEffect(definition({
            "AttachEffect.Duration": "10",
        }), "effect-a", [], { protectedByIronCurtainOrForceShield: true });
        expect(blocked).toMatchObject({
            decision: "blocked-by-protection",
            instances: [],
            forceDecloak: false,
            resetAnimation: false,
        });

        const allowed = applyAresAttachEffect(definition({
            "AttachEffect.Duration": "10",
            "AttachEffect.PenetratesIronCurtain": "yes",
        }), "effect-a", [], { protectedByIronCurtainOrForceShield: true });
        expect(allowed.decision).toBe("applied");
        expect(allowed.instances).toHaveLength(1);
    });

    test("does not create active state for the documented zero-duration default", () => {
        const result = applyAresAttachEffect(definition(), "effect-a");
        expect(result).toEqual({
            decision: "ignored-zero-duration",
            instances: [],
            forceDecloak: false,
            resetAnimation: false,
        });
    });

    test("keeps infinite effects active and discards only marked effects on entry", () => {
        const instances: AresAttachEffectInstance[] = [
            { effectId: "infinite", remainingFrames: -1, discardOnEntry: true },
            { effectId: "finite", remainingFrames: 2, discardOnEntry: false },
            { effectId: "stacked", remainingFrames: 4, discardOnEntry: true },
        ];

        expect(advanceAresAttachEffects(instances)).toEqual({
            instances: [
                { effectId: "infinite", remainingFrames: -1, discardOnEntry: true },
                { effectId: "finite", remainingFrames: 1, discardOnEntry: false },
                { effectId: "stacked", remainingFrames: 3, discardOnEntry: true },
            ],
            expiredEffectIds: [],
        });
        expect(discardAresAttachEffectsOnEntry(instances)).toEqual({
            instances: [{ effectId: "finite", remainingFrames: 2, discardOnEntry: false }],
            removedEffectIds: ["infinite", "stacked"],
        });
    });

    test("compacts mutable trait state in authored order without changing pure semantics", () => {
        const instances: AresAttachEffectInstance[] = [
            { effectId: "first", remainingFrames: 1, discardOnEntry: false },
            { effectId: "infinite", remainingFrames: -1, discardOnEntry: false },
            { effectId: "last", remainingFrames: 3, discardOnEntry: true },
        ];

        const sameArray = instances;
        expect(advanceAresAttachEffectsInPlace(instances)).toEqual(["first"]);
        expect(instances).toBe(sameArray);
        expect(instances).toEqual([
            { effectId: "infinite", remainingFrames: -1, discardOnEntry: false },
            { effectId: "last", remainingFrames: 2, discardOnEntry: true },
        ]);
    });
});
