import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import {
    isAresSuperWeaponActivationAllowed,
    isAresSuperWeaponFireIntoShroudAllowed,
    isAresSuperWeaponManualActivationAllowed,
    isAresSuperWeaponRequiredTargetAllowed,
} from "@/extensions/ares/AresSuperWeaponFilters";
import { isAresSuperWeaponLaunchAllowed } from "@/extensions/ares/AresSuperWeaponLaunch";
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
    function launchObject(
        id: string,
        type: ObjectType,
        owner: any,
        tile: any,
        rules: Record<string, any> = {},
    ): any {
        return {
            id,
            owner,
            tile,
            centerTile: tile,
            rules: { type, name: id, sight: 6, ...rules },
            isTechno: () => true,
            isBuilding: () => type === ObjectType.Building,
            isInfantry: () => type === ObjectType.Infantry,
            isVehicle: () => type === ObjectType.Vehicle,
            isAircraft: () => type === ObjectType.Aircraft,
            isUnit: () => type !== ObjectType.Building,
            poweredTrait: type === ObjectType.Building ? { isPoweredOn: () => true } : undefined,
        };
    }

    test("enforces launch-site minimum and maximum range for a provider building", () => {
        const owner = { id: "owner" };
        const provider = launchObject("Provider", ObjectType.Building, owner, { rx: 10, ry: 10, z: 0 }, {
            superWeapon: "RangeSW",
        });
        owner.getOwnedObjects = () => [provider];
        const game: any = { alliances: { areAllied: () => false }, getWorld: () => ({ getAllObjects: () => [provider] }) };
        const rules = { name: "RangeSW", swRangeMinimum: 2, swRangeMaximum: 5 };

        expect(isAresSuperWeaponLaunchAllowed(rules, owner, { rx: 12, ry: 10, z: 0 }, game)).toBe(true);
        expect(isAresSuperWeaponLaunchAllowed(rules, owner, { rx: 11, ry: 10, z: 0 }, game)).toBe(false);
        expect(isAresSuperWeaponLaunchAllowed(rules, owner, { rx: 16, ry: 10, z: 0 }, game)).toBe(false);
    });

    test("applies the launch gate before the action consumes a charge", () => {
        const owner = { id: "owner" };
        const provider = launchObject("Provider", ObjectType.Building, owner, { rx: 0, ry: 0, z: 0 }, {
            superWeapon: "ActionRangeSW",
        });
        owner.getOwnedObjects = () => [provider];
        let activations = 0;
        const rules = {
            name: "ActionRangeSW",
            type: undefined,
            ares: { swRangeMaximum: 1 },
        };
        const game: any = {
            map: {
                tiles: { getByMapCoords: (x: number, y: number) => ({ rx: x, ry: y, z: 0 }) },
                getTileZone: () => ZoneType.Ground,
                getGroundObjectsOnTile: () => [],
            },
            getWorld: () => ({ getAllObjects: () => [provider] }),
            rules: { getSuperWeaponByIndex: () => rules },
            traits: { get: () => ({ activateSuperWeapon: () => activations++ }) },
            alliances: { areAllied: () => false },
        };
        const action = new ActivateSuperWeaponAction(game);
        (action as any).player = owner;
        (action as any).superWeaponType = 0;
        (action as any).tile = { x: 2, y: 0 };

        action.process();
        expect(activations).toBe(0);

        (action as any).tile = { x: 1, y: 0 };
        action.process();
        expect(activations).toBe(1);
    });

    test("requires a named or any designator within its own range", () => {
        const owner = { id: "owner" };
        const provider = launchObject("Provider", ObjectType.Building, owner, { rx: 0, ry: 0, z: 0 }, {
            superWeapon: "DesignatedSW",
        });
        const designator = launchObject("Designator", ObjectType.Vehicle, owner, { rx: 0, ry: 2, z: 0 }, {
            designatorRange: 3,
        });
        owner.getOwnedObjects = () => [provider, designator];
        const game: any = { alliances: { areAllied: () => false }, getWorld: () => ({ getAllObjects: () => [provider, designator] }) };
        const rules = { name: "DesignatedSW", swDesignators: ["Designator"], swRangeMaximum: 20 };

        expect(isAresSuperWeaponLaunchAllowed(rules, owner, { rx: 0, ry: 5, z: 0 }, game)).toBe(true);
        expect(isAresSuperWeaponLaunchAllowed(rules, owner, { rx: 0, ry: 6, z: 0 }, game)).toBe(false);
        expect(isAresSuperWeaponLaunchAllowed({ ...rules, swAnyDesignator: true, swDesignators: undefined }, owner, { rx: 0, ry: 5, z: 0 }, game)).toBe(true);
    });

    test("blocks a target area covered by an operational enemy inhibitor", () => {
        const owner = { id: "owner" };
        const enemy = { id: "enemy" };
        const nearProvider = launchObject("NearProvider", ObjectType.Building, owner, { rx: 0, ry: 0, z: 0 }, {
            superWeapon: "InhibitedSW",
        });
        const farProvider = launchObject("FarProvider", ObjectType.Building, owner, { rx: 10, ry: 0, z: 0 }, {
            superWeapon: "InhibitedSW",
        });
        const inhibitor = launchObject("Inhibitor", ObjectType.Building, enemy, { rx: 1, ry: 0, z: 0 }, {
            inhibitorRange: 3,
        });
        owner.getOwnedObjects = () => [nearProvider, farProvider];
        const game: any = {
            alliances: { areAllied: () => false },
            getWorld: () => ({ getAllObjects: () => [nearProvider, farProvider, inhibitor] }),
        };
        const rules = { name: "InhibitedSW", swInhibitors: ["Inhibitor"], swRangeMaximum: 3 };

        expect(isAresSuperWeaponLaunchAllowed(rules, owner, { rx: 0, ry: 0, z: 0 }, game)).toBe(false);
        expect(isAresSuperWeaponLaunchAllowed(rules, owner, { rx: 10, ry: 0, z: 0 }, game)).toBe(true);

        inhibitor.poweredTrait.isPoweredOn = () => false;
        expect(isAresSuperWeaponLaunchAllowed(rules, owner, { rx: 0, ry: 0, z: 0 }, game)).toBe(true);
    });

    test("applies AutoFire/ManualFire only to human click actions", () => {
        const human = { id: "human", isAi: false };
        const ai = { id: "ai", isAi: true };

        expect(isAresSuperWeaponManualActivationAllowed(true, false, human)).toBe(false);
        expect(isAresSuperWeaponManualActivationAllowed(true, false, ai)).toBe(true);
        expect(isAresSuperWeaponManualActivationAllowed(false, false, human)).toBe(true);
        expect(isAresSuperWeaponManualActivationAllowed(undefined, false, human)).toBe(true);
    });

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

    test("rejects an auto-fire-only human activation but keeps AI actions valid", () => {
        const tile = { rx: 5, ry: 5, z: 0 };
        let activations = 0;
        const rules = {
            name: "AutoOnlySW",
            type: undefined,
            ares: { swAutoFire: true, swManualFire: false },
        };
        const game: any = {
            map: {
                tiles: { getByMapCoords: () => tile },
                getTileZone: () => ZoneType.Ground,
                getGroundObjectsOnTile: () => [],
            },
            rules: { getSuperWeaponByIndex: () => rules },
            traits: { get: () => ({ activateSuperWeapon: () => activations++ }) },
            alliances: { areAllied: () => false },
        };
        const action = new ActivateSuperWeaponAction(game);
        (action as any).superWeaponType = 0;
        (action as any).tile = { x: 5, y: 5 };

        (action as any).player = { id: "human", isAi: false };
        action.process();
        expect(activations).toBe(0);

        (action as any).player = { id: "ai", isAi: true };
        action.process();
        expect(activations).toBe(1);
    });
});
