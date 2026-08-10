import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { createAresSuperWeaponTargetFilter } from "@/extensions/ares/AresSuperWeaponFilters";

function object(type: ObjectType, owner: any): any {
    return {
        owner,
        rules: { type },
        isUnit: () => type !== ObjectType.Building,
        isBuilding: () => type === ObjectType.Building,
        isInfantry: () => type === ObjectType.Infantry,
    };
}

describe("Ares superweapon target filters", () => {
    test("filters houses and land/building targets without legacy side assumptions", () => {
        const owner = { id: "owner" };
        const ally = { id: "ally" };
        const enemy = { id: "enemy" };
        const game: any = {
            alliances: { areAllied: (a: any, b: any) => (a === owner && b === ally) || (a === ally && b === owner) },
            map: { getTileZone: () => ZoneType.Ground },
        };
        const filter = createAresSuperWeaponTargetFilter("owner,allies", "land,buildings", owner, game);
        const tile = { rx: 1, ry: 1, z: 0 };

        expect(filter(object(ObjectType.Building, owner), tile)).toBe(true);
        expect(filter(object(ObjectType.Building, ally), tile)).toBe(true);
        expect(filter(object(ObjectType.Building, enemy), tile)).toBe(false);
        expect(filter(object(ObjectType.Infantry, owner), tile)).toBe(false);
    });

    test("supports water unit filters and unrestricted defaults", () => {
        const owner = { id: "owner" };
        const enemy = { id: "enemy" };
        const game: any = {
            alliances: { areAllied: () => false },
            map: { getTileZone: () => ZoneType.Water },
        };
        const waterFilter = createAresSuperWeaponTargetFilter("enemies", "water,units", owner, game);
        expect(waterFilter(object(ObjectType.Vehicle, enemy), {})).toBe(true);
        expect(waterFilter(object(ObjectType.Building, enemy), {})).toBe(false);
        expect(waterFilter(object(ObjectType.Vehicle, owner), {})).toBe(false);

        const unrestricted = createAresSuperWeaponTargetFilter(undefined, undefined, owner, game);
        expect(unrestricted(object(ObjectType.Building, enemy), {})).toBe(true);
    });
});
