import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { ProjectileRules } from "@/game/rules/ProjectileRules";
import { TechnoRules } from "@/game/rules/TechnoRules";

function techno(section: IniSection): TechnoRules {
    return new TechnoRules(ObjectType.Building, section, 0, {}, new ArmorRegistry());
}

describe("Ares TechnoRules integration", () => {
    test("exposes optional Urban Combat and AttachEffect data without changing vanilla sections", () => {
        const section = new IniSection("AresBuilding");
        section.set("UC.PassThrough", "50%");
        section.set("Bunker.Raidable", "yes");
        section.set("CanBeOccupiedBy", "Conscript,Engineer");
        section.set("AttachEffect.Animation", "MOEffect");
        section.set("AttachEffect.Duration", "120");
        section.set("AttachEffect.InitialDelay", "8");

        const rules = techno(section);
        expect(rules.aresUrbanCombat).toMatchObject({
            passThrough: 0.5,
            bunkerRaidable: true,
            canBeOccupiedBy: ["Conscript", "Engineer"],
        });
        expect(rules.aresAttachEffect).toMatchObject({
            animation: "MOEffect",
            duration: 120,
            initialDelay: 8,
        });

        const vanilla = techno(new IniSection("VanillaBuilding"));
        expect(vanilla.aresUrbanCombat).toBeUndefined();
        expect(vanilla.aresAttachEffect).toBeUndefined();
    });

    test("uses the documented SubjectToTrenches default and explicit override", () => {
        const defaultRules = new ProjectileRules(ObjectType.Projectile, new IniSection("DefaultProjectile"));
        const explicitSection = new IniSection("TrenchImmuneProjectile");
        explicitSection.set("SubjectToTrenches", "no");
        const explicitRules = new ProjectileRules(ObjectType.Projectile, explicitSection);

        expect(defaultRules.subjectToTrenches).toBe(true);
        expect(explicitRules.subjectToTrenches).toBe(false);
    });

    test("defaults Ares designator and inhibitor ranges to Sight", () => {
        const section = new IniSection("RangeBuilding");
        section.set("Sight", "5");
        const defaultRules = techno(section);
        expect(defaultRules.designatorRange).toBe(5);
        expect(defaultRules.inhibitorRange).toBe(5);

        section.set("DesignatorRange", "9");
        section.set("InhibitorRange", "2");
        const explicitRules = techno(section);
        expect(explicitRules.designatorRange).toBe(9);
        expect(explicitRules.inhibitorRange).toBe(2);
    });
});
