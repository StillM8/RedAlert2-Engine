import { describe, expect, test } from "bun:test";
import {
    resolveAresDamageParticleSelection,
    type AresDamageParticleRules,
} from "@/extensions/ares/AresDamageParticles";

const baseSystems = [
    { id: "SmokeBase", behavesLike: "Smoke" },
    { id: "SparkBase", behavesLike: "Spark" },
    { id: "GasBase", behavesLike: "Gas" },
];

function rules(overrides: Partial<AresDamageParticleRules> = {}): AresDamageParticleRules {
    return {
        isInfantry: true,
        cyborg: true,
        damageParticleSystems: baseSystems,
        ...overrides,
    };
}

describe("Ares damage-particle selection", () => {
    test("prefers explicit Ares lists without BehavesLike filtering", () => {
        const input = rules({
            damageSmokeParticleSystems: [{ id: "GasOverride", behavesLike: "Gas" }],
            damageSparksParticleSystems: ["SmokeOverride"],
            damageSparks: false,
        });
        const before = structuredClone(input);

        expect(resolveAresDamageParticleSelection(input)).toEqual({
            damageSparksEnabled: false,
            damageSmokeParticleSystems: [{ id: "GasOverride", behavesLike: "Gas" }],
            damageSparksParticleSystems: [{ id: "SmokeOverride" }],
        });
        expect(input).toEqual(before);
    });

    test("filters DamageParticleSystems by Smoke and Spark when overrides are absent", () => {
        expect(resolveAresDamageParticleSelection(rules())).toEqual({
            damageSparksEnabled: true,
            damageSmokeParticleSystems: [{ id: "SmokeBase", behavesLike: "Smoke" }],
            damageSparksParticleSystems: [{ id: "SparkBase", behavesLike: "Spark" }],
        });
        expect(resolveAresDamageParticleSelection(rules({ isInfantry: false, cyborg: true }))
            .damageSparksEnabled).toBe(false);
    });

    test("keeps authored empty overrides and explicit DamageSparks values", () => {
        const input = rules({
            damageSmokeParticleSystems: [],
            damageSparksParticleSystems: [],
            damageSparks: true,
        });
        const before = structuredClone(input);

        expect(resolveAresDamageParticleSelection(input)).toEqual({
            damageSparksEnabled: true,
            damageSmokeParticleSystems: [],
            damageSparksParticleSystems: [],
        });
        expect(input).toEqual(before);
    });
});
