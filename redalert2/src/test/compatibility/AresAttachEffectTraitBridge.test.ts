import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { parseAresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";

function definition(values: Record<string, string> = {}) {
    const section = new IniSection("GenericEffect");
    for (const [key, value] of Object.entries(values)) section.set(key, value);
    return parseAresAttachEffectDefinition(section);
}

describe("AresAttachEffectTrait gameplay bridge", () => {
    test("delegates apply state and aggregates active modifiers multiplicatively", () => {
        const trait = new AresAttachEffectTrait();
        const first = definition({
            "AttachEffect.Duration": "3",
            "AttachEffect.SpeedMultiplier": "0.8",
            "AttachEffect.ArmorMultiplier": "1.25",
            "AttachEffect.FirepowerMultiplier": "1.5",
            "AttachEffect.ROFMultiplier": "0.5",
        });
        const second = definition({
            "AttachEffect.Duration": "2",
            "AttachEffect.SpeedMultiplier": "1.2",
            "AttachEffect.ArmorMultiplier": "0.8",
            "AttachEffect.FirepowerMultiplier": "0.75",
            "AttachEffect.ROFMultiplier": "2",
        });

        expect(trait.apply("effect-a", first).decision).toBe("applied");
        expect(trait.apply("effect-b", second).decision).toBe("applied");
        expect(trait.getState()).toEqual([
            { effectId: "effect-a", remainingFrames: 3, discardOnEntry: false },
            { effectId: "effect-b", remainingFrames: 2, discardOnEntry: false },
        ]);
        expect(trait.getAggregateMultipliers()).toEqual({
            speed: 0.96,
            armor: 1,
            firepower: 1.125,
            rof: 1,
        });
    });

    test("exposes reapply decisions and keeps the aggregate current after expiry", () => {
        const trait = new AresAttachEffectTrait();
        const initial = definition({
            "AttachEffect.Duration": "1",
            "AttachEffect.Animation": "EffectAnim",
            "AttachEffect.SpeedMultiplier": "0.5",
        });
        const refreshed = definition({
            "AttachEffect.Duration": "2",
            "AttachEffect.Animation": "EffectAnim",
            "AttachEffect.AnimResetOnReapply": "yes",
            "AttachEffect.ForceDecloak": "yes",
            "AttachEffect.SpeedMultiplier": "0.25",
        });

        trait.apply("effect-a", initial);
        expect(trait.apply("effect-a", refreshed)).toMatchObject({
            decision: "reapplied",
            forceDecloak: true,
            resetAnimation: true,
            instances: [{ effectId: "effect-a", remainingFrames: 2, discardOnEntry: false }],
        });
        expect(trait.getAggregateMultipliers().speed).toBe(0.25);

        expect(trait.advance()).toMatchObject({
            instances: [{ effectId: "effect-a", remainingFrames: 1, discardOnEntry: false }],
            expiredEffectIds: [],
        });
        expect(trait.advance()).toEqual({
            instances: [],
            expiredEffectIds: ["effect-a"],
        });
        expect(trait.getAggregateMultipliers()).toEqual({
            speed: 1,
            armor: 1,
            firepower: 1,
            rof: 1,
        });
    });

    test("delegates protection decisions and discards only marked instances on entry", () => {
        const trait = new AresAttachEffectTrait();
        const blocked = definition({ "AttachEffect.Duration": "5" });
        const penetrating = definition({
            "AttachEffect.Duration": "5",
            "AttachEffect.PenetratesIronCurtain": "yes",
            "AttachEffect.DiscardOnEntry": "yes",
        });
        const retained = definition({ "AttachEffect.Duration": "5" });

        expect(trait.apply("blocked", blocked, {
            protectedByIronCurtainOrForceShield: true,
        }).decision).toBe("blocked-by-protection");
        expect(trait.apply("penetrating", penetrating, {
            protectedByIronCurtainOrForceShield: true,
        }).decision).toBe("applied");
        expect(trait.apply("retained", retained).decision).toBe("applied");

        expect(trait.discardOnEntry()).toEqual({
            instances: [{ effectId: "retained", remainingFrames: 5, discardOnEntry: false }],
            removedEffectIds: ["penetrating"],
        });
    });

    test("is ready for later ObjectFactory registration through NotifyTick", () => {
        const trait = new AresAttachEffectTrait();
        trait.apply("effect-a", definition({ "AttachEffect.Duration": "1" }));

        trait[NotifyTick.onTick]();

        expect(trait.getState()).toEqual([]);
    });
});
