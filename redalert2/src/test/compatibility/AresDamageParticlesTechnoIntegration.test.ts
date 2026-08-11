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

    test("reads mixed-case DamageSparks without falling back to the Cyborg default", () => {
        const section = new IniSection("MixedCaseDamageSparks");
        section.set("Cyborg", "yes");
        section.set("DamageSparks", "yes");
        section.set("dAmAgEsPaRkS", "no");

        const rules = new TechnoRules(ObjectType.Infantry, section, 0, {}, new ArmorRegistry());
        expect(rules.aresDamageParticles?.damageSparksEnabled).toBe(false);
    });

    test("reads mixed-case DamageSmokeParticleSystems overrides", () => {
        const section = new IniSection("MixedCaseDamageSmoke");
        section.set("DamageParticleSystems", "SmokeBase");
        section.set("dAmAgEsMoKePaRtIcLeSyStEmS", "SmokeOverride");

        const rules = new TechnoRules(ObjectType.Vehicle, section, 0, {}, new ArmorRegistry());
        expect(rules.aresDamageParticles?.damageSmokeParticleSystems).toEqual([
            { id: "SmokeOverride" },
        ]);
    });

    test("preserves mixed-case explicit empty Ares lists", () => {
        const section = new IniSection("MixedCaseEmptyDamageLists");
        section.set("DamageParticleSystems", "SmokeBase,SparkBase");
        section.set("dAmAgEsMoKePaRtIcLeSyStEmS", "");
        section.set("dAmAgEsPaRkSpArTiClEsYsTeMs", "");

        const rules = new TechnoRules(ObjectType.Vehicle, section, 0, {}, new ArmorRegistry());
        expect(rules.aresDamageParticles?.damageSmokeParticleSystems).toEqual([]);
        expect(rules.aresDamageParticles?.damageSparksParticleSystems).toEqual([]);
    });
});
