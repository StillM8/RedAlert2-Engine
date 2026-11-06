import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import {
    decideAresChronoshiftEligibility,
    parseAresChronoshiftRules,
    resolveAresChronoshiftCrushable,
} from "@/extensions/ares/AresChronoshift";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { TechnoRules } from "@/game/rules/TechnoRules";
import { ChronoSphereEffect } from "@/game/superweapon/ChronoSphereEffect";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { SpeedType } from "@/game/type/SpeedType";
import { LocomotorType } from "@/game/type/LocomotorType";
import { MovementZone } from "@/game/type/MovementZone";
import { StanceType } from "@/game/gameobject/infantry/StanceType";
import { DeathType } from "@/game/gameobject/common/DeathType";

function makeChronoshiftUnit(tile: any, options: any = {}): any {
    const unit: any = {
        id: options.name ?? "unit",
        name: options.name ?? "unit",
        tile,
        owner: options.owner,
        isSpawned: true,
        isDestroyed: false,
        isDisposed: false,
        isUnit: () => true,
        isBuilding: () => false,
        isInfantry: () => false,
        isAircraft: () => false,
        isVehicle: () => true,
        onBridge: false,
        tileElevation: 0,
        zone: ZoneType.Ground,
        moveTrait: {
            isDisabled: () => false,
            isChronoAftereffectLocked: () => false,
        },
        rules: {
            organic: false,
            teleporter: false,
            aresChronoshift: { allow: true },
        },
        invulnerableTrait: { isActive: () => false },
        warpedOutTrait: { isActive: () => false, setActive: () => undefined },
        ...options,
    };
    unit.rules = { ...unit.rules, ...(options.rules ?? {}) };
    return unit;
}

describe("Ares Chronoshift eligibility", () => {
    test("uses documented defaults and honors Allow/IsVehicle overrides", () => {
        const defaults = parseAresChronoshiftRules(new IniSection("PlainTechno"));
        expect(defaults).toEqual({ allow: true, isVehicle: false, crushable: true });

        const section = new IniSection("Configured");
        section.set("chronoshift.allow", "NO");
        section.set("CHRONOSHIFT.ISVEHICLE", "yes");
        section.set("Chronoshift.Crushable", "no");
        expect(parseAresChronoshiftRules(section)).toEqual({ allow: false, isVehicle: true, crushable: false });
    });

    test("applies the default object-category filter", () => {
        const base = { techno: { allow: true, isVehicle: false } };
        expect(decideAresChronoshiftEligibility({ ...base, objectCategory: "infantry" })).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "infantry",
        });
        expect(decideAresChronoshiftEligibility({ ...base, objectCategory: "unit" }).eligible).toBe(true);
        expect(decideAresChronoshiftEligibility({ ...base, objectCategory: "aircraft" })).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "unit",
        });
        expect(decideAresChronoshiftEligibility({ ...base, objectCategory: "building" })).toEqual({
            eligible: false,
            reason: "category-not-affected",
            effectiveCategory: "building",
        });
    });

    test("reclassifies only IsVehicle buildings when ReconsiderBuildings is enabled", () => {
        const vehicleBuilding = {
            objectCategory: "building",
            techno: { allow: true, isVehicle: true },
        } as const;

        expect(decideAresChronoshiftEligibility(vehicleBuilding)).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "unit",
        });
        expect(decideAresChronoshiftEligibility({
            ...vehicleBuilding,
            chronosphere: { reconsiderBuildings: false },
        })).toEqual({
            eligible: false,
            reason: "category-not-affected",
            effectiveCategory: "building",
        });
        expect(decideAresChronoshiftEligibility({
            objectCategory: "building",
            techno: { allow: true, isVehicle: false },
            chronosphere: { affectedTargets: ["building"] },
        })).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "building",
        });
    });

    test("honors Allow=false before category filtering", () => {
        expect(decideAresChronoshiftEligibility({
            objectCategory: "unit",
            techno: { allow: false, isVehicle: true },
        })).toEqual({
            eligible: false,
            reason: "not-allowed",
            effectiveCategory: "unit",
        });
    });

    test("falls back safely for malformed fields and unknown categories", () => {
        expect(decideAresChronoshiftEligibility({
            objectCategory: "not-a-techno",
            techno: { allow: "maybe" as unknown as boolean, isVehicle: 1 as unknown as boolean },
            chronosphere: { reconsiderBuildings: "sometimes", affectedTargets: ["invalid"] },
        })).toEqual({ eligible: false, reason: "invalid-category" });

        expect(decideAresChronoshiftEligibility({
            objectCategory: "building",
            techno: { allow: true, isVehicle: true },
            chronosphere: { reconsiderBuildings: "sometimes", affectedTargets: ["invalid"] },
        })).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "unit",
        });

        const malformed = new IniSection("Malformed");
        malformed.set("Chronoshift.Allow", "maybe");
        malformed.set("Chronoshift.IsVehicle", "unknown");
        malformed.set("Chronoshift.Crushable", "unclear");
        expect(parseAresChronoshiftRules(malformed)).toEqual({ allow: true, isVehicle: false, crushable: true });

        expect(resolveAresChronoshiftCrushable({ crushable: false })).toBe(false);
        expect(resolveAresChronoshiftCrushable({ crushable: "no" as unknown as boolean })).toBeUndefined();
        expect(resolveAresChronoshiftCrushable(undefined)).toBeUndefined();
    });

    test("parses optional TechnoRules fields and Chronosphere.ReconsiderBuildings", () => {
        const technoSection = new IniSection("ChronoshiftUnit");
        technoSection.set("Chronoshift.Allow", "no");
        technoSection.set("Chronoshift.IsVehicle", "yes");
        const technoRules = new TechnoRules(ObjectType.Building, technoSection, 0, {}, new ArmorRegistry());
        expect(technoRules.aresChronoshift).toEqual({ allow: false, isVehicle: true, crushable: true });

        const crushableOnlySection = new IniSection("CrushableOnly");
        crushableOnlySection.set("Chronoshift.Crushable", "no");
        const crushableOnlyRules = new TechnoRules(ObjectType.Vehicle, crushableOnlySection, 0, {}, new ArmorRegistry());
        expect(crushableOnlyRules.aresChronoshift).toEqual({ allow: true, isVehicle: false, crushable: false });

        const vanillaRules = new TechnoRules(ObjectType.Vehicle, new IniSection("VanillaUnit"), 0, {}, new ArmorRegistry());
        expect(vanillaRules.aresChronoshift).toBeUndefined();

        const ini = new IniFile(`
[Chrono]
Type=ChronoSphere
Chronosphere.ReconsiderBuildings=no
Chronosphere.KillOrganic=no
Chronosphere.KillTeleporters=yes
Chronosphere.AffectsIronCurtain=yes
Chronosphere.AffectsUnwarpable=no
Chronosphere.AffectsUndeployable=yes
Chronosphere.BlowUnplaceable=no
Chronosphere.KillCargo=yes
SW.AffectsHouse=team
SW.AffectsTarget=Infantry,Buildings
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("Chrono")!);
        expect(definition).toMatchObject({
            chronosphereReconsiderBuildings: false,
            chronosphereKillOrganic: false,
            chronosphereKillTeleporters: true,
            chronosphereAffectsIronCurtain: true,
            chronosphereAffectsUnwarpable: false,
            chronosphereAffectsUndeployable: true,
            chronosphereBlowUnplaceable: false,
            chronosphereKillCargo: true,
            swAffectsHouse: "team",
            swAffectsTarget: "Infantry,Buildings",
        });
    });

    test("filters Chronosphere unit candidates while preserving the vanilla absent-config path", () => {
        const sourceCenter = { rx: 4, ry: 4, z: 0 };
        const destinationCenter = { rx: 10, ry: 10, z: 0 };
        const getTile = (rx: number, ry: number) => ({ rx, ry, z: 0, onBridgeLandType: false });
        const infantry = {
            tile: getTile(4, 4),
            isUnit: () => true,
            isInfantry: () => true,
            isAircraft: () => false,
            isVehicle: () => false,
            isDisposed: false,
            onBridge: false,
            tileElevation: 0,
            rules: { organic: false, teleporter: true },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: { isActive: () => false, setActive: (active: boolean) => { infantry.warped = active; } },
            warped: false,
        } as any;
        const vehicle = {
            tile: getTile(5, 4),
            isUnit: () => true,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => true,
            isDisposed: false,
            onBridge: false,
            tileElevation: 0,
            rules: { organic: false, teleporter: true },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: { isActive: () => false, setActive: (active: boolean) => { vehicle.warped = active; } },
            warped: false,
        } as any;
        const game = {
            rules: { general: { chronoDelay: 0 } },
            map: {
                tiles: { getByMapCoords: getTile },
                tileOccupation: { calculateTilesForGameObject: (tile: any) => [tile] },
                getGroundObjectsOnTile: () => [],
            },
            getWorld: () => ({ getAllObjects: () => [infantry, vehicle] }),
            destroyObject: () => { throw new Error("Chronoshift eligibility test destroyed an object"); },
        } as any;

        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            sourceCenter,
            destinationCenter,
            [3],
            { affectedTargets: "Infantry" },
        );
        effect.onStart(game);

        expect(infantry.warped).toBe(true);
        expect(vehicle.warped).toBe(false);
        expect((effect as any).objectsToTeleport).toHaveLength(1);

        const vanillaEffect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            sourceCenter,
            destinationCenter,
            [3],
        );
        vanillaEffect.onStart({
            ...game,
            getWorld: () => ({ getAllObjects: () => [vehicle] }),
        });
        expect((vanillaEffect as any).objectsToTeleport).toHaveLength(1);
    });

    test("filters Chronosphere candidates by SW.AffectsHouse relations", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const destinationTile = { rx: 10, ry: 10, z: 0, onBridgeLandType: false };
        const owner: any = { id: "owner", buildings: new Set() };
        const ally: any = { id: "ally" };
        const enemy: any = { id: "enemy" };
        const units = [
            makeChronoshiftUnit(sourceTile, { name: "owned", owner }),
            makeChronoshiftUnit(sourceTile, { name: "allied", owner: ally }),
            makeChronoshiftUnit(sourceTile, { name: "enemy", owner: enemy }),
        ];
        const game: any = {
            rules: { general: { chronoDelay: 0 } },
            alliances: {
                areAllied: (first: any, second: any) =>
                    (first === owner && second === ally) || (first === ally && second === owner),
            },
            map: {
                tiles: { getByMapCoords: (rx: number, ry: number) => ({ rx, ry, z: 0, onBridgeLandType: false }) },
                getTileZone: () => ZoneType.Ground,
                tileOccupation: { calculateTilesForGameObject: (tile: any) => [tile] },
            },
            getWorld: () => ({ getAllObjects: () => units }),
            destroyObject: () => { throw new Error("house filtering should not destroy a candidate"); },
        };
        const affectedNames = (affectsHouse: string): string[] => {
            const effect = new ChronoSphereEffect(
                "ChronoSphere",
                owner,
                sourceTile,
                destinationTile,
                [3],
                { affectsHouse },
            );
            effect.onStart(game);
            return (effect as any).objectsToTeleport.map((entry: any) => entry.obj.name);
        };

        expect(affectedNames("owner")).toEqual(["owned"]);
        expect(affectedNames("allies")).toEqual(["allied"]);
        expect(affectedNames("team")).toEqual(["owned", "allied"]);
        expect(affectedNames("enemies")).toEqual(["enemy"]);
        expect(affectedNames("all")).toEqual(["owned", "allied", "enemy"]);
        expect(affectedNames("none")).toEqual([]);
    });

    test("excludes limbo, chrono-locked, airborne, warped, and weapons-factory-linked units", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const destinationTile = { rx: 10, ry: 10, z: 0, onBridgeLandType: false };
        const owner: any = { buildings: new Set() };
        const eligible = makeChronoshiftUnit(sourceTile, { name: "eligible", owner });
        const limboed = makeChronoshiftUnit(sourceTile, {
            name: "limboed",
            owner,
            isSpawned: false,
            limboData: {},
        });
        const chronoLocked = makeChronoshiftUnit(sourceTile, {
            name: "chronoLocked",
            owner,
            moveTrait: {
                isDisabled: () => false,
                isChronoAftereffectLocked: () => true,
            },
        });
        const airborne = makeChronoshiftUnit(sourceTile, {
            name: "airborne",
            owner,
            zone: ZoneType.Air,
        });
        const warped = makeChronoshiftUnit(sourceTile, {
            name: "warped",
            owner,
            rules: { organic: true },
            warpedOutTrait: { isActive: () => true, setActive: () => undefined },
        });
        const factoryLinked = makeChronoshiftUnit(sourceTile, { name: "factoryLinked", owner });
        const factory: any = {
            isBuilding: () => true,
            rules: { weaponsFactory: true },
            factoryTrait: { deliveringUnit: factoryLinked },
        };
        owner.buildings.add(factory);
        const destroyed: any[] = [];
        const game: any = {
            rules: { general: { chronoDelay: 0 } },
            map: {
                tiles: { getByMapCoords: (rx: number, ry: number) => ({ rx, ry, z: 0, onBridgeLandType: false }) },
                tileOccupation: {
                    calculateTilesForGameObject: (tile: any) => [tile],
                    isTileOccupiedBy: (tile: any, object: any) => tile === sourceTile && object === factory,
                },
            },
            getWorld: () => ({
                getAllObjects: () => [eligible, limboed, chronoLocked, airborne, warped, factoryLinked],
            }),
            destroyObject: (object: any) => destroyed.push(object),
        };
        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            owner,
            sourceTile,
            destinationTile,
            [3],
        );

        effect.onStart(game);

        expect(destroyed).toEqual([]);
        expect((effect as any).objectsToTeleport.map((entry: any) => entry.obj)).toEqual([eligible]);
    });

    test("does not equate generic movement disable with a chrono lock", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const destinationTile = { rx: 10, ry: 10, z: 0, onBridgeLandType: false };
        const owner: any = { buildings: new Set() };
        const disabledMoveTrait = (chronoLocked: boolean = false) => {
            let locked = chronoLocked;
            let teleports = 0;
            return {
                isDisabled: () => true,
                isChronoAftereffectLocked: () => locked,
                setChronoAftereffectLocked: (value: boolean) => { locked = value; },
                teleportUnitToTile: () => { teleports++; },
                getTeleports: () => teleports,
            };
        };
        const deployed = makeChronoshiftUnit(sourceTile, {
            name: "deployed",
            owner,
            isInfantry: () => true,
            isVehicle: () => false,
            stance: StanceType.Deployed,
            moveTrait: disabledMoveTrait(),
        });
        const emp = makeChronoshiftUnit(sourceTile, {
            name: "emp",
            owner,
            empTrait: { isUnderEMP: () => true },
            moveTrait: disabledMoveTrait(),
        });
        const powered = makeChronoshiftUnit(sourceTile, {
            name: "powered",
            owner,
            aresPoweredByTrait: { isOffline: () => true },
            moveTrait: disabledMoveTrait(),
        });
        const operator = makeChronoshiftUnit(sourceTile, {
            name: "operator",
            owner,
            operatorTrait: { isOffline: () => true },
            moveTrait: disabledMoveTrait(),
        });
        const chronoLocked = makeChronoshiftUnit(sourceTile, {
            name: "chronoLocked",
            owner,
            moveTrait: disabledMoveTrait(true),
        });
        const game: any = {
            rules: { general: { chronoDelay: 0, padAircraft: [] } },
            map: {
                tiles: { getByMapCoords: (rx: number, ry: number) => ({ rx, ry, z: 0, onBridgeLandType: false }) },
                mapBounds: { isWithinBounds: () => true },
                tileOccupation: {
                    calculateTilesForGameObject: (tile: any) => [tile],
                    getBridgeOnTile: () => undefined,
                },
                terrain: { getPassableSpeed: () => 1, findObstacles: () => [] },
                getGroundObjectsOnTile: () => [],
                getTileZone: () => ZoneType.Ground,
            },
            getWorld: () => ({ getAllObjects: () => [deployed, emp, powered, operator, chronoLocked] }),
            destroyObject: () => { throw new Error("eligible generic-disabled objects should not be destroyed"); },
        };
        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            owner,
            sourceTile,
            destinationTile,
            [3],
        );

        effect.onStart(game);

        expect((effect as any).objectsToTeleport.map((entry: any) => entry.obj.name)).toEqual([
            "deployed",
            "emp",
            "powered",
            "operator",
        ]);
        expect(deployed.moveTrait.isChronoAftereffectLocked()).toBe(true);
        expect(emp.moveTrait.isChronoAftereffectLocked()).toBe(true);
        expect(powered.moveTrait.isChronoAftereffectLocked()).toBe(true);
        expect(operator.moveTrait.isChronoAftereffectLocked()).toBe(true);

        effect.onTick(game);

        expect(deployed.moveTrait.getTeleports()).toBe(1);
        expect(emp.moveTrait.getTeleports()).toBe(1);
        expect(powered.moveTrait.getTeleports()).toBe(1);
        expect(operator.moveTrait.getTeleports()).toBe(1);
        expect(chronoLocked.moveTrait.getTeleports()).toBe(0);
        expect(deployed.moveTrait.isChronoAftereffectLocked()).toBe(false);
        expect(chronoLocked.moveTrait.isChronoAftereffectLocked()).toBe(true);
    });

    test("chronoshifts IsVehicle buildings through the shared eligibility path", () => {
        const building = {
            tile: { rx: 4, ry: 4, z: 0, onBridgeLandType: false },
            isUnit: () => false,
            isBuilding: () => true,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => false,
            isDisposed: false,
            onBridge: false,
            tileElevation: 0,
            rules: {
                organic: false,
                teleporter: true,
                aresChronoshift: { allow: true, isVehicle: true },
            },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: { isActive: () => false, setActive: (active: boolean) => { building.warped = active; } },
            warped: false,
        } as any;
        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            { rx: 4, ry: 4, z: 0 },
            { rx: 10, ry: 10, z: 0 },
            [3],
        );
        effect.onStart({
            rules: { general: { chronoDelay: 0 } },
            map: {
                tiles: { getByMapCoords: (rx: number, ry: number) => ({ rx, ry, z: 0, onBridgeLandType: false }) },
                tileOccupation: { calculateTilesForGameObject: (tile: any) => [tile] },
                getGroundObjectsOnTile: () => [],
            },
            getWorld: () => ({ getAllObjects: () => [building] }),
            destroyObject: () => { throw new Error("building should be queued for the building teleport path"); },
        } as any);

        expect((effect as any).objectsToTeleport).toHaveLength(1);
    });

    test("relocates eligible buildings using their full foundation", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const destinationTile = { rx: 10, ry: 10, z: 0, onBridgeLandType: false };
        const getTile = (rx: number, ry: number) => {
            if (rx === sourceTile.rx && ry === sourceTile.ry) return sourceTile;
            if (rx === destinationTile.rx && ry === destinationTile.ry) return destinationTile;
            return { rx, ry, z: 0, onBridgeLandType: false };
        };
        const transitions: string[] = [];
        const building = {
            tile: sourceTile,
            isSpawned: true,
            isDisposed: false,
            isUnit: () => false,
            isBuilding: () => true,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => false,
            onBridge: false,
            tileElevation: 0,
            art: { foundation: { width: 2, height: 2 } },
            getFoundation: () => ({ width: 2, height: 2 }),
            rules: {
                organic: false,
                teleporter: false,
                speedType: 0,
                aresChronoshift: { allow: true, isVehicle: true },
            },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: {
                isActive: () => false,
                setActive: (active: boolean) => transitions.push(`warp:${active}`),
            },
        } as any;
        const game = {
            rules: { general: { chronoDelay: 0, padAircraft: [] } },
            map: {
                tiles: { getByMapCoords: getTile },
                mapBounds: { isWithinBounds: () => true },
                tileOccupation: {
                    calculateTilesForGameObject: (tile: any) => [
                        getTile(tile.rx, tile.ry),
                        getTile(tile.rx + 1, tile.ry),
                        getTile(tile.rx, tile.ry + 1),
                        getTile(tile.rx + 1, tile.ry + 1),
                    ],
                },
                terrain: {
                    getPassableSpeed: () => 1,
                    findObstacles: () => [],
                },
                getGroundObjectsOnTile: (tile: any) => tile === sourceTile ? [building] : [],
            },
            limboObject: (object: any, data: any) => {
                transitions.push("limbo");
                object.limboData = data;
                object.isSpawned = false;
            },
            unlimboObject: (object: any, tile: any) => {
                transitions.push("unlimbo");
                object.limboData = undefined;
                object.tile = tile;
                object.isSpawned = true;
            },
            getWorld: () => ({ getAllObjects: () => [building] }),
            destroyObject: () => { throw new Error("a placeable building should not be destroyed"); },
        } as any;

        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            sourceTile,
            destinationTile,
        );
        effect.onStart(game);
        effect.onTick(game);

        expect(transitions).toEqual(["warp:true", "limbo", "unlimbo", "warp:false"]);
        expect(building.tile).toBe(destinationTile);
        expect(building.isSpawned).toBe(true);
    });

    test("keeps an eligible building at its source when BlowUnplaceable is disabled", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const getTile = (rx: number, ry: number) => rx === sourceTile.rx && ry === sourceTile.ry
            ? sourceTile
            : { rx, ry, z: 0, onBridgeLandType: false };
        const destroyed: any[] = [];
        const transitions: boolean[] = [];
        const building = {
            tile: sourceTile,
            isSpawned: true,
            isDisposed: false,
            isUnit: () => false,
            isBuilding: () => true,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => false,
            onBridge: false,
            tileElevation: 0,
            getFoundation: () => ({ width: 2, height: 2 }),
            rules: {
                organic: false,
                teleporter: false,
                speedType: 0,
                aresChronoshift: { allow: true, isVehicle: true },
            },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: {
                isActive: () => false,
                setActive: (active: boolean) => transitions.push(active),
            },
        } as any;
        const game = {
            rules: { general: { chronoDelay: 0 } },
            map: {
                tiles: { getByMapCoords: getTile },
                mapBounds: { isWithinBounds: () => true },
                tileOccupation: { calculateTilesForGameObject: () => [] },
                terrain: { findObstacles: () => [] },
                getGroundObjectsOnTile: (tile: any) => tile === sourceTile ? [building] : [],
            },
            getWorld: () => ({ getAllObjects: () => [building] }),
            destroyObject: (object: any) => destroyed.push(object),
            limboObject: () => { throw new Error("an unplaceable building should stay at the source"); },
            unlimboObject: () => { throw new Error("an unplaceable building should stay at the source"); },
        } as any;

        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            sourceTile,
            getTile(10, 10),
            undefined,
            { blowUnplaceable: false },
        );
        effect.onStart(game);
        effect.onTick(game);

        expect((effect as any).objectsToTeleport).toHaveLength(1);
        expect(destroyed).toHaveLength(0);
        expect(transitions).toEqual([true, false]);
        expect(building.tile).toBe(sourceTile);
    });

    test("applies KillOrganic only to organics and KillTeleporters only to organic teleporters", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const destinationTile = { rx: 10, ry: 10, z: 0, onBridgeLandType: false };
        const run = (killOrganic: boolean, killTeleporters: boolean) => {
            const owner: any = {};
            const organic = makeChronoshiftUnit(sourceTile, {
                name: "organic",
                owner,
                isInfantry: () => true,
                isVehicle: () => false,
                rules: { organic: true },
            });
            const organicTeleporter = makeChronoshiftUnit(sourceTile, {
                name: "organicTeleporter",
                owner,
                isInfantry: () => true,
                isVehicle: () => false,
                rules: { organic: true, teleporter: true },
            });
            const nonOrganicTeleporter = makeChronoshiftUnit(sourceTile, {
                name: "nonOrganicTeleporter",
                owner,
                rules: { teleporter: true },
            });
            const destroyed: string[] = [];
            const game: any = {
                rules: { general: { chronoDelay: 0 } },
                map: {
                    tiles: { getByMapCoords: (rx: number, ry: number) => ({ rx, ry, z: 0, onBridgeLandType: false }) },
                    tileOccupation: { calculateTilesForGameObject: (tile: any) => [tile] },
                },
                getWorld: () => ({
                    getAllObjects: () => [organic, organicTeleporter, nonOrganicTeleporter],
                }),
                destroyObject: (object: any) => destroyed.push(object.name),
            };
            const effect = new ChronoSphereEffect(
                "ChronoSphere",
                owner,
                sourceTile,
                destinationTile,
                [3],
                { killOrganic, killTeleporters },
            );

            effect.onStart(game);
            return {
                destroyed,
                queued: (effect as any).objectsToTeleport.map((entry: any) => entry.obj.name),
            };
        };

        expect(run(true, false)).toEqual({
            destroyed: ["organic"],
            queued: ["organicTeleporter", "nonOrganicTeleporter"],
        });
        expect(run(true, true)).toEqual({
            destroyed: ["organic", "organicTeleporter"],
            queued: ["nonOrganicTeleporter"],
        });
        expect(run(false, true)).toEqual({
            destroyed: [],
            queued: ["organic", "organicTeleporter", "nonOrganicTeleporter"],
        });
    });

    test("destroys the chronoshifting unit instead of a collision target marked non-crushable", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const destinationTile = { rx: 10, ry: 10, z: 0, onBridgeLandType: false };
        const destroyed: any[] = [];
        let teleports = 0;
        const shifter = {
            tile: sourceTile,
            isSpawned: true,
            isDisposed: false,
            isUnit: () => true,
            isBuilding: () => false,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => true,
            onBridge: false,
            tileElevation: 0,
            name: "shifter",
            rules: {
                organic: false,
                teleporter: true,
                speedType: 0,
                movementZone: 0,
                aresChronoshift: { allow: true, isVehicle: false, crushable: true },
            },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: { isActive: () => false, setActive: () => undefined },
            moveTrait: { teleportUnitToTile: () => { teleports++; } },
        } as any;
        const nonCrushable = {
            tile: destinationTile,
            isDisposed: false,
            isUnit: () => true,
            isBuilding: () => false,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => true,
            onBridge: false,
            tileElevation: 0,
            rules: { aresChronoshift: { crushable: false } },
        } as any;
        const game = {
            rules: { general: { chronoDelay: 0, padAircraft: [] } },
            map: {
                tiles: {
                    getByMapCoords: (rx: number, ry: number) =>
                        rx === sourceTile.rx && ry === sourceTile.ry
                            ? sourceTile
                            : rx === destinationTile.rx && ry === destinationTile.ry
                                ? destinationTile
                                : { rx, ry, z: 0, onBridgeLandType: false },
                },
                mapBounds: { isWithinBounds: () => true },
                tileOccupation: {
                    getBridgeOnTile: () => undefined,
                    calculateTilesForGameObject: () => [destinationTile],
                },
                getGroundObjectsOnTile: (tile: any) => tile === sourceTile
                    ? [shifter]
                    : tile === destinationTile
                        ? [nonCrushable]
                        : [],
                terrain: { getPassableSpeed: () => 1 },
                getTileZone: () => ZoneType.Land,
            },
            destroyObject: (object: any) => destroyed.push(object),
            getWorld: () => ({ getAllObjects: () => [shifter] }),
        } as any;
        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            sourceTile,
            destinationTile,
        );

        effect.onStart(game);
        effect.onTick(game);

        expect(destroyed).toEqual([shifter]);
        expect(nonCrushable.isDisposed).toBe(false);
        expect(teleports).toBe(0);

        destroyed.length = 0;
        nonCrushable.rules = {};
        const vanillaEffect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            sourceTile,
            destinationTile,
        );
        vanillaEffect.onStart(game);
        vanillaEffect.onTick(game);

        expect(destroyed).toEqual([nonCrushable]);
        expect(teleports).toBe(1);
    });

    test("honors ChronoInfantryCrush=no when an infantry shifter lands on a vehicle", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const destinationTile = { rx: 10, ry: 10, z: 0, onBridgeLandType: false };
        let teleports = 0;
        const shifter = {
            tile: sourceTile,
            isSpawned: true,
            isDisposed: false,
            isUnit: () => true,
            isBuilding: () => false,
            isInfantry: () => true,
            isAircraft: () => false,
            isVehicle: () => false,
            onBridge: false,
            tileElevation: 0,
            stance: 0,
            rules: {
                organic: false,
                teleporter: true,
                speedType: 0,
                movementZone: 0,
                aresChronoshift: { allow: true, crushable: true },
            },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: { isActive: () => false, setActive: () => undefined },
            moveTrait: { teleportUnitToTile: () => { teleports++; } },
        } as any;
        const target = {
            tile: destinationTile,
            isDisposed: false,
            isUnit: () => true,
            isBuilding: () => false,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => true,
            onBridge: false,
            tileElevation: 0,
            rules: {},
        } as any;
        const destroyed: any[] = [];
        const game = {
            rules: { general: { chronoDelay: 0, chronoInfantryCrush: false, padAircraft: [] } },
            map: {
                tiles: {
                    getByMapCoords: (rx: number, ry: number) => {
                        if (rx === sourceTile.rx && ry === sourceTile.ry) return sourceTile;
                        if (rx === destinationTile.rx && ry === destinationTile.ry) return destinationTile;
                        return { rx, ry, z: 0, onBridgeLandType: false };
                    },
                },
                mapBounds: { isWithinBounds: () => true },
                tileOccupation: {
                    getBridgeOnTile: () => undefined,
                    calculateTilesForGameObject: () => [destinationTile],
                },
                getGroundObjectsOnTile: (tile: any) => tile === sourceTile
                    ? [shifter]
                    : tile === destinationTile
                        ? [target]
                        : [],
                terrain: { getPassableSpeed: () => 1, findObstacles: () => [] },
                getTileZone: () => ZoneType.Land,
            },
            destroyObject: (object: any) => destroyed.push(object),
            getWorld: () => ({ getAllObjects: () => [shifter] }),
        } as any;
        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            sourceTile,
            destinationTile,
        );

        effect.onStart(game);
        effect.onTick(game);

        expect(destroyed).toEqual([shifter]);
        expect(target.isDestroyed).not.toBe(true);
        expect(teleports).toBe(0);
    });

    test("kills transport cargo before chronoshifting the carrier when KillCargo is enabled", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const destinationTile = { rx: 10, ry: 10, z: 0, onBridgeLandType: false };
        const passengers = [
            { isDestroyed: false },
            { isDestroyed: false },
        ];
        let teleports = 0;
        const carrier = {
            tile: sourceTile,
            isSpawned: true,
            isDisposed: false,
            isUnit: () => true,
            isBuilding: () => false,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => true,
            onBridge: false,
            tileElevation: 0,
            rules: {
                organic: false,
                teleporter: false,
                speedType: 0,
                movementZone: 0,
                aresChronoshift: { allow: true },
            },
            transportTrait: { units: passengers },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: { isActive: () => false, setActive: () => undefined },
            moveTrait: { teleportUnitToTile: () => { teleports++; } },
        } as any;
        const destroyed: any[] = [];
        const game = {
            rules: { general: { chronoDelay: 0, padAircraft: [] } },
            map: {
                tiles: {
                    getByMapCoords: (rx: number, ry: number) =>
                        rx === sourceTile.rx && ry === sourceTile.ry ? sourceTile : destinationTile,
                },
                mapBounds: { isWithinBounds: () => true },
                tileOccupation: {
                    getBridgeOnTile: () => undefined,
                    calculateTilesForGameObject: () => [destinationTile],
                },
                getGroundObjectsOnTile: (tile: any) => tile === sourceTile ? [carrier] : [],
                terrain: { getPassableSpeed: () => 1, findObstacles: () => [] },
                getTileZone: () => ZoneType.Land,
            },
            destroyObject: (object: any) => {
                object.isDestroyed = true;
                destroyed.push(object);
            },
            getWorld: () => ({ getAllObjects: () => [carrier] }),
        } as any;
        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            sourceTile,
            destinationTile,
            undefined,
            { killCargo: true },
        );

        effect.onStart(game);
        effect.onTick(game);

        expect(destroyed).toEqual(passengers);
        expect(carrier.transportTrait.units).toHaveLength(0);
        expect(teleports).toBe(1);
    });

    test("sinks Hover jumpjets relocated onto water", () => {
        const sourceTile = { rx: 4, ry: 4, z: 0, onBridgeLandType: false };
        const destinationTile = { rx: 10, ry: 10, z: 0, onBridgeLandType: false };
        const destroyed: any[] = [];
        let teleports = 0;
        const jumpjet = {
            tile: sourceTile,
            isSpawned: true,
            isDisposed: false,
            isUnit: () => true,
            isBuilding: () => false,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => true,
            onBridge: false,
            tileElevation: 0,
            name: "Nighthawk",
            rules: {
                organic: false,
                teleporter: false,
                speedType: SpeedType.Hover,
                locomotor: LocomotorType.Jumpjet,
                movementZone: MovementZone.Fly,
                aresChronoshift: { allow: true },
            },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: {
                isActive: () => false,
                setActive: () => undefined,
            },
            moveTrait: { teleportUnitToTile: () => { teleports++; } },
        } as any;
        const game = {
            rules: { general: { chronoDelay: 0, padAircraft: [] } },
            map: {
                tiles: {
                    getByMapCoords: (rx: number, ry: number) =>
                        rx === sourceTile.rx && ry === sourceTile.ry ? sourceTile :
                            rx === destinationTile.rx && ry === destinationTile.ry ? destinationTile :
                                { rx, ry, z: 0, onBridgeLandType: false },
                },
                mapBounds: { isWithinBounds: () => true },
                tileOccupation: {
                    getBridgeOnTile: () => undefined,
                    calculateTilesForGameObject: () => [destinationTile],
                },
                terrain: { getPassableSpeed: () => 1, findObstacles: () => [] },
                getGroundObjectsOnTile: (tile: any) => tile === sourceTile ? [jumpjet] : [],
                getTileZone: () => ZoneType.Water,
            },
            destroyObject: (object: any) => {
                object.isDestroyed = true;
                destroyed.push(object);
            },
            getWorld: () => ({ getAllObjects: () => [jumpjet] }),
        } as any;
        const effect = new ChronoSphereEffect(
            "ChronoSphere",
            {} as any,
            sourceTile,
            destinationTile,
        );

        effect.onStart(game);
        effect.onTick(game);

        expect(teleports).toBe(1);
        expect(jumpjet.deathType).toBe(DeathType.Sink);
        expect(destroyed).toEqual([jumpjet]);
    });
});
