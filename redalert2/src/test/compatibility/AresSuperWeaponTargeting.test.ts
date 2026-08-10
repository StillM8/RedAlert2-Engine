import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import {
    isAresSuperWeaponActivationAllowed,
    isAresSuperWeaponFireIntoShroudAllowed,
    isAresSuperWeaponRequiredTargetAllowed,
} from "@/extensions/ares/AresSuperWeaponFilters";
import { ActivateSuperWeaponAction } from "@/game/action/ActivateSuperWeaponAction";
import { ShroudType } from "@/game/map/MapShroud";

function techno(type: ObjectType, owner: any): any {
    return {
        id: `${type}-${owner.id}`,
        owner,
        rules: { type },
        isTechno: () => true,
        isBuilding: () => type === ObjectType.Building,
        isInfantry: () => type === ObjectType.Infantry,
        isVehicle: () => type === ObjectType.Vehicle,
        isAircraft: () => type === ObjectType.Aircraft,
        isUnit: () => type !== ObjectType.Building,
    };
}

function gameFor(zone: ZoneType, objects: any[] = []): any {
    return {
        alliances: { areAllied: () => false },
        map: {
            getTileZone: () => zone,
            getGroundObjectsOnTile: () => objects,
        },
    };
}

describe("Ares superweapon target requirements", () => {
    test("uses the documented permissive default and rejects only unexplored cells when disabled", () => {
        const owner = { id: "owner" };
        const tile = { rx: 4, ry: 4, z: 0 };
        let shroudType = ShroudType.Unexplored;
        const game: any = {
            mapShroudTrait: {
                getPlayerShroud: () => ({ getShroudType: () => shroudType }),
            },
        };

        expect(isAresSuperWeaponFireIntoShroudAllowed(undefined, owner, tile, game)).toBe(true);
        expect(isAresSuperWeaponFireIntoShroudAllowed(true, owner, tile, game)).toBe(true);
        expect(isAresSuperWeaponFireIntoShroudAllowed(false, owner, tile, game)).toBe(false);

        shroudType = ShroudType.TemporaryReveal;
        expect(isAresSuperWeaponFireIntoShroudAllowed(false, owner, tile, game)).toBe(true);
        shroudType = ShroudType.Explored;
        expect(isAresSuperWeaponFireIntoShroudAllowed(false, owner, tile, game)).toBe(true);
    });

    test("applies the inclusive land/water mask and content mask", () => {
        const owner = { id: "owner" };
        const enemy = { id: "enemy" };
        const tile = { rx: 4, ry: 4, z: 0 };
        const vehicle = techno(ObjectType.Vehicle, enemy);

        expect(isAresSuperWeaponRequiredTargetAllowed(vehicle, tile, "land,units", gameFor(ZoneType.Ground))).toBe(true);
        expect(isAresSuperWeaponRequiredTargetAllowed(vehicle, tile, "land,units", gameFor(ZoneType.Water))).toBe(false);
        expect(isAresSuperWeaponRequiredTargetAllowed(undefined, tile, "land,units", gameFor(ZoneType.Ground))).toBe(false);
        expect(isAresSuperWeaponRequiredTargetAllowed(undefined, tile, "water", gameFor(ZoneType.Water))).toBe(true);
        expect(isAresSuperWeaponRequiredTargetAllowed(undefined, tile, "water", gameFor(ZoneType.Ground))).toBe(false);
        void owner;
    });

    test("supports empty-or-building requirements without treating empty as a wildcard", () => {
        const owner = { id: "owner" };
        const tile = { rx: 1, ry: 1, z: 0 };
        const building = techno(ObjectType.Building, owner);
        const infantry = techno(ObjectType.Infantry, owner);
        const game = gameFor(ZoneType.Ground);

        expect(isAresSuperWeaponRequiredTargetAllowed(undefined, tile, "empty,buildings", game)).toBe(true);
        expect(isAresSuperWeaponRequiredTargetAllowed(building, tile, "empty,buildings", game)).toBe(true);
        expect(isAresSuperWeaponRequiredTargetAllowed(infantry, tile, "empty,buildings", game)).toBe(false);
    });

    test("checks house relations only when the selected cell has a techno", () => {
        const owner = { id: "owner" };
        const ally = { id: "ally" };
        const enemy = { id: "enemy" };
        const tile = { rx: 2, ry: 2, z: 0 };
        const game: any = {
            alliances: {
                areAllied: (first: any, second: any) =>
                    (first === owner && second === ally) || (first === ally && second === owner),
            },
            map: {
                getTileZone: () => ZoneType.Ground,
                getGroundObjectsOnTile: () => [],
            },
        };

        expect(isAresSuperWeaponActivationAllowed("Enemies", "land", owner, tile, game)).toBe(true);
        game.map.getGroundObjectsOnTile = () => [techno(ObjectType.Vehicle, ally)];
        expect(isAresSuperWeaponActivationAllowed("Enemies", "land", owner, tile, game)).toBe(false);
        game.map.getGroundObjectsOnTile = () => [techno(ObjectType.Vehicle, enemy)];
        expect(isAresSuperWeaponActivationAllowed("Enemies", "land", owner, tile, game)).toBe(true);
    });

    test("rejects an invalid action before consuming the superweapon charge", () => {
        const owner = { id: "owner" };
        const enemy = { id: "enemy" };
        const tile = { rx: 5, ry: 5, z: 0 };
        let activations = 0;
        const rules = {
            name: "TargetedSW",
            type: undefined,
            ares: { swRequiresTarget: "water,units", swRequiresHouse: "Enemies" },
        };
        const game: any = {
            map: {
                tiles: { getByMapCoords: () => tile },
                getTileZone: () => ZoneType.Ground,
                getGroundObjectsOnTile: () => [techno(ObjectType.Vehicle, enemy)],
            },
            rules: { getSuperWeaponByIndex: () => rules },
            traits: { get: () => ({ activateSuperWeapon: () => activations++ }) },
            alliances: { areAllied: () => false },
        };
        const action = new ActivateSuperWeaponAction(game);
        (action as any).player = owner;
        (action as any).superWeaponType = 0;
        (action as any).tile = { x: 5, y: 5 };

        action.process();
        expect(activations).toBe(0);

        game.map.getTileZone = () => ZoneType.Water;
        action.process();
        expect(activations).toBe(1);
    });

    test("rejects SW.FireIntoShroud=no before consuming a charge", () => {
        const owner = { id: "owner" };
        const tile = { rx: 5, ry: 5, z: 0 };
        let activations = 0;
        let shroudType = ShroudType.Unexplored;
        const rules = {
            name: "HiddenTargetSW",
            type: undefined,
            ares: { swFireIntoShroud: false },
        };
        const game: any = {
            map: {
                tiles: { getByMapCoords: () => tile },
                getTileZone: () => ZoneType.Ground,
                getGroundObjectsOnTile: () => [],
            },
            mapShroudTrait: {
                getPlayerShroud: () => ({ getShroudType: () => shroudType }),
            },
            rules: { getSuperWeaponByIndex: () => rules },
            traits: { get: () => ({ activateSuperWeapon: () => activations++ }) },
            alliances: { areAllied: () => false },
        };
        const action = new ActivateSuperWeaponAction(game);
        (action as any).player = owner;
        (action as any).superWeaponType = 0;
        (action as any).tile = { x: 5, y: 5 };

        action.process();
        expect(activations).toBe(0);

        shroudType = ShroudType.Explored;
        action.process();
        expect(activations).toBe(1);
    });
});
