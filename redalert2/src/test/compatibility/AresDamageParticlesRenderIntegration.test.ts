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

    test("resolves a parsed ParticleSystem image instead of hardcoding SGRYSMK1", () => {
        let animationName = "";
        let effectsAdded = 0;
        const plugin = new DamageSmokePlugin(
            {
                healthTrait: { health: 40 },
                isDestroyed: false,
                position: { worldPosition: new THREE.Vector3() },
                rules: { damageSmokeOffset: new THREE.Vector3() },
            },
            {
                hasObject: () => true,
                getAnimation: (name: string) => {
                    animationName = name;
                    return {
                        paletteType: "anim",
                        art: { getBool: () => false },
                    };
                },
            },
            { getPalette: () => ({}) },
            { findByObjectArt: () => ({}) },
            { value: 1 },
            [{
                id: "CustomSmokeSys",
                holdsWhat: "CustomSmoke",
                behavesLike: "Smoke",
                particleCap: 4,
                particle: { id: "CustomSmoke", image: "CUSTOMSMOKE" },
            }],
        );
        plugin.onCreate({ addEffect: () => { effectsAdded++; } });
        plugin.update(0);

        expect(animationName).toBe("CUSTOMSMOKE");
        expect(effectsAdded).toBe(1);
    });

    test("spawns authored spark systems independently from smoke candidates", () => {
        let effectsAdded = 0;
        const plugin = new DamageSmokePlugin(
            {
                healthTrait: { health: 40 },
                isDestroyed: false,
                position: { worldPosition: new THREE.Vector3() },
                rules: { damageSmokeOffset: new THREE.Vector3() },
            },
            { getAnimation: () => undefined },
            { getPalette: () => ({}) },
            { findByObjectArt: () => undefined },
            { value: 1 },
            [],
            0.5,
            [{
                id: "CustomSparkSys",
                holdsWhat: "CustomSpark",
                behavesLike: "Spark",
                particleCap: 6,
                spawnFrames: 2,
                particle: {
                    id: "CustomSpark",
                    minZVelocity: 40,
                    colorList: [[255, 128, 0]],
                },
            }],
            true,
        );
        plugin.onCreate({ addEffect: () => { effectsAdded++; } });
        plugin.update(0);

        expect(effectsAdded).toBe(1);
    });
});
