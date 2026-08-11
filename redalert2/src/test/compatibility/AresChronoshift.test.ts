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
SW.AffectsTarget=Infantry,Buildings
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("Chrono")!);
        expect(definition).toMatchObject({
            chronosphereReconsiderBuildings: false,
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

    test("does not invent building teleportation when IsVehicle is enabled", () => {
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
            destroyObject: () => { throw new Error("building was incorrectly sent through unit teleportation"); },
        } as any);

        expect((effect as any).objectsToTeleport).toHaveLength(0);
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
});
