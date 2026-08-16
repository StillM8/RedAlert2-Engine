import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import {
    advanceAresAnimationDamage,
    parseAresAnimationDamage,
} from "@/extensions/ares/AresAnimationDamage";
import { AresAnimationDamageRuntime } from "@/extensions/ares/AresAnimationDamageRuntime";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import { parseAresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import { Game } from "@/game/Game";
import { WarheadRules } from "@/game/rules/WarheadRules";
import { Vector3 } from "@/game/math/Vector3";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

function animation(values: Record<string, string>) {
    const section = new IniSection("AnimationDamage");
    for (const [key, value] of Object.entries(values)) section.set(key, value);
    return section;
}

function effect(values: Record<string, string>) {
    const section = new IniSection("AttachEffect");
    for (const [key, value] of Object.entries(values)) section.set(key, value);
    return parseAresAttachEffectDefinition(section);
}

describe("Ares animation damage", () => {
    test("parses Warhead, Weapon, and Damage.Delay from animation art", () => {
        const definition = parseAresAnimationDamage("PerunBolt", animation({
            Damage: "100",
            "Damage.Delay": "3",
            Warhead: "ElectricTank",
            Weapon: "PerunBoltWeapon",
        }));

        expect(definition).toEqual({
            name: "PerunBolt",
            damage: 100,
            damageDelay: 3,
            warhead: "ElectricTank",
            weapon: "PerunBoltWeapon",
            rate: 15,
            start: 0,
            end: 0,
            loopStart: 0,
            loopEnd: 0,
            loopCount: 1,
            reverse: false,
        });
    });

    test("waits for the authored delay and then delivers full damage", () => {
        const definition = parseAresAnimationDamage("Delayed", animation({
            Damage: "100",
            "Damage.Delay": "2",
        }))!;

        const first = advanceAresAnimationDamage(definition);
        expect(first).toEqual({ state: { accumulator: 1 }, damage: 0 });
        expect(advanceAresAnimationDamage(definition, first.state)).toEqual({
            state: { accumulator: 0 },
            damage: 100,
        });
    });

    test("spends fractional damage without a delay", () => {
        const definition = parseAresAnimationDamage("Fractional", animation({ Damage: "0.5" }))!;
        const first = advanceAresAnimationDamage(definition);
        expect(first).toEqual({ state: { accumulator: 0.5 }, damage: 0 });
        expect(advanceAresAnimationDamage(definition, first.state)).toEqual({
            state: { accumulator: 0 },
            damage: 1,
        });
    });

    test("runs standalone animation damage for each animation frame and expires at End", () => {
        const definition = parseAresAnimationDamage("Standalone", animation({
            Damage: "10",
            End: "1",
            Rate: "900",
            Warhead: "Fire2",
        }))!;
        const runtime = new AresAnimationDamageRuntime();
        const deliveries: any[] = [];
        runtime.spawn({
            definition,
            tile: { rx: 1, ry: 1, z: 0 },
            position: { x: 384, y: 0, z: 384 },
            elevation: 0,
            zone: ZoneType.Ground,
        });

        runtime.update({ applyAresAnimationDamageArea: (request) => deliveries.push(request) });
        expect(deliveries.map((request) => request.damage)).toEqual([10]);
        expect(runtime.getActiveCount()).toBe(1);

        runtime.update({ applyAresAnimationDamageArea: (request) => deliveries.push(request) });
        expect(deliveries.map((request) => request.damage)).toEqual([10, 10]);
        expect(runtime.getActiveCount()).toBe(0);
    });

    test("measures standalone Damage.Delay in animation frames", () => {
        const definition = parseAresAnimationDamage("DelayedStandalone", animation({
            Damage: "3",
            "Damage.Delay": "2",
            End: "2",
        }))!;
        const runtime = new AresAnimationDamageRuntime();
        const damages: number[] = [];
        runtime.spawn({
            definition,
            tile: { rx: 1, ry: 1, z: 0 },
            position: { x: 384, y: 0, z: 384 },
            elevation: 0,
            zone: ZoneType.Ground,
        });

        runtime.update({ applyAresAnimationDamageArea: (request) => damages.push(request.damage) });
        expect(damages).toEqual([]);
        runtime.update({ applyAresAnimationDamageArea: (request) => damages.push(request.damage) });
        expect(damages).toEqual([3]);
    });

    test("runs residual damage through an attached effect until its last frame", () => {
        const target: any = {
            isDestroyed: false,
            isCrashing: false,
            cloakableTrait: { isCloaked: () => false },
            warpedOutTrait: { isActive: () => false },
        };
        const animationArt = animation({ Damage: "25", Warhead: "Fire2" });
        const requests: any[] = [];
        const context = {
            art: { getAnimation: () => ({ art: animationArt }) },
            applyAresAnimationDamage: (request: any) => requests.push(request),
        };
        const trait = new AresAttachEffectTrait({ gameObject: target });
        trait.apply("burn", effect({
            "AttachEffect.Animation": "BurnAnim",
            "AttachEffect.Duration": "2",
        }), { context });

        trait.advance({ context });
        trait.advance({ context });
        expect(requests).toHaveLength(2);
        expect(requests.map(request => request.damage)).toEqual([25, 25]);
        expect(requests.every(request => request.animation.warhead === "Fire2")).toBe(true);
        expect(trait.getState()).toEqual([]);
    });

    test("suppresses and resets animation damage while cloaked", () => {
        let cloaked = true;
        const requests: any[] = [];
        const target: any = {
            isDestroyed: false,
            isCrashing: false,
            cloakableTrait: { isCloaked: () => cloaked },
            warpedOutTrait: { isActive: () => false },
        };
        const context = {
            art: { getAnimation: () => ({ art: animation({ Damage: "1" }) }) },
            applyAresAnimationDamage: (request: any) => requests.push(request),
        };
        const trait = new AresAttachEffectTrait({ gameObject: target });
        trait.apply("cloak-burn", effect({
            "AttachEffect.Animation": "BurnAnim",
            "AttachEffect.Duration": "3",
        }), { context });

        trait.advance({ context });
        cloaked = false;
        trait.advance({ context });
        expect(requests).toHaveLength(1);
        expect(requests[0].damage).toBe(1);
    });

    test("uses the normal Warhead damage path for one animation damage step", () => {
        const tile: any = { rx: 1, ry: 1, z: 0 };
        const owner: any = { isCombatant: () => true };
        const target: any = {
            tile,
            zone: ZoneType.Ground,
            owner,
            position: { worldPosition: new Vector3(1.5 * 256, 0, 1.5 * 256) },
            rules: {
                armor: 5,
                wall: false,
                immune: false,
                invisibleInGame: false,
                typeImmune: false,
                immuneToRadiation: false,
                immuneToPsionics: false,
            },
            crateBonuses: { armor: 1 },
            moveTrait: { reservedPathNodes: [] },
            invulnerableTrait: { isActive: () => false },
            warpedOutTrait: { isInvulnerable: () => false },
            healthTrait: {
                health: 100,
                getHitPoints: () => 100,
                inflictDamage(amount: number) {
                    this.health -= amount;
                },
            },
            isSpawned: true,
            isDisposed: false,
            isDestroyed: false,
            isCrashing: false,
            isTechno: () => true,
            isUnit: () => true,
            isBuilding: () => false,
            isInfantry: () => false,
            isAircraft: () => false,
            isVehicle: () => true,
            isOverlay: () => false,
            isTerrain: () => false,
            isBridge: () => false,
            onAttack: () => undefined,
            applyRocking: () => undefined,
        };
        const warheadSection = new IniSection("Fire2");
        warheadSection.set("Verses", "1,1,1,1,1,100%");
        const game: any = {
            rules: {
                getWarhead: () => new WarheadRules(warheadSection),
                combatDamage: { c4Warhead: "Fire2", flameDamage2: "Fire2" },
            },
            map: {
                tiles: { getByMapCoords: () => tile },
                mapBounds: { isWithinBounds: () => true },
                tileOccupation: {},
                getObjectsOnTile: () => [target],
            },
            alliances: { areAllied: () => false },
            gameOpts: { destroyableBridges: true },
            traits: { filter: () => [] },
            events: { dispatch: () => undefined },
            mapRadiationTrait: { createRadSite: () => undefined },
            destroyObject: () => undefined,
            generateRandomInt: () => 0,
            createTarget: () => ({ obj: target, getBridge: () => undefined }),
        };

        game.resolveAresAnimationDamageDelivery = (Game.prototype as any).resolveAresAnimationDamageDelivery;
        Game.prototype.applyAresAnimationDamage.call(game, {
            target,
            animation: { name: "Residual", warhead: "Fire2" },
            damage: 25,
            sourcePlayer: owner,
        });

        expect(target.healthTrait.health).toBe(75);

        target.healthTrait.health = 100;
        Game.prototype.applyAresAnimationDamageArea.call(game, {
            definition: parseAresAnimationDamage("Standalone", animation({
                Damage: "25",
                Warhead: "Fire2",
            }))!,
            tile,
            position: target.position.worldPosition,
            elevation: 0,
            zone: ZoneType.Ground,
            damage: 25,
        });

        expect(target.healthTrait.health).toBe(75);
    });
});
