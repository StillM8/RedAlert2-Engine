import { describe, expect, test } from "bun:test";
import { FlhCoords } from "@/game/art/FlhCoords";
import { MoveTrait } from "@/game/gameobject/trait/MoveTrait";
import { ArmorType } from "@/game/type/ArmorType";
import { Vector3 } from "@/game/math/Vector3";
import { Warhead } from "@/game/Warhead";
import { Weapon } from "@/game/Weapon";
import { WeaponType } from "@/game/WeaponType";

function aresTrait(aggregate: Record<string, number>) {
    return {
        getAggregateMultipliers: () => Object.freeze({ ...aggregate }),
    };
}

describe("Ares AttachEffect gameplay callsites", () => {
    test("applies speed after vanilla veterancy, crate, health, and penalty factors", () => {
        const gameObject = {
            rules: { speed: 10, locomotor: "Drive" },
            veteranTrait: { getVeteranSpeedMultiplier: () => 1.2 },
            crateBonuses: { speed: 0.9 },
            healthTrait: { health: 100 },
            aresAttachEffectTrait: aresTrait({ speed: 0.5 }),
            isVehicle: () => false,
        } as any;
        const moveTrait = new MoveTrait(gameObject, {} as any);

        expect(moveTrait.baseSpeed).toBe(5.4);
        expect(gameObject.crateBonuses.speed).toBe(0.9);
    });

    test("applies ROF after vanilla passenger and veterancy calculations", () => {
        const gameObject = {
            rules: { distributedFire: false, radialFireSegments: 0 },
            veteranTrait: { getVeteranRofMultiplier: () => 1.5 },
            aresAttachEffectTrait: aresTrait({ rof: 0.4 }),
            isBuilding: () => true,
            isVehicle: () => true,
            openToppedTrait: { getArmedPassengerCount: () => 2 },
        } as any;
        const weapon = new Weapon(
            WeaponType.Primary,
            gameObject,
            {
                name: "TestWeapon",
                warhead: "TestWarhead",
                projectile: "TestProjectile",
                minimumRange: 0,
                range: 10,
                rof: 100,
                burst: 1,
                iniSpeed: 1,
            },
            { rules: {} } as Warhead,
            { iniRot: 1 },
            new FlhCoords(),
            {} as any,
        );

        expect(weapon.rof).toBe(30);
    });

    test("combines firepower with the caller damage multiplier and crate bonus", () => {
        const projectilePosition = {
            tile: {},
            tileElevation: 0,
            worldPosition: new Vector3(),
            moveToLeptons: () => undefined,
            moveByLeptons: () => undefined,
            moveByLeptons3: () => undefined,
        };
        const projectile = {
            position: projectilePosition,
            tileElevation: 0,
            isAircraft: () => false,
        } as any;
        const gameObject = {
            rules: {
                distributedFire: false,
                radialFireSegments: 0,
                fighter: false,
                turretAnim: false,
            },
            position: {
                tileElevation: 0,
                getMapPosition: () => ({}),
            },
            direction: 0,
            art: { turretOffset: 0 },
            tile: {},
            tileElevation: 0,
            crateBonuses: { firepower: 1.5 },
            aresAttachEffectTrait: aresTrait({ firepower: 1.25 }),
            isBuilding: () => false,
            isUnit: () => true,
            isAircraft: () => false,
            isInfantry: () => false,
            isVehicle: () => false,
        } as any;
        const weapon = new Weapon(
            WeaponType.Primary,
            gameObject,
            {
                name: "TestWeapon",
                warhead: "TestWarhead",
                projectile: "TestProjectile",
                minimumRange: 0,
                range: 10,
                rof: 10,
                burst: 1,
                iniSpeed: 1,
            },
            { rules: {} } as Warhead,
            { iniRot: 1 },
            new FlhCoords(),
            {} as any,
        );
        const engine = {
            map: { isWithinHardBounds: () => true },
            events: { dispatch: () => undefined },
            createProjectile: () => projectile,
            spawnObject: () => undefined,
            generateRandomInt: () => 4,
        } as any;

        weapon.fire({}, engine, 2);

        expect(projectile.baseDamageMultiplier).toBe(3.75);
        expect(gameObject.crateBonuses.firepower).toBe(1.5);
    });

    test("applies target armor after vanilla verses, veterancy, and crate armor", () => {
        const target = {
            rules: { armor: ArmorType.Heavy, wall: false },
            invulnerableTrait: { isActive: () => false },
            veteranTrait: { getVeteranArmorMultiplier: () => 2 },
            crateBonuses: { armor: 2 },
            aresAttachEffectTrait: aresTrait({ armor: 1.5 }),
            isTechno: () => true,
            isUnit: () => true,
            isInfantry: () => false,
            isAircraft: () => false,
            isOverlay: () => false,
            isTerrain: () => false,
            isBuilding: () => false,
        } as any;
        const warhead = new Warhead({
            radiation: false,
            temporal: false,
            proneDamage: 1,
            verses: new Map([[ArmorType.Heavy, 1]]),
            wall: false,
        } as any);

        const damage = warhead.computeDamage(100, target, {
            gameOpts: { destroyableBridges: true },
        } as any);

        expect(damage).toBe(16);
        expect(target.crateBonuses.armor).toBe(2);
    });

    test("keeps neutral behavior when no AttachEffect trait is present", () => {
        const target = {
            rules: { armor: ArmorType.Heavy, wall: false },
            invulnerableTrait: { isActive: () => false },
            crateBonuses: { armor: 2 },
            isTechno: () => true,
            isUnit: () => true,
            isInfantry: () => false,
            isAircraft: () => false,
            isOverlay: () => false,
            isTerrain: () => false,
            isBuilding: () => false,
        } as any;
        const warhead = new Warhead({
            radiation: false,
            temporal: false,
            proneDamage: 1,
            verses: new Map([[ArmorType.Heavy, 1]]),
            wall: false,
        } as any);

        expect(warhead.computeDamage(100, target, {
            gameOpts: { destroyableBridges: true },
        } as any)).toBe(50);
    });
});
