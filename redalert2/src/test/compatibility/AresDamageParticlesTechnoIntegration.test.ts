import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { IniSection } from "@/data/IniSection";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { TechnoRules } from "@/game/rules/TechnoRules";

describe("Ares damage-particle TechnoRules integration", () => {
    test("resolves explicit Ares lists without changing the vanilla no-field path", () => {
        const section = new IniSection("AresCyborg");
        section.set("Cyborg", "yes");
        section.set("DamageParticleSystems", "SmokeBase,SparkBase");
        section.set("DamageSmokeParticleSystems", "SmokeOverride");
        section.set("DamageSparksParticleSystems", "SparkOverride");
        section.set("DamageSparks", "yes");

        const rules = new TechnoRules(ObjectType.Infantry, section, 0, {}, new ArmorRegistry());
        expect(rules.aresDamageParticles).toMatchObject({
            damageSparksEnabled: true,
            damageSmokeParticleSystems: [{ id: "SmokeOverride" }],
            damageSparksParticleSystems: [{ id: "SparkOverride" }],
        });

        const vanilla = new TechnoRules(
            ObjectType.Vehicle,
            new IniSection("VanillaVehicle"),
            0,
            {},
            new ArmorRegistry(),
        );
        expect(vanilla.aresDamageParticles).toBeUndefined();
    });

    test("preserves vanilla smoke candidates when only DamageSparks is authored", () => {
        const section = new IniSection("Cyborg");
        section.set("Cyborg", "yes");
        section.set("DamageParticleSystems", "SmokeBase,SparkBase");
        section.set("DamageSparks", "yes");

        const rules = new TechnoRules(ObjectType.Infantry, section, 0, {}, new ArmorRegistry());
        expect(rules.aresDamageParticles?.damageSmokeParticleSystems).toEqual([
            { id: "SmokeBase" },
            { id: "SparkBase" },
        ]);
    });
});
