import { describe, expect, test } from "bun:test";
import {
    serializeAresAttachEffectExtensionState,
} from "@/extensions/ares/AresAttachEffectState";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";

/**
 * Deterministic-restore certification for AttachEffect extension state.
 *
 * These tests assert GAMEPLAY EQUIVALENCE, not merely hash equality: a
 * restored trait must produce the same aggregate modifiers, the same damage
 * attribution, and the same hashes as the live trait it was captured from.
 * Hash equality alone is insufficient evidence because a hash that is blind
 * to lost state will happily match while gameplay diverges.
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

const sovietPlayer = { name: "Soviet", id: 1 };
const alliedPlayer = { name: "Allied", id: 2 };

function resolvePlayer(name: string): unknown {
    return [sovietPlayer, alliedPlayer].find(player => player.name === name);
}

describe("Ares AttachEffect deterministic restore", () => {
    test("restored trait keeps aggregate modifiers via definition rebinding", () => {
        const live = new AresAttachEffectTrait();
        live.apply("armor", definition({ armorMultiplier: 0.75 }), {
            origin: { kind: "warhead", ownerName: "RadBeam" },
        });
        live.apply("firepower", definition({ firepowerMultiplier: 1.4 }), {
            origin: { kind: "warhead", ownerName: "RageBeam" },
        });
        const snapshot = live.serializeState();

        // Restore with the production-style resolver backed by rules data.
        const restored = new AresAttachEffectTrait();
        restored.restoreState(snapshot, {
            resolveDefinition: (kind, ownerName) => {
                if (kind === "warhead" && ownerName === "RadBeam") return definition({ armorMultiplier: 0.75 });
                if (kind === "warhead" && ownerName === "RageBeam") return definition({ firepowerMultiplier: 1.4 });
                return undefined;
            },
        });

        // Gameplay equivalence, not just hash equality.
        expect(restored.getAggregateMultipliers()).toEqual(live.getAggregateMultipliers());
        expect(restored.getAggregateMultipliers().armor).toBeCloseTo(0.75, 10);
        expect(restored.getAggregateMultipliers().firepower).toBeCloseTo(1.4, 10);
        expect(restored.getHash()).toBe(live.getHash());
    });

    test("an unresolvable origin leaves the effect present but inert", () => {
        const live = new AresAttachEffectTrait();
        live.apply("armor", definition({ armorMultiplier: 0.5 }), {
            origin: { kind: "warhead", ownerName: "RemovedWarhead" },
        });
        const snapshot = live.serializeState();

        const restored = new AresAttachEffectTrait();
        restored.restoreState(snapshot, { resolveDefinition: () => undefined });

        // The instance survives (matching a live trait whose effect was
        // applied but whose definition source disappeared), but contributes
        // no modifier — identical to a live trait with no definition.
        expect(restored.getState()).toHaveLength(1);
        const inert = new AresAttachEffectTrait();
        expect(restored.getAggregateMultipliers()).toEqual(inert.getAggregateMultipliers());
    });

    test("pending animation damage keeps its attacker attribution after restore", () => {
        const live = new AresAttachEffectTrait();
        live.apply("burn", definition({ duration: -1 }), {
            sourcePlayer: sovietPlayer,
            origin: { kind: "warhead", ownerName: "FireWall" },
        });
        // Force a non-zero accumulator so the damage entry serializes.
        const snapshotState = serializeAresAttachEffectExtensionState({
            instances: [{ effectId: "burn", remainingFrames: -1, discardOnEntry: false }],
            automaticPhase: "inactive",
            automaticRemainingDelay: 0,
            animationDamage: [{
                effectId: "burn",
                occurrence: 0,
                accumulator: 3.5,
                frameAccumulator: 0.25,
                sourcePlayerName: "Soviet",
            }],
            origins: [{ effectId: "burn", kind: "warhead", ownerName: "FireWall" }],
        });

        const restored = new AresAttachEffectTrait();
        restored.restoreState(snapshotState, {
            resolvePlayer,
            resolveDefinition: () => definition({ duration: -1 }),
        });

        // The restored runtime state must carry the LIVE Soviet player object,
        // not undefined (which would fall back to the victim's own house).
        const states = (restored as any).animationDamageState.get("burn");
        expect(states?.[0]?.sourcePlayer).toBe(sovietPlayer);
        expect(states?.[0]?.accumulator).toBeCloseTo(3.5, 10);

        // Re-snapshotting preserves both the value and the stable name.
        expect(restored.serializeState().animationDamage?.[0]?.sourcePlayerName).toBe("Soviet");
    });

    test("restored and live traits advance with identical state across expiry/renewal", () => {
        const automaticDefinition = definition({ duration: 10, delay: 3 });
        const live = new AresAttachEffectTrait({
            automaticEffect: { effectId: "aura", definition: automaticDefinition },
        });
        live.apply("aura", automaticDefinition, {
            origin: { kind: "techno", ownerName: "AuraUnit" },
        });
        const snapshot = live.serializeState();

        const restored = new AresAttachEffectTrait({
            automaticEffect: { effectId: "aura", definition: automaticDefinition },
        });
        restored.restoreState(snapshot, {
            resolveDefinition: () => automaticDefinition,
        });

        for (let tick = 0; tick < 25; tick++) {
            live.advanceTick();
            restored.advanceTick();
            expect(restored.getHash()).toBe(live.getHash());
            // Modifiers must also stay equivalent at every tick.
            expect(restored.getAggregateMultipliers()).toEqual(live.getAggregateMultipliers());
        }
        expect(restored.serializeState()).toEqual(live.serializeState());
    });

    test("hash distinguishes different effects with identical durations", () => {
        const armorTrait = new AresAttachEffectTrait();
        armorTrait.apply("armor", definition(), { origin: { kind: "techno", ownerName: "X" } });
        const fireTrait = new AresAttachEffectTrait();
        fireTrait.apply("firepower", definition(), { origin: { kind: "techno", ownerName: "Y" } });
        expect(armorTrait.getHash()).not.toBe(fireTrait.getHash());
    });

    test("hash distinguishes phases of equal string length", () => {
        const build = (phase: string, delay: number): AresAttachEffectTrait => {
            const trait = new AresAttachEffectTrait();
            (trait as any).automaticPhase = phase;
            (trait as any).automaticRemainingDelay = delay;
            return trait;
        };
        expect(build("waiting-initial", 4).getHash())
            .not.toBe(build("waiting-renewal", 4).getHash());
        expect(build("inactive", 0).getHash())
            .not.toBe(build("disabled", 0).getHash());
    });

    test("hash distinguishes hold-vs-queue boundary in transport state", () => {
        // Covered in TransportTrait terms by AresPassengerLivePath; here we
        // assert the AttachEffect instance-count separator directly.
        const oneApplied = new AresAttachEffectTrait();
        oneApplied.apply("a", definition(), {});
        const twoApplied = new AresAttachEffectTrait();
        twoApplied.apply("a", definition(), {});
        twoApplied.apply("b", definition(), {});
        expect(oneApplied.getHash()).not.toBe(twoApplied.getHash());
    });

    test("hash diverges when restored damage attribution differs", () => {
        const make = (attacker: string | undefined): AresAttachEffectTrait => {
            const trait = new AresAttachEffectTrait();
            trait.restoreState({
                version: 1,
                instances: [{ effectId: "burn", remainingFrames: -1, discardOnEntry: false }],
                automaticPhase: "inactive",
                automaticRemainingDelay: 0,
                animationDamage: [{
                    effectId: "burn",
                    occurrence: 0,
                    accumulator: 2,
                    frameAccumulator: 0,
                    ...(attacker ? { sourcePlayerName: attacker } : {}),
                }],
                origins: [],
            }, { resolvePlayer });
            return trait;
        };
        expect(make("Soviet").getHash()).not.toBe(make("Allied").getHash());
        expect(make("Soviet").getHash()).not.toBe(make(undefined).getHash());
    });

    test("codec rejects duplicate damage entries and duplicate origins transactionally", () => {
        const base = {
            version: 1 as const,
            instances: [
                { effectId: "burn", remainingFrames: 30, discardOnEntry: false },
                { effectId: "burn", remainingFrames: 30, discardOnEntry: false },
            ],
            automaticPhase: "active" as const,
            automaticRemainingDelay: 0,
            animationDamage: [
                { effectId: "burn", occurrence: 0, accumulator: 1, frameAccumulator: 0 },
                { effectId: "burn", occurrence: 0, accumulator: 2, frameAccumulator: 0 },
            ],
            origins: [
                { effectId: "burn", kind: "warhead" as const, ownerName: "W" },
                { effectId: "burn", kind: "warhead" as const, ownerName: "W2" },
            ],
        };

        const trait = new AresAttachEffectTrait();
        const before = trait.serializeState();
        expect(() => trait.restoreState(base)).toThrow(/duplicate/);
        // Transactional: failed restore leaves the prior state untouched.
        expect(trait.serializeState()).toEqual(before);
    });
});
