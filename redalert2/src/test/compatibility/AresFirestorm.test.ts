import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import {
    applyAresFirestormWallDamage,
    getAresFirestormConnectionMask,
    findAresActiveFirestormWall,
    isAresActiveFirestormWall,
    setAresFirestormActive,
} from "@/extensions/ares/AresFirestorm";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { CollisionHelper } from "@/game/gameobject/unit/CollisionHelper";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { SuperWeapon, SuperWeaponStatus } from "@/game/SuperWeapon";
import { ProjectileRules } from "@/game/rules/ProjectileRules";
import { TechnoRules } from "@/game/rules/TechnoRules";
import { ObjectType } from "@/engine/type/ObjectType";

function makeWall(owner: any): any {
    return {
        owner,
        rules: { firestormWall: true },
        isDestroyed: false,
        isOverlay: () => false,
        isBuilding: () => true,
        isTechno: () => true,
    };
}

describe("Ares Firestorm wall", () => {
    test("parses Firestorm.Wall and SubjectToFirestorm with the documented default", () => {
        const wallSection = new IniSection("FirewallBuilding");
        wallSection.set("Firestorm.Wall", "yes");
        const wallRules = new TechnoRules(ObjectType.Building, wallSection, 0, {}, new ArmorRegistry());

        const projectileSection = new IniSection("NormalProjectile");
        const projectileRules = new ProjectileRules(ObjectType.Projectile, projectileSection);
        const immuneSection = new IniSection("ImmuneProjectile");
        immuneSection.set("SubjectToFirestorm", "no");
        const immuneRules = new ProjectileRules(ObjectType.Projectile, immuneSection);

        expect(wallRules.firestormWall).toBe(true);
        expect(projectileRules.subjectToFirestorm).toBe(true);
        expect(immuneRules.subjectToFirestorm).toBe(false);
    });

    test("tracks activation per owner and ignores only the firing owner's wall", () => {
        const firingOwner = {};
        const enemyOwner = {};
        const ownWall = makeWall(firingOwner);
        const enemyWall = makeWall(enemyOwner);
        setAresFirestormActive(firingOwner, true);
        setAresFirestormActive(enemyOwner, true);

        expect(isAresActiveFirestormWall(ownWall, firingOwner)).toBe(false);
        expect(isAresActiveFirestormWall(enemyWall, firingOwner)).toBe(true);
        expect(findAresActiveFirestormWall({ id: 1 }, firingOwner, {
            getObjectsOnTile: () => [ownWall, enemyWall],
        })).toBe(enemyWall);

        setAresFirestormActive(enemyOwner, false);
        expect(isAresActiveFirestormWall(enemyWall, firingOwner)).toBe(false);
    });

    test("connects only orthogonal live walls owned by the same player", () => {
        const owner = {};
        const otherOwner = {};
        const center = { rx: 2, ry: 2 };
        const east = { rx: 3, ry: 2 };
        const south = { rx: 2, ry: 3 };
        const north = { rx: 2, ry: 1 };
        const walls = new Map([
            ["3,2", makeWall(owner)],
            ["2,3", makeWall(owner)],
            ["2,1", makeWall(otherOwner)],
        ]);
        const centerWall = { ...makeWall(owner), tile: center };
        for (const [key, wall] of walls) {
            (wall as any).tile = key === "3,2" ? east : key === "2,3" ? south : north;
        }
        const map = {
            getTileByMapCoords: (x: number, y: number) => ({ rx: x, ry: y }),
            getObjectsOnTile: (tile: any) => [walls.get(`${tile.rx},${tile.ry}`)].filter(Boolean),
        };

        expect(getAresFirestormConnectionMask(centerWall, map)).toBe(0b0110);
    });

    test("intercepts a projectile through the normal collision service even when ordinary walls are disabled", () => {
        const firingOwner = {};
        const enemyOwner = {};
        setAresFirestormActive(enemyOwner, true);
        const wall = makeWall(enemyOwner);
        const tile = { landType: 0, terrainType: 0, z: 0 };
        const occupation = {
            getObjectsOnTile: () => [wall],
            getBridgeOnTile: () => undefined,
        };
        const helper = new CollisionHelper(occupation);

        const result = helper.checkCollisions(
            { tile, tileElevation: 0 },
            { tile, tileElevation: 0 },
            { walls: false, firestorm: object => isAresActiveFirestormWall(object, firingOwner) },
        );

        expect(result.type).toBe(CollisionType.Wall);
        expect(result.target).toBe(wall);
    });

    test("finds a Firestorm wall anywhere along a fast projectile path", () => {
        const firingOwner = {};
        const enemyOwner = {};
        setAresFirestormActive(enemyOwner, true);
        const wall = makeWall(enemyOwner);
        const tiles = new Map([
            ["0,0", { rx: 0, ry: 0, landType: 0, terrainType: 0, z: 0 }],
            ["1,0", { rx: 1, ry: 0, landType: 0, terrainType: 0, z: 0 }],
            ["2,0", { rx: 2, ry: 0, landType: 0, terrainType: 0, z: 0 }],
        ]);
        const wallTile = tiles.get("1,0")!;
        const helper = new CollisionHelper({
            getObjectsOnTile: (tile: any) => tile === wallTile ? [wall] : [],
            getBridgeOnTile: () => undefined,
            getTileByMapCoords: (x: number, y: number) => tiles.get(`${x},${y}`),
        });

        const result = helper.checkCollisions(
            { tile: tiles.get("2,0"), tileElevation: 0 },
            { tile: tiles.get("0,0"), tileElevation: 0 },
            { walls: false, firestorm: object => isAresActiveFirestormWall(object, firingOwner) },
        );

        expect(result.type).toBe(CollisionType.Wall);
        expect(result.target).toBe(wall);
    });

    test("Firestorm charge-drain activation exposes and clears owner state", () => {
        const owner: any = { credits: 0 };
        const weapon = new SuperWeapon("Firewall", {
            rechargeTime: 1,
            ares: {
                extensionType: "Firestorm",
                useChargeDrain: true,
                extensionEntries: new Map(),
            },
        }, owner);
        weapon.rechargeTicks = 4;
        weapon.chargeTicks = 0;
        weapon.status = SuperWeaponStatus.Ready;

        expect(weapon.startChargeDrain(1)).toBe(true);
        expect(owner.aresFirestormActive).toBe(true);
        expect(weapon.deactivateChargeDrain()).toBe(true);
        expect(owner.aresFirestormActive).toBe(false);
    });

    test("wall damage shortens active charge without damaging the wall", () => {
        const owner: any = { credits: 100 };
        const weapon = new SuperWeapon("Firewall", {
            rechargeTime: 1,
            ares: {
                extensionType: "Firestorm",
                useChargeDrain: true,
                extensionEntries: new Map(),
            },
        }, owner);
        owner.superWeaponsTrait = { getAll: () => [weapon] };
        weapon.rechargeTicks = 100;
        weapon.chargeTicks = 0;
        weapon.status = SuperWeaponStatus.Ready;
        expect(weapon.startChargeDrain(1)).toBe(true);

        const wall = makeWall(owner);
        const before = weapon.chargeTicks;
        expect(applyAresFirestormWallDamage(wall, 10, 2)).toBe(true);
        expect(weapon.chargeTicks).toBe(before - 20);
    });

    test("scanner reports Firestorm wall fields as a distinct capability", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: `
[FirewallBuilding]
Firestorm.Wall=yes

[FirestormProjectile]
SubjectToFirestorm=no
`,
        }]);
        const usage = report.featureUsage.find(item => item.featureId === "ares.firestorm-wall");

        expect(usage?.occurrences).toBe(2);
        expect(usage?.definitionCount).toBe(2);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
        expect(report.unknownExtensionKeys).toBe(0);
    });
});
