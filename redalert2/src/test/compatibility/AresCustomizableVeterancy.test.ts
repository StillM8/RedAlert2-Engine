import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import {
    createAresKillAttribution,
    parseAresVeterancyRules,
    resolveAresVeterancyRecipients,
} from "@/extensions/ares/AresVeterancy";
import { Game } from "@/game/Game";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { VeteranTrait } from "@/game/gameobject/trait/VeteranTrait";
import { NotifyTargetDestroy } from "@/game/trait/interface/NotifyTargetDestroy";
import { TechnoRules } from "@/game/rules/TechnoRules";

function player(name: string): any {
    return {
        name,
        isNeutral: false,
        isCombatant: () => true,
        addUnitsKilled() { },
        addUnitsLost() { },
        removeOwnedObject() { },
    };
}

function veteranRules() {
    return {
        veteranRatio: 1,
        veteranCap: VeteranLevel.Elite,
        veteranSpeed: 1,
        veteranArmor: 1,
        veteranCombat: 1,
        veteranROF: 1,
        veteranSight: 1,
    };
}

function techno(owner: any, rules: any, veteranLevel = VeteranLevel.None): any {
    const object: any = {
        owner,
        rules: {
            cost: 50,
            points: 0,
            dontScore: false,
            insignificant: false,
            trainable: true,
            veteranAbilities: new Set(),
            eliteAbilities: new Set(),
            ...rules,
        },
        type: ObjectType.Vehicle,
        isTechno: () => true,
        isBuilding: () => false,
        isInfantry: () => false,
        isVehicle: () => true,
        isSpawned: false,
        isDestroyed: false,
        isCrashing: false,
        limboData: {},
        healthTrait: { health: 100 },
        onDestroy() { },
        dispose() { },
    };
    const trait = new VeteranTrait(object, veteranRules());
    if (veteranLevel > VeteranLevel.None) {
        (trait as any).setVeteranLevel(veteranLevel);
    }
    object.veteranTrait = trait;
    Object.defineProperty(object, "veteranLevel", {
        get: () => (trait as any).veteranLevel,
    });
    object.traits = {
        filter(predicate: any) {
            return predicate === NotifyTargetDestroy ? [trait] : [];
        },
    };
    return object;
}

function gameFor(source: any, target: any): any {
    const game = Object.create(Game.prototype) as Game;
    game.rules = { general: { bountyEnablers: [] } };
    game.alliances = { areAllied: (a: any, b: any) => a === b };
    game.traits = { filter: () => [] };
    game.events = { dispatch: () => { } };
    game.areFriendly = (a: any, b: any) => a.owner === b.owner;
    return game;
}

function destroyTarget(game: any, source: any, target: any, extra: any = {}): void {
    game.destroyObject(target, {
        player: source.owner,
        obj: source,
        weapon: undefined,
        ...extra,
    });
}

function target(owner: any): any {
    return {
        owner,
        rules: { cost: 100, points: 0, dontScore: false, insignificant: false },
        veteranLevel: VeteranLevel.None,
        isTechno: () => true,
        isBuilding: () => false,
        isSpawned: false,
        isDestroyed: false,
        limboData: {},
        healthTrait: { health: 100 },
        traits: { filter: () => [] },
        onDestroy() { },
        dispose() { },
    };
}

describe("Ares customizable veterancy", () => {
    test("parses the MO-authored fields and preserves documented defaults", () => {
        const omitted = parseAresVeterancyRules(new IniSection("Vanilla"));
        expect(omitted).toEqual({
            fromAirstrike: false,
            promotePassengers: false,
            spawnOwnerModifier: 0,
            mindControlSelfModifier: 0,
        });

        const section = new IniSection("MOUnit");
        section.set("Experience.FromAirstrike", "100%");
        section.set("Experience.PromotePassengers", "yes");
        section.set("Experience.SpawnOwnerModifier", "75%");
        section.set("Experience.MindControlSelfModifier", "100%");
        expect(parseAresVeterancyRules(section)).toEqual({
            fromAirstrike: true,
            promotePassengers: true,
            spawnOwnerModifier: 0.75,
            mindControlSelfModifier: 1,
        });

        const rules = new TechnoRules(ObjectType.Vehicle, section, 0, {}, new ArmorRegistry());
        expect(rules.aresVeterancy).toEqual(parseAresVeterancyRules(section));
    });

    test("uses the actual Game.destroyObject path for airstrike designator credit", () => {
        const attacker = player("Attacker");
        const victim = player("Victim");
        const plane = techno(attacker, {});
        const designator = techno(attacker, {
            aresVeterancy: {
                fromAirstrike: true,
                promotePassengers: false,
                spawnOwnerModifier: 0,
                mindControlSelfModifier: 0,
            },
        });
        const dead = target(victim);
        const game = gameFor(plane, dead);

        destroyTarget(game, plane, dead, {
            aresAttribution: { airstrikeDesignator: designator },
        });

        expect(plane.veteranLevel).toBe(VeteranLevel.None);
        expect(designator.veteranLevel).toBe(VeteranLevel.Veteran);
    });

    test("redirects an elite gunner/open-topped kill to its passenger", () => {
        const attacker = player("Attacker");
        const victim = player("Victim");
        const vehicle = techno(attacker, {
            openTopped: true,
            aresVeterancy: {
                fromAirstrike: false,
                promotePassengers: true,
                spawnOwnerModifier: 0,
                mindControlSelfModifier: 0,
            },
        }, VeteranLevel.Elite);
        const passenger = techno(attacker, {});
        vehicle.openToppedTrait = { getPassenger: () => passenger };
        const dead = target(victim);
        const game = gameFor(vehicle, dead);

        destroyTarget(game, vehicle, dead);

        expect(vehicle.veteranLevel).toBe(VeteranLevel.Elite);
        expect(passenger.veteranLevel).toBe(VeteranLevel.Veteran);
    });

    test("adds spawn-owner experience without removing the spawn's normal credit", () => {
        const attacker = player("Attacker");
        const victim = player("Victim");
        const spawner = techno(attacker, {
            aresVeterancy: {
                fromAirstrike: false,
                promotePassengers: false,
                spawnOwnerModifier: 0.75,
                mindControlSelfModifier: 0,
            },
        });
        const spawn = techno(attacker, {});
        spawn.spawnLinkTrait = { getParent: () => spawner };
        const dead = target(victim);
        const game = gameFor(spawn, dead);

        destroyTarget(game, spawn, dead);

        expect(spawn.veteranLevel).toBe(VeteranLevel.Veteran);
        expect(spawner.veteranLevel).toBe(VeteranLevel.Veteran);
    });

    test("adds mind-controller experience and rejects allied captured-unit credit", () => {
        const controllerOwner = player("Controller");
        const originalOwner = player("Original");
        const victimOwner = player("Victim");
        const controller = techno(controllerOwner, {
            aresVeterancy: {
                fromAirstrike: false,
                promotePassengers: false,
                spawnOwnerModifier: 0,
                mindControlSelfModifier: 1,
            },
        });
        const captured = techno(controllerOwner, {});
        captured.mindControllableTrait = {
            getController: () => controller,
            getOriginalOwner: () => originalOwner,
        };
        const dead = target(victimOwner);
        const game = gameFor(captured, dead);

        destroyTarget(game, captured, dead);

        expect(captured.veteranLevel).toBe(VeteranLevel.Veteran);
        expect(controller.veteranLevel).toBe(VeteranLevel.Veteran);

        const alliedController = techno(controllerOwner, {
            aresVeterancy: {
                fromAirstrike: false,
                promotePassengers: false,
                spawnOwnerModifier: 0,
                mindControlSelfModifier: 1,
            },
        });
        const alliedCaptured = techno(controllerOwner, {});
        alliedCaptured.mindControllableTrait = {
            getController: () => alliedController,
            getOriginalOwner: () => controllerOwner,
        };
        const recipients = resolveAresVeterancyRecipients(
            createAresKillAttribution({ obj: alliedCaptured }),
            { areFriendly: (source, original) => source.owner === original.owner },
        );
        expect(recipients.map(recipient => recipient.object)).toEqual([alliedCaptured]);
    });

    test("honors Trainable=no for every attribution source", () => {
        const owner = player("Attacker");
        const victimOwner = player("Victim");
        const source = techno(owner, { trainable: false });
        const controller = techno(owner, {
            aresVeterancy: {
                fromAirstrike: false,
                promotePassengers: false,
                spawnOwnerModifier: 1,
                mindControlSelfModifier: 1,
            },
        });
        source.mindControllableTrait = {
            getController: () => controller,
            getOriginalOwner: () => player("Original"),
        };
        source.spawnLinkTrait = { getParent: () => controller };

        const dead = target(victimOwner);
        const game = gameFor(source, dead);
        destroyTarget(game, source, dead);
        const recipients = resolveAresVeterancyRecipients(
            createAresKillAttribution({ obj: source }),
            game,
        );
        expect(recipients).toEqual([]);
    });
});
