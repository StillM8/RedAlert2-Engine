import { describe, expect, test } from "bun:test";
import { WeaponType } from "@/game/WeaponType";
import { Projectile } from "@/game/gameobject/Projectile";

function makeWarhead(canDamage: () => boolean = () => true) {
    const calls: any[] = [];
    return {
        calls,
        rules: {
            parasite: false,
            sonic: false,
            ivanBomb: false,
            bombDisarm: false,
            mindControl: false,
            isLocomotor: false,
            airstrike: false,
            psychedelic: false,
            temporal: false,
            makesDisguise: false,
            electricAssault: false,
            nukeMaker: false,
            shrapnelCount: 0,
        },
        canDamage,
        computeDamage: (damage: number) => damage,
        inflictDamage: (damage: number, occupant: any) => {
            calls.push({ damage, occupant });
            if (damage === Number.POSITIVE_INFINITY || damage >= occupant.healthTrait.health) {
                occupant.healthTrait.health = 0;
                occupant.isDestroyed = true;
            }
            else {
                occupant.healthTrait.health -= damage;
            }
        },
        detonate: (...args: any[]) => calls.push({ detonate: args }),
    };
}

function makeProjectile(targetObj: any, warhead: any): any {
    const projectile = Object.create(Projectile.prototype) as any;
    const tile = { rx: 3, ry: 4, z: 0 };
    projectile.fromWeapon = {
        type: WeaponType.Primary,
        rules: { damage: 10, limboLaunch: false },
        warhead,
    };
    projectile.fromPlayer = { id: "attacker" };
    projectile.fromObject = undefined;
    projectile.target = { obj: targetObj, tile };
    projectile.rules = { airburst: false, splits: false, subjectToTrenches: true };
    projectile.position = {
        worldPosition: { x: 0, y: 0, z: 0 },
        tile,
        tileElevation: 0,
    };
    projectile.baseDamageMultiplier = 1;
    projectile.veteranDamageMult = 1;
    projectile.isShrapnel = false;
    projectile.impactAnim = undefined;
    projectile.collisionHelper = { computeDetonationZone: () => 0 };
    projectile.state = 0;
    projectile.isPrismSupportBeam = () => false;
    return projectile;
}

function makeBuilding(withUrbanCombat: boolean): any {
    const occupant = {
        isDestroyed: false,
        healthTrait: { health: 100 },
    };
    const building: any = {
        rules: withUrbanCombat
            ? {
                aresUrbanCombat: {
                    passThrough: 1,
                    fatalRate: 0,
                    damageMultiplier: 2,
                },
            }
            : {},
        garrisonTrait: { units: [occupant] },
        isBuilding: () => true,
    };
    building.occupant = occupant;
    return building;
}

describe("Ares Urban Combat projectile hook", () => {
    test("uses the engine random stream, damages one occupant, and skips building detonation", () => {
        const warhead = makeWarhead();
        const building = makeBuilding(true);
        const projectile = makeProjectile(building, warhead);
        const randomValues = [0.1, 0.9];
        const game = {
            generateRandom: () => randomValues.shift()!,
            generateRandomInt: (min: number, max: number) => {
                expect([min, max]).toEqual([0, 0]);
                return 0;
            },
            destroyObject: (object: any) => {
                if (object === projectile) projectile.isDestroyed = true;
            },
            rules: { general: { prism: {} } },
        };

        projectile.detonate(game);

        expect(warhead.calls).toHaveLength(1);
        expect(warhead.calls[0].damage).toBe(20);
        expect(warhead.calls[0].occupant).toBe(building.occupant);
        expect(warhead.calls.some((call: any) => call.detonate)).toBe(false);
        expect(building.garrisonTrait.units).toHaveLength(1);
    });

    test("uses fatal damage and removes the killed occupant from the garrison", () => {
        const warhead = makeWarhead();
        const building = makeBuilding(true);
        building.rules.aresUrbanCombat.fatalRate = 1;
        const projectile = makeProjectile(building, warhead);
        const game = {
            generateRandom: () => 0,
            generateRandomInt: () => 0,
            destroyObject: (object: any) => {
                if (object === projectile) projectile.isDestroyed = true;
            },
            rules: { general: { prism: {} } },
        };

        projectile.detonate(game);

        expect(warhead.calls[0].damage).toBe(Number.POSITIVE_INFINITY);
        expect(building.garrisonTrait.units).toHaveLength(0);
        expect(warhead.calls.some((call: any) => call.detonate)).toBe(false);
    });

    test("follows Ares occupant pass-through even when ordinary building damage is gated", () => {
        const warhead = makeWarhead(() => false);
        const building = makeBuilding(true);
        const projectile = makeProjectile(building, warhead);
        const game = {
            generateRandom: () => 0,
            generateRandomInt: () => 0,
            destroyObject: (object: any) => {
                if (object === projectile) projectile.isDestroyed = true;
            },
            rules: { general: { prism: {} } },
        };

        projectile.detonate(game);

        expect(warhead.calls[0].damage).toBe(20);
        expect(warhead.calls[0].occupant).toBe(building.occupant);
        expect(warhead.calls.some((call: any) => call.detonate)).toBe(false);
    });

    test("preserves ordinary warhead detonation when optional Ares data is absent", () => {
        const warhead = makeWarhead();
        const building = makeBuilding(false);
        const projectile = makeProjectile(building, warhead);
        const game = {
            generateRandom: () => 0,
            generateRandomInt: () => 0,
            destroyObject: (object: any) => {
                if (object === projectile) projectile.isDestroyed = true;
            },
            rules: { general: { prism: {} } },
        };

        projectile.detonate(game);

        expect(warhead.calls.some((call: any) => call.detonate)).toBe(true);
        expect(warhead.calls.some((call: any) => call.occupant)).toBe(false);
        expect(building.garrisonTrait.units).toHaveLength(1);
    });
});
