import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import {
    parseAresUrbanCombatBuildingRules,
    parseAresUrbanCombatProjectileRules,
} from "@/extensions/ares/AresUrbanCombat";

describe("Ares Urban Combat normalization", () => {
    test("uses the documented defaults without runtime integration", () => {
        const building = parseAresUrbanCombatBuildingRules(new IniSection("EmptyBuilding"));
        const projectile = parseAresUrbanCombatProjectileRules(new IniSection("Projectile"));

        expect(building).toEqual({
            passThrough: 0,
            fatalRate: 0,
            damageMultiplier: 1,
            bunkerRaidable: false,
            isTrench: undefined,
            canBeOccupiedBy: [],
            rubbleDestroyed: undefined,
            rubbleIntact: undefined,
        });
        expect(projectile.subjectToTrenches).toBe(true);
    });

    test("normalizes Urban Combat, trench, occupant, and rubble fields", () => {
        const building = new IniSection("UrbanBuilding");
        building.set("UC.PassThrough", "25%");
        building.set("UC.FatalRate", "0.125");
        building.set("UC.DamageMultiplier", "150%");
        building.set("Bunker.Raidable", "ON");
        building.set("IsTrench", " AlliedModern ");
        building.set("CanBeOccupiedBy", "GI, Conscript, gi,  ,Conscript");
        building.set("Rubble.Destroyed", "TrenchRubble");
        building.set("Rubble.Destroyed.Remove", "no");
        building.set("Rubble.Destroyed.Owner", "SPECIAL");
        building.set("Rubble.Destroyed.Strength", "-25");
        building.set("Rubble.Destroyed.Anim", "CollapseAnim");
        building.set("Rubble.Intact", "TrenchBuilding");
        building.set("Rubble.Intact.Remove", "false");
        building.set("Rubble.Intact.Owner", "civilian");

        expect(parseAresUrbanCombatBuildingRules(building)).toEqual({
            passThrough: 0.25,
            fatalRate: 0.125,
            damageMultiplier: 1.5,
            bunkerRaidable: true,
            isTrench: "AlliedModern",
            canBeOccupiedBy: ["GI", "Conscript"],
            rubbleDestroyed: {
                target: "TrenchRubble",
                remove: false,
                owner: "special",
                strength: -25,
                animation: "CollapseAnim",
            },
            rubbleIntact: {
                target: "TrenchBuilding",
                remove: false,
                owner: "civilian",
                strength: -1,
                animation: undefined,
            },
        });
    });

    test("keeps malformed values safe and applies documented bounds/defaults", () => {
        const building = new IniSection("MalformedBuilding");
        building.set("UC.PassThrough", "not-a-number");
        building.set("UC.FatalRate", "250%");
        building.set("UC.DamageMultiplier", "-2");
        building.set("Bunker.Raidable", "maybe");
        building.set("CanBeOccupiedBy", ", ,");
        building.set("Rubble.Destroyed", "");
        building.set("Rubble.Destroyed.Owner", "unknown-owner");
        building.set("Rubble.Destroyed.Strength", "not-an-integer");

        expect(parseAresUrbanCombatBuildingRules(building)).toEqual({
            passThrough: 0,
            fatalRate: 1,
            damageMultiplier: 1,
            bunkerRaidable: false,
            isTrench: undefined,
            canBeOccupiedBy: [],
            rubbleDestroyed: {
                target: undefined,
                remove: false,
                owner: "default",
                strength: 0,
                animation: undefined,
            },
            rubbleIntact: undefined,
        });
    });

    test("honors case-insensitive projectile keys and boolean forms", () => {
        const projectile = new IniSection("Projectile");
        projectile.set("subjecttotrenches", "0");
        expect(parseAresUrbanCombatProjectileRules(projectile).subjectToTrenches).toBe(false);

        const malformedProjectile = new IniSection("MalformedProjectile");
        malformedProjectile.set("SUBJECTTOTRENCHES", "invalid");
        expect(parseAresUrbanCombatProjectileRules(malformedProjectile).subjectToTrenches).toBe(true);
    });
});
