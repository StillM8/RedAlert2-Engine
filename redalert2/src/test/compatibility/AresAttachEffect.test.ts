import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { parseAresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";

describe("Ares AttachEffect normalization", () => {
    test("uses the documented defaults for an empty definition", () => {
        expect(parseAresAttachEffectDefinition(new IniSection("Empty"))).toEqual({
            animation: undefined,
            duration: 0,
            speedMultiplier: 1,
            armorMultiplier: 1,
            firepowerMultiplier: 1,
            rofMultiplier: 1,
            cloakable: false,
            forceDecloak: false,
            discardOnEntry: false,
            penetratesIronCurtain: false,
            delay: 0,
            initialDelay: 0,
            cumulative: false,
            animResetOnReapply: false,
            temporalHidesAnim: false,
            extensionEntries: new Map(),
        });
    });

    test("normalizes the generic fields case-insensitively", () => {
        const section = new IniSection("GenericEffect");
        section.set("attacheffect.animation", " StatusEffectAnim ");
        section.set("ATTACHEFFECT.DURATION", "-1");
        section.set("AttachEffect.SpeedMultiplier", "75%");
        section.set("AttachEffect.ArmorMultiplier", "1.25");
        section.set("AttachEffect.FirepowerMultiplier", "1.5");
        section.set("AttachEffect.ROFMultiplier", "0.5");
        section.set("AttachEffect.Cloakable", "yes");
        section.set("AttachEffect.ForceDecloak", "true");
        section.set("AttachEffect.DiscardOnEntry", "1");
        section.set("AttachEffect.PenetratesIronCurtain", "on");
        section.set("AttachEffect.TemporalHidesAnim", "y");

        expect(parseAresAttachEffectDefinition(section)).toMatchObject({
            animation: "StatusEffectAnim",
            duration: -1,
            speedMultiplier: 0.75,
            armorMultiplier: 1.25,
            firepowerMultiplier: 1.5,
            rofMultiplier: 0.5,
            cloakable: true,
            forceDecloak: true,
            discardOnEntry: true,
            penetratesIronCurtain: true,
            temporalHidesAnim: true,
        });
    });

    test("normalizes TechnoType timing and Warhead stacking fields", () => {
        const section = new IniSection("ScopedEffect");
        section.set("AttachEffect.Delay", "-4");
        section.set("AttachEffect.InitialDelay", "12");
        section.set("AttachEffect.Cumulative", "true");
        section.set("AttachEffect.AnimResetOnReapply", "false");

        expect(parseAresAttachEffectDefinition(section)).toMatchObject({
            delay: -4,
            initialDelay: 12,
            cumulative: true,
            animResetOnReapply: false,
        });
    });

    test("retains raw AttachEffect provenance, including future fields", () => {
        const section = new IniSection("Provenance");
        section.set("AttachEffect.Duration", "120");
        section.set("AttachEffect.FutureField", ["first", "second"]);
        section.set("Unrelated", "not retained");

        const result = parseAresAttachEffectDefinition(section);

        expect(result.extensionEntries).toEqual(new Map([
            ["AttachEffect.Duration", "120"],
            ["AttachEffect.FutureField", ["first", "second"]],
        ]));
        expect(result.extensionEntries.get("AttachEffect.FutureField")).not.toBe(section.get("AttachEffect.FutureField"));
    });

    test("falls back safely for malformed values without throwing", () => {
        const section = new IniSection("Malformed");
        section.set("AttachEffect.Animation", "   ");
        section.set("AttachEffect.Duration", "1.5");
        section.set("AttachEffect.SpeedMultiplier", "NaN");
        section.set("AttachEffect.ArmorMultiplier", "Infinity");
        section.set("AttachEffect.Cloakable", "sometimes");
        section.set("AttachEffect.Delay", ["1", "2"]);
        section.set("AttachEffect.InitialDelay", "not-an-integer");
        section.set("AttachEffect.Cumulative", "maybe");

        expect(() => parseAresAttachEffectDefinition(section)).not.toThrow();
        expect(parseAresAttachEffectDefinition(section)).toMatchObject({
            animation: undefined,
            duration: 0,
            speedMultiplier: 1,
            armorMultiplier: 1,
            cloakable: false,
            delay: 0,
            initialDelay: 0,
            cumulative: false,
        });
    });
});
