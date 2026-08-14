import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import {
    chooseAresSplitTargetIndex,
    getAresAirburstCellOffsets,
    hasAresProjectileSplitBehavior,
    sortAresSplitCandidates,
    shouldRetargetAresSplit,
} from "@/extensions/ares/AresProjectileExtensions";
import { ProjectileRules } from "@/game/rules/ProjectileRules";
import { Projectile } from "@/game/gameobject/Projectile";

describe("Ares projectile Airburst/Splits", () => {
    test("normalizes Antares defaults and explicit projectile extension fields", () => {
        const section = new IniSection("UraganPunchesP");
        section.set("Airburst", "yes");
        section.set("AirburstWeapon", "UraganFragment");
        section.set("Cluster", "2");
        section.set("AirburstSpread", "3");
        section.set("AroundTarget", "yes");
        section.set("Splits", "yes");
        section.set("RetargetAccuracy", "80%");
        section.set("RetargetSelf", "no");
        section.set("Proximity", "no");
        section.set("AttachedSystem", "SpeederShotSys");

        const rules = new ProjectileRules(ObjectType.Projectile, section);

        expect(rules.airburst).toBe(true);
        expect(rules.airburstWeapon).toBe("UraganFragment");
        expect(rules.cluster).toBe(2);
        expect(rules.airburstSpread).toBe(3);
        expect(rules.aroundTarget).toBe(true);
        expect(rules.splits).toBe(true);
        expect(rules.retargetAccuracy).toBe(0.8);
        expect(rules.retargetSelf).toBe(false);
        expect(rules.proximity).toBe(false);
        expect(rules.attachedSystem).toBe("SpeederShotSys");
    });

    test("uses documented defaults when extension keys are absent", () => {
        const rules = new ProjectileRules(ObjectType.Projectile, new IniSection("PlainProjectile"));

        expect(rules.airburst).toBe(false);
        expect(rules.airburstWeapon).toBeUndefined();
        expect(rules.cluster).toBe(0);
        expect(rules.airburstSpread).toBe(1.5);
        expect(rules.aroundTarget).toBeUndefined();
        expect(rules.splits).toBe(false);
        expect(rules.retargetAccuracy).toBe(0);
        expect(rules.retargetSelf).toBe(true);
        expect(rules.attachedSystem).toBeUndefined();
        expect(rules.proximity).toBe(false);
    });

    test("Airburst cell pool is circular, includes the center, and is stable", () => {
        expect(getAresAirburstCellOffsets(0.5)).toEqual([{ x: 0, y: 0 }]);
        expect(getAresAirburstCellOffsets(1)).toEqual([
            { x: 0, y: 0 },
            { x: 0, y: -1 },
            { x: -1, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
        ]);
        expect(getAresAirburstCellOffsets(1.5)).toHaveLength(9);
    });

    test("Splits defaults to retargeting while explicit accuracy preserves the original target", () => {
        expect(hasAresProjectileSplitBehavior({ airburst: true, splits: false })).toBe(true);
        expect(hasAresProjectileSplitBehavior({ airburst: false, splits: true })).toBe(true);
        expect(hasAresProjectileSplitBehavior({ airburst: false, splits: false })).toBe(false);

        expect(shouldRetargetAresSplit(true, 0, 0.01)).toBe(true);
        expect(shouldRetargetAresSplit(true, 0.8, 0.5)).toBe(false);
        expect(shouldRetargetAresSplit(false, 1, 0)).toBe(true);
        expect(chooseAresSplitTargetIndex(4, 0)).toBe(0);
        expect(chooseAresSplitTargetIndex(4, 0.999)).toBe(3);
        expect(chooseAresSplitTargetIndex(0, 0.5)).toBe(-1);
    });

    test("sorts split candidates independently of QuadTree query order", () => {
        const candidates = [
            { id: 20, name: "Late", tile: { rx: 1, ry: 1 } },
            { id: 3, name: "Early", tile: { rx: 2, ry: 2 } },
        ];
        expect(sortAresSplitCandidates(candidates).map(candidate => candidate.id)).toEqual([3, 20]);
        expect(candidates.map(candidate => candidate.id)).toEqual([20, 3]);
    });

    test("runtime creates one child at the impact cell for a half-cell Airburst", () => {
        const projectile = Object.create(Projectile.prototype) as any;
        const impactTile = { rx: 4, ry: 7, z: 0 };
        const created: any[] = [];
        projectile.rules = {
            airburst: true,
            airburstWeapon: "TestAirburstWeapon",
            airburstSpread: 0.5,
            aroundTarget: false,
            splits: false,
        };
        projectile.target = { tile: impactTile };
        projectile.position = {
            tileElevation: 0,
            tile: impactTile,
            getMapPosition: () => ({ x: 0, y: 0, z: 0 }),
        };
        projectile.fromObject = undefined;
        projectile.fromPlayer = { id: "player" };

        const game = {
            rules: {
                getWeapon: () => ({ projectile: "TestAirburstProjectile", warhead: "TestWH" }),
                getProjectile: () => ({ name: "TestAirburstProjectile" }),
            },
            map: {
                tiles: {
                    getByMapCoords: (x: number, y: number) => x === impactTile.rx && y === impactTile.ry
                        ? impactTile
                        : undefined,
                },
            },
            generateRandomInt: () => 0,
            createTarget: (obj: any, tile: any) => ({ obj, tile }),
            createLooseProjectile: (_weapon: string, _player: any, target: any) => {
                const child: any = {
                    target,
                    position: {
                        tileElevation: 0,
                        tile: impactTile,
                        moveToLeptons: () => undefined,
                    },
                };
                created.push(child);
                return child;
            },
            spawnObject: (child: any, tile: any) => {
                child.spawnTile = tile;
            },
        };

        projectile.spawnAresProjectileChildren(game, impactTile);

        expect(created).toHaveLength(1);
        expect(created[0].target.tile).toBe(impactTile);
        expect(created[0].spawnTile).toBe(impactTile);
    });

    test("runtime creates the configured cluster for a Splits projectile", () => {
        const projectile = Object.create(Projectile.prototype) as any;
        const impactTile = { rx: 4, ry: 7, z: 0 };
        const created: any[] = [];
        projectile.rules = {
            airburst: false,
            airburstWeapon: "TestSplitWeapon",
            cluster: 2,
            aroundTarget: false,
            splits: true,
            retargetAccuracy: 0,
            retargetSelf: true,
        };
        projectile.target = { tile: impactTile };
        projectile.position = {
            worldPosition: { x: 0, y: 0, z: 0 },
            tileElevation: 0,
            tile: impactTile,
            getMapPosition: () => ({ x: 0, y: 0, z: 0 }),
        };
        projectile.tileOccupation = {};
        projectile.fromObject = undefined;
        projectile.fromPlayer = { id: "player" };

        const game = {
            rules: {
                getWeapon: () => ({ projectile: "TestSplitProjectile", warhead: "TestWH" }),
                getProjectile: () => ({ name: "TestSplitProjectile", isAntiAir: false }),
                getWarhead: () => ({}),
            },
            map: {
                tiles: {
                    getByMapCoords: (x: number, y: number) => x === impactTile.rx && y === impactTile.ry
                        ? impactTile
                        : undefined,
                },
                technosByTile: {
                    queryRange: () => [],
                },
            },
            generateRandom: () => 0.5,
            generateRandomInt: () => 0,
            createTarget: (obj: any, tile: any) => ({ obj, tile }),
            createLooseProjectile: (_weapon: string, _player: any, target: any) => {
                const child: any = {
                    target,
                    position: {
                        tileElevation: 0,
                        tile: impactTile,
                        moveToLeptons: () => undefined,
                    },
                };
                created.push(child);
                return child;
            },
            spawnObject: (child: any, tile: any) => {
                child.spawnTile = tile;
            },
        };

        projectile.spawnAresProjectileChildren(game, impactTile);

        expect(created).toHaveLength(2);
        expect(created.every((child) => child.target.tile === impactTile)).toBe(true);
        expect(created.every((child) => child.spawnTile === impactTile)).toBe(true);
    });
});
