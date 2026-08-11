import { describe, expect, test } from "bun:test";
import { FlhCoords } from "@/game/art/FlhCoords";
import { IniSection } from "@/data/IniSection";
import { parseAresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";
import { NotifyUnspawn } from "@/game/gameobject/trait/interface/NotifyUnspawn";
import { Vector3 } from "@/game/math/Vector3";
import { Weapon } from "@/game/Weapon";
import { WeaponType } from "@/game/WeaponType";

function definition(values: Record<string, string> = {}) {
    const section = new IniSection("AttachEffectLifecycle");
    for (const [key, value] of Object.entries(values)) section.set(key, value);
    return parseAresAttachEffectDefinition(section);
}

describe("Ares AttachEffect lifecycle seams", () => {
    test("preserves InitialDelay across transport limbo and re-entry", () => {
        const trait = new AresAttachEffectTrait({
            automaticEffect: {
                effectId: "spawn-effect",
                definition: definition({
                    "AttachEffect.Duration": "2",
                    "AttachEffect.InitialDelay": "3",
                }),
            },
        });

        trait.spawn();
        trait.advance();
        expect(trait.getAutomaticSchedule()).toEqual({
            phase: "waiting-initial",
            remainingDelay: 2,
        });

        trait[NotifyUnspawn.onUnspawn]({ limboData: { inTransport: true } });
        trait[NotifySpawn.onSpawn]();

        expect(trait.getAutomaticSchedule()).toEqual({
            phase: "waiting-initial",
            remainingDelay: 2,
        });
        expect(trait.getState()).toEqual([]);
    });

    test("preserves renewal Delay across transport limbo and re-entry", () => {
        const trait = new AresAttachEffectTrait({
            automaticEffect: {
                effectId: "renewing-effect",
                definition: definition({
                    "AttachEffect.Duration": "1",
                    "AttachEffect.Delay": "2",
                }),
            },
        });

        trait.spawn();
        expect(trait.advance()).toMatchObject({
            expiredEffectIds: ["renewing-effect"],
        });
        expect(trait.getAutomaticSchedule()).toEqual({
            phase: "waiting-renewal",
            remainingDelay: 1,
        });

        trait[NotifyUnspawn.onUnspawn]({ limboData: { inTransport: true } });
        trait[NotifySpawn.onSpawn]();
        expect(trait.getAutomaticSchedule()).toEqual({
            phase: "waiting-renewal",
            remainingDelay: 1,
        });

        expect(trait.advance().automaticApply).toBeUndefined();
        expect(trait.getAutomaticSchedule().remainingDelay).toBe(0);
        expect(trait.advance().automaticApply?.decision).toBe("applied");
    });

    test("discards marked effects only for limbo entry and does not restart a discarded automatic effect", () => {
        const trait = new AresAttachEffectTrait({
            automaticEffect: {
                effectId: "spawn-effect",
                definition: definition({
                    "AttachEffect.Duration": "3",
                    "AttachEffect.DiscardOnEntry": "yes",
                    "AttachEffect.SpeedMultiplier": "0.5",
                }),
            },
        });
        trait.spawn();
        trait.apply("retained", definition({ "AttachEffect.Duration": "3" }));

        trait[NotifyUnspawn.onUnspawn]({ limboData: { inTransport: true } });

        expect(trait.getState()).toEqual([
            { effectId: "retained", remainingFrames: 3, discardOnEntry: false },
        ]);
        expect(trait.getAutomaticSchedule()).toEqual({ phase: "disabled", remainingDelay: 0 });
        trait[NotifySpawn.onSpawn]();
        expect(trait.getState()).toEqual([
            { effectId: "retained", remainingFrames: 3, discardOnEntry: false },
        ]);

        const ordinary = new AresAttachEffectTrait();
        ordinary.apply("marked", definition({
            "AttachEffect.Duration": "3",
            "AttachEffect.DiscardOnEntry": "yes",
        }));
        ordinary[NotifyUnspawn.onUnspawn]({});
        expect(ordinary.getState()).toEqual([
            { effectId: "marked", remainingFrames: 3, discardOnEntry: true },
        ]);
    });

    test("applies Ares ROF to aircraft burst inter-shot cooldowns", () => {
        const projectile = {
            position: {
                tile: {},
                tileElevation: 0,
                worldPosition: new Vector3(),
                moveToLeptons: () => undefined,
                moveByLeptons: () => undefined,
                moveByLeptons3: () => undefined,
            },
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
            crateBonuses: { firepower: 1 },
            aresAttachEffectTrait: {
                getAggregateMultipliers: () => ({ speed: 1, armor: 1, firepower: 1, rof: 0.5 }),
            },
            isBuilding: () => false,
            isUnit: () => false,
            isAircraft: () => true,
            isInfantry: () => false,
            isVehicle: () => false,
        } as any;
        const weapon = new Weapon(
            WeaponType.Primary,
            gameObject,
            {
                name: "AircraftWeapon",
                warhead: "TestWarhead",
                projectile: "TestProjectile",
                minimumRange: 0,
                range: 10,
                rof: 10,
                burst: 1,
                iniSpeed: 1,
            },
            { rules: {} } as any,
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

        weapon.fire({}, engine);

        expect(weapon.getCooldownTicks()).toBe(5);
    });
});
