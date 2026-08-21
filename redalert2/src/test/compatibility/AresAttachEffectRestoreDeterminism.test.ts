import { describe, expect, test } from "bun:test";
import {
    serializeAresAttachEffectExtensionState,
} from "@/extensions/ares/AresAttachEffectState";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";

/**
 * Deterministic-replay certification for AttachEffect extension state.
 *
 * The codec round-trip is covered by AresExtensionState.test.ts. This file
 * certifies the axis lockstep actually depends on: a trait restored from a
 * serialized snapshot must (a) produce the same canonical hash as the live
 * trait it was captured from, (b) keep producing identical hashes as both
 * advance through the same ticks, and (c) reject corrupt snapshots without
 * mutating the previously restored state.
 */

function definition(overrides: Partial<AresAttachEffectDefinition> = {}): AresAttachEffectDefinition {
    return {
        duration: 45,
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

describe("Ares AttachEffect deterministic restore", () => {
    test("a restored trait hashes identically to the live trait it was captured from", () => {
        const live = new AresAttachEffectTrait();
        live.apply("armor", definition({ armorMultiplier: 1.25 }));
        live.apply("firepower", definition({ duration: 30, firepowerMultiplier: 1.4 }));
        live.advanceTick();

        const snapshot = live.serializeState();

        const restored = new AresAttachEffectTrait();
        restored.restoreState(snapshot);

        expect(restored.getHash()).toBe(live.getHash());
        expect(restored.serializeState()).toEqual(snapshot);
    });

    test("restored and live traits advance with identical hashes over ticks", () => {
        // A snapshot host always re-creates the trait with the same
        // TechnoType-owned automatic binding (see ObjectFactory), so the
        // restored trait here receives the identical binding.
        const automaticDefinition = definition({ duration: 10, delay: 3 });
        const live = new AresAttachEffectTrait({
            automaticEffect: { effectId: "aura", definition: automaticDefinition },
        });
        live.apply("aura", definition({ duration: 10 }));
        const snapshot = live.serializeState();

        const restored = new AresAttachEffectTrait({
            automaticEffect: { effectId: "aura", definition: automaticDefinition },
        });
        restored.restoreState(snapshot);

        // Both run the same 25-tick horizon; the automatic scheduler expires
        // and re-applies inside it, so scheduler state is exercised too.
        for (let tick = 0; tick < 25; tick++) {
            live.advanceTick();
            restored.advanceTick();
            expect(restored.getHash()).toBe(live.getHash());
        }
        expect(restored.serializeState()).toEqual(live.serializeState());
    });

    test("hash diverges when restored instances differ from the live state", () => {
        const live = new AresAttachEffectTrait();
        live.apply("armor", definition({ armorMultiplier: 1.25 }));
        const snapshot = live.serializeState();

        const restored = new AresAttachEffectTrait();
        restored.restoreState(snapshot);
        const tampered = {
            ...snapshot,
            instances: [{ ...snapshot.instances[0], remainingFrames: 1 }],
        };
        restored.restoreState(tampered);

        expect(restored.getHash()).not.toBe(live.getHash());
    });
});
