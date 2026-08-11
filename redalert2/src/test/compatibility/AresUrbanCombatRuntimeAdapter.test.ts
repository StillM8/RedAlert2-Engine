import { describe, expect, test } from "bun:test";
import {
    canAresBunkerBeRaided,
    canAresUrbanCombatInfantryOccupy,
    getAresUrbanCombatPassThroughChance,
    resolveAresUrbanCombatHit,
} from "@/extensions/ares/AresUrbanCombatRuntime";

const building = {
    passThrough: 0.5,
    fatalRate: 0.25,
    damageMultiplier: 1.5,
    bunkerRaidable: true,
    canBeOccupiedBy: ["GI", "Conscript"],
};

const subjectProjectile = { subjectToTrenches: true };
const bypassProjectile = { subjectToTrenches: false };

describe("Ares Urban Combat runtime decision adapter", () => {
    test("applies occupants, SubjectToTrenches, fatal chance, and damage multiplier", () => {
        expect(getAresUrbanCombatPassThroughChance(building, subjectProjectile, false)).toBe(0);
        expect(getAresUrbanCombatPassThroughChance(building, subjectProjectile, true)).toBe(0.5);
        expect(getAresUrbanCombatPassThroughChance(building, bypassProjectile, true)).toBe(1);

        expect(resolveAresUrbanCombatHit(building, subjectProjectile, {
            hasOccupants: false,
            passThroughRoll: 0,
            fatalRoll: 0,
            weaponDamage: 10,
        })).toEqual({ kind: "building", passThrough: false });

        expect(resolveAresUrbanCombatHit(building, subjectProjectile, {
            hasOccupants: true,
            passThroughRoll: 0.49,
            fatalRoll: 0.1,
            weaponDamage: 10,
        })).toEqual({ kind: "occupant-fatal", passThrough: true });

        expect(resolveAresUrbanCombatHit(building, subjectProjectile, {
            hasOccupants: true,
            passThroughRoll: 0.49,
            fatalRoll: 0.25,
            weaponDamage: 10,
        })).toEqual({ kind: "occupant-damage", passThrough: true, damage: 15 });

        expect(resolveAresUrbanCombatHit(building, bypassProjectile, {
            hasOccupants: true,
            passThroughRoll: 0.99,
            fatalRoll: 0.9,
            weaponDamage: 10,
        })).toEqual({ kind: "occupant-damage", passThrough: true, damage: 15 });
    });

    test("applies generic CanBeOccupiedBy and ownership/raidability gates", () => {
        const sameOwner = {
            buildingCanBeOccupied: true,
            infantryIsOccupier: true,
            buildingIsFull: false,
            buildingIsEmpty: false,
            sameOwner: true,
            buildingIsNeutral: false,
            infantryIsHostile: false,
        };
        expect(canAresUrbanCombatInfantryOccupy(building, "gi", sameOwner)).toBe(true);
        expect(canAresUrbanCombatInfantryOccupy(building, "Engineer", sameOwner)).toBe(false);

        const hostileEmpty = {
            ...sameOwner,
            sameOwner: false,
            buildingIsEmpty: true,
            infantryIsHostile: true,
        };
        expect(canAresBunkerBeRaided(building, hostileEmpty)).toBe(true);
        expect(canAresUrbanCombatInfantryOccupy(building, "Conscript", hostileEmpty)).toBe(true);

        expect(canAresUrbanCombatInfantryOccupy(building, "Conscript", {
            ...hostileEmpty,
            buildingIsEmpty: false,
        })).toBe(false);
        expect(canAresUrbanCombatInfantryOccupy(building, "Conscript", {
            ...hostileEmpty,
            infantryIsMindControlled: true,
        })).toBe(false);
    });

    test("allows neutral buildings and unrestricted occupant lists", () => {
        expect(canAresUrbanCombatInfantryOccupy({ ...building, canBeOccupiedBy: [] }, "anyInfantry", {
            buildingCanBeOccupied: true,
            infantryIsOccupier: true,
            buildingIsFull: false,
            buildingIsEmpty: false,
            sameOwner: false,
            buildingIsNeutral: true,
            infantryIsHostile: false,
        })).toBe(true);
    });
});
