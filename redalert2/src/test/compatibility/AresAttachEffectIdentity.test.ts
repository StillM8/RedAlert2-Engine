import { describe, expect, test } from "bun:test";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";

function definition(overrides: Partial<AresAttachEffectDefinition> = {}): AresAttachEffectDefinition {
    return {
        duration: 10,
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
        ...overrides,
    };
}

describe("Ares AttachEffect identity audit", () => {
    test("reproduces the shared automatic/warhead effect-id namespace", () => {
        const trait = new AresAttachEffectTrait({
            automaticEffect: { effectId: "SharedSource", definition: definition() },
        });
        trait.apply("SharedSource", definition({ armorMultiplier: 0.5 }), {
            origin: { kind: "techno", ownerName: "SharedSource" },
        });

        const result = trait.apply("SharedSource", definition({ armorMultiplier: 0.75 }), {
            origin: { kind: "warhead", ownerName: "SharedSource" },
        });

        // Automatic and warhead origins currently share the authored source
        // name as their effect key. This is a reproduced aliasing behavior,
        // not silently redefined here without Ares/Antares reference proof.
        expect(result.decision).toBe("reapplied");
        expect(trait.getState()).toHaveLength(1);
        expect(trait.serializeState().origins).toEqual([{
            effectId: "SharedSource",
            kind: "warhead",
            ownerName: "SharedSource",
        }]);
    });

    test("non-cumulative reapplication preserves residual attribution", () => {
        const original = { name: "Same", playerListIndex: 0 };
        const latest = { name: "Same", playerListIndex: 1 };
        const trait = new AresAttachEffectTrait({
            getPlayerIndex: player => player === original ? 0 : player === latest ? 1 : undefined,
        });
        trait.apply("Burn", definition({ animation: "BurnAnim" }), { sourcePlayer: original });
        trait.apply("Burn", definition({ animation: "BurnAnim" }), { sourcePlayer: latest });

        // The current runtime intentionally carries the previous animation
        // state through a refresh. Reference behavior for cross-player
        // reapplication remains an evidence item, so this test prevents an
        // accidental semantic change while the question is unresolved.
        expect(trait.serializeState().animationDamage?.[0]?.sourcePlayerIndex).toBe(0);
    });
});
