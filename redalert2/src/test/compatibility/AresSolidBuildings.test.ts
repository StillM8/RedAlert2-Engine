import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { getAresCapability } from "@/extensions/ares/AresFeatureCatalog";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { Coords } from "@/game/Coords";
import { ObjectArt } from "@/game/art/ObjectArt";
import { getFoundationCells } from "@/game/art/Foundation";
import { Projectile } from "@/game/gameobject/Projectile";
import { CollisionHelper } from "@/game/gameobject/unit/CollisionHelper";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { ProjectileRules } from "@/game/rules/ProjectileRules";
import { LandType } from "@/game/type/LandType";

function makeTile(rx: number, ry: number) {
    return {
        rx,
        ry,
        z: 0,
        landType: LandType.Clear,
        terrainType: 0,
    };
}

function makeWorldPoint(
    rx: number,
    ry: number,
    elevation: number,
    offsetX: number = 0.5,
    offsetY: number = 0.5,
) {
    return {
        x: (rx + offsetX) * Coords.LEPTONS_PER_TILE,
        y: Coords.tileHeightToWorld(elevation),
        z: (ry + offsetY) * Coords.LEPTONS_PER_TILE,
    };
}

function makeProjectilePosition(
    rx: number,
    ry: number,
    elevation: number,
    offsetX: number = 0.5,
    offsetY: number = 0.5,
) {
    const tile = makeTile(rx, ry);
    return {
        tile,
        tileElevation: elevation,
        worldPosition: makeWorldPoint(rx, ry, elevation, offsetX, offsetY),
    };
}

function makeBuilding(
    id: number,
    name: string,
    rx: number,
    ry: number,
    solidHeight: number,
    foundation: any = { width: 1, height: 1 },
    baseElevation: number = 0,
) {
    const tile = makeTile(rx, ry);
    return {
        id,
        name,
        tile,
        art: { solidHeight },
        position: {
            worldPosition: {
                x: 0,
                y: Coords.tileHeightToWorld(baseElevation),
                z: 0,
            },
        },
        isDestroyed: false,
        isDisposed: false,
        isBuilding: () => true,
        isOverlay: () => false,
        isTechno: () => true,
        getFoundation: () => foundation,
    };
}

function makeOccupation(buildings: any[], maxX: number = 6, maxY: number = 3) {
    const tiles = new Map<string, any>();
    for (let rx = 0; rx <= maxX; rx++) {
        for (let ry = 0; ry <= maxY; ry++) {
            tiles.set(`${rx},${ry}`, makeTile(rx, ry));
        }
    }
    return {
        getObjectsOnTile: (tile: any) => buildings.filter(building => {
            const foundation = building.getFoundation();
            return getFoundationCells(foundation).some(cell =>
                building.tile.rx + cell.x === tile.rx && building.tile.ry + cell.y === tile.ry);
        }),
        getBridgeOnTile: () => undefined,
        getTileByMapCoords: (rx: number, ry: number) => tiles.get(`${rx},${ry}`),
    };
}

function makeBuildingArt(values: Record<string, string>): ObjectArt {
    const section = new IniSection("TestBuildingArt");
    Object.entries(values).forEach(([key, value]) => section.set(key, value));
    return new ObjectArt(
        ObjectType.Building,
        { imageName: "TestBuildingArt", numberOfDocks: 0 },
        section,
    );
}

function makeProjectileCollisionProbe(helper: CollisionHelper, subjectToBuildings?: boolean) {
    const projectile = Object.create(Projectile.prototype) as any;
    projectile.fromWeapon = { rules: { limboLaunch: false } };
    projectile.fromPlayer = {};
    projectile.rules = {
        subjectToBuildings,
        subjectToCliffs: false,
        subjectToWalls: false,
        subjectToFirestorm: false,
        subjectToTrenches: true,
        level: false,
        inaccurate: false,
    };
    projectile.collisionHelper = helper;
    projectile.isHoming = () => false;
    return projectile;
}

describe("Ares solid buildings", () => {
    test("parses SubjectToBuildings with the documented default", () => {
        const defaultRules = new ProjectileRules(ObjectType.Projectile, new IniSection("DefaultProjectile"));
        const enabledSection = new IniSection("SolidProjectile");
        enabledSection.set("SubjectToBuildings", "yes");
        const disabledSection = new IniSection("PassThroughProjectile");
        disabledSection.set("SubjectToBuildings", "no");

        expect(defaultRules.subjectToBuildings).toBe(false);
        expect(new ProjectileRules(ObjectType.Projectile, enabledSection).subjectToBuildings).toBe(true);
        expect(new ProjectileRules(ObjectType.Projectile, disabledSection).subjectToBuildings).toBe(false);
    });

    test("parses SolidHeight as safe integer cells and resolves minus one to full Height", () => {
        expect(makeBuildingArt({}).solidHeight).toBe(0);
        expect(makeBuildingArt({ SolidHeight: "3" }).solidHeight).toBe(3);
        expect(makeBuildingArt({ SolidHeight: "2.9" }).solidHeight).toBe(2);
        expect(makeBuildingArt({ SolidHeight: "-1", Height: "6" }).solidHeight).toBe(6);
        expect(makeBuildingArt({ SolidHeight: "-1" }).solidHeight).toBe(2);
        expect(makeBuildingArt({ SolidHeight: "0" }).solidHeight).toBe(0);
        expect(makeBuildingArt({ SolidHeight: "-2" }).solidHeight).toBe(0);
        expect(makeBuildingArt({ SolidHeight: "-1", Height: "-4" }).solidHeight).toBe(0);
    });

    test("blocks low paths while allowing paths above partial and full building heights", () => {
        const building = makeBuilding(1, "Solid", 2, 1, 2);
        const helper = new CollisionHelper(makeOccupation([building]));

        expect(helper.checkSolidBuildingCollisions(
            makeProjectilePosition(4, 1, 0.5),
            makeProjectilePosition(0, 1, 0.5),
        )).toEqual({ type: CollisionType.Wall, target: building });
        expect(helper.checkSolidBuildingCollisions(
            makeProjectilePosition(4, 1, 2),
            makeProjectilePosition(0, 1, 2),
        ).type).toBe(CollisionType.Wall);
        expect(helper.checkSolidBuildingCollisions(
            makeProjectilePosition(4, 1, 2.5),
            makeProjectilePosition(0, 1, 2.5),
        ).type).toBe(CollisionType.None);
    });

    test("uses every occupied foundation cell with partial solid height", () => {
        const foundation = { width: 3, height: 2 };
        const building = makeBuilding(1, "WideSolid", 1, 1, 1, foundation);
        const helper = new CollisionHelper(makeOccupation([building]));

        expect(helper.checkSolidBuildingCollisions(
            makeProjectilePosition(3, 2, 0.75),
            makeProjectilePosition(0, 2, 0.75),
        ).target).toBe(building);
        expect(helper.checkSolidBuildingCollisions(
            makeProjectilePosition(3, 2, 1.25),
            makeProjectilePosition(0, 2, 1.25),
        ).type).toBe(CollisionType.None);
    });

    test("detects a fast projectile crossing an intermediate building", () => {
        const building = makeBuilding(1, "TunnelingTarget", 2, 1, 2);
        const helper = new CollisionHelper(makeOccupation([building]));

        const result = helper.checkSolidBuildingCollisions(
            makeProjectilePosition(4, 1, 1, 0.9),
            makeProjectilePosition(0, 1, 1, 0.1),
        );

        expect(result).toEqual({ type: CollisionType.Wall, target: building });
    });

    test("covers corner-adjacent cells during a short fast diagonal step", () => {
        const building = makeBuilding(1, "DiagonalTarget", 1, 0, 2);
        const helper = new CollisionHelper(makeOccupation([building]));

        const result = helper.checkSolidBuildingCollisions(
            makeProjectilePosition(1, 1, 1, 0.1, 0.9),
            makeProjectilePosition(0, 0, 1, 0.9, 0.1),
        );

        expect(result).toEqual({ type: CollisionType.Wall, target: building });
    });

    test("uses elevation for arcing ascent and homing descent segments", () => {
        const building = makeBuilding(1, "TrajectorySolid", 2, 1, 2);
        const helper = new CollisionHelper(makeOccupation([building]));

        const arcingAscent = helper.checkSolidBuildingCollisions(
            makeProjectilePosition(4, 1, 3),
            makeProjectilePosition(0, 1, 0.25),
        );
        const homingDescent = helper.checkSolidBuildingCollisions(
            makeProjectilePosition(4, 1, 0.25),
            makeProjectilePosition(0, 1, 3),
        );

        expect(arcingAscent.target).toBe(building);
        expect(homingDescent.target).toBe(building);
    });

    test("routes the opt-in result through the existing wall collision flow", () => {
        const building = makeBuilding(1, "RoutedSolid", 2, 1, 2);
        const helper = new CollisionHelper(makeOccupation([building]));
        const projectile = makeProjectileCollisionProbe(helper, true);
        const game = {
            alliances: {
                areAllied: () => false,
            },
        };

        projectile.position = makeProjectilePosition(4, 1, 1);
        const result = projectile.checkObstacles(
            makeProjectilePosition(0, 1, 1),
            game,
        );

        expect(result).toEqual({ type: CollisionType.Wall, target: building });
    });

    test("leaves existing shore collision behavior active when the flag is absent", () => {
        const building = makeBuilding(1, "IgnoredSolid", 2, 1, 2);
        const helper = new CollisionHelper(makeOccupation([building]));
        const projectile = makeProjectileCollisionProbe(helper);
        projectile.rules.level = true;
        const game = {
            alliances: {
                areAllied: () => false,
            },
        };

        projectile.position = makeProjectilePosition(2, 1, 1);
        const result = projectile.checkObstacles(
            makeProjectilePosition(0, 1, 1),
            game,
        );

        expect(result.type).toBe(CollisionType.Shore);
    });

    test("does not collide with absent, zero, or invalid negative solid heights", () => {
        const buildings = [
            makeBuilding(1, "Absent", 1, 1, Number.NaN),
            makeBuilding(2, "Zero", 2, 1, 0),
            makeBuilding(3, "Negative", 3, 1, -2),
        ];
        const helper = new CollisionHelper(makeOccupation(buildings));

        const result = helper.checkSolidBuildingCollisions(
            makeProjectilePosition(5, 1, 0.5),
            makeProjectilePosition(0, 1, 0.5),
        );

        expect(result.type).toBe(CollisionType.None);
    });

    test("selects the first building in path order independently of query order", () => {
        const nearBuilding = makeBuilding(20, "Near", 1, 1, 2);
        const farBuilding = makeBuilding(3, "Far", 3, 1, 2);
        const oldPosition = makeProjectilePosition(0, 1, 1);
        const newPosition = makeProjectilePosition(4, 1, 1);
        const forward = new CollisionHelper(makeOccupation([nearBuilding, farBuilding]));
        const reverse = new CollisionHelper(makeOccupation([farBuilding, nearBuilding]));

        expect(forward.checkSolidBuildingCollisions(newPosition, oldPosition).target).toBe(nearBuilding);
        expect(reverse.checkSolidBuildingCollisions(newPosition, oldPosition).target).toBe(nearBuilding);
    });

    test("maps both fields to the implemented scanner and catalog capability", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[ProjectileTypes]
0=SolidProjectile

[SolidProjectile]
SubjectToBuildings=yes
`,
            },
            {
                name: "artmo.ini",
                contents: `
[SolidBuildingArt]
SolidHeight=-1
`,
            },
        ]);
        const usage = report.featureUsage.find(feature => feature.featureId === "ares.solid-buildings");
        const capability = getAresCapability("ares.solid-buildings");

        expect(usage?.occurrences).toBe(2);
        expect(usage?.definitionCount).toBe(2);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
        expect(report.unclassifiedKeys).toBe(0);
        expect(capability?.sourceDocuments).toContain("new/solidbuildings.rst");
        expect(capability?.parserStatus).toBe("complete");
        expect(capability?.runtimeStatus).toBe("complete");
        expect(capability?.tests).toContain("AresSolidBuildings.test.ts");
    });
});
