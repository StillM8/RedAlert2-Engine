import { describe, expect, test } from "bun:test";
import * as THREE from "three";

(globalThis as any).THREE = THREE;
(globalThis as any).window = globalThis;

const { getDamageSmokeParticleSystems } = await import("@/engine/renderable/entity/RenderableFactory");
const { DamageSmokePlugin } = await import("@/engine/renderable/entity/plugin/DamageSmokePlugin");

describe("Ares damage-particle render integration", () => {
    test("uses the pre-resolved Ares smoke selection when present", () => {
        const vanilla = ["VanillaSmoke"];
        const aresSmoke = [{ id: "CustomSmoke" }];

        expect(getDamageSmokeParticleSystems({
            damageParticleSystems: vanilla,
            aresDamageParticles: {
                damageSparksEnabled: true,
                damageSmokeParticleSystems: aresSmoke,
                damageSparksParticleSystems: [],
            },
        })).toEqual(aresSmoke);
    });

    test("keeps the vanilla list when no Ares selection is present", () => {
        const vanilla = ["VanillaSmoke"];
        expect(getDamageSmokeParticleSystems({ damageParticleSystems: vanilla })).toBe(vanilla);
    });

    test("treats an explicit empty Ares smoke selection as a no-op", () => {
        let animationLookups = 0;
        let effectsAdded = 0;
        const plugin = new DamageSmokePlugin(
            { healthTrait: { health: 10 }, isDestroyed: false },
            { getAnimation: () => { animationLookups++; return undefined; } },
            {},
            {},
            { value: 1 },
            [],
        );
        plugin.onCreate({ addEffect: () => { effectsAdded++; } });
        plugin.update(0);

        expect(animationLookups).toBe(0);
        expect(effectsAdded).toBe(0);
    });
});
