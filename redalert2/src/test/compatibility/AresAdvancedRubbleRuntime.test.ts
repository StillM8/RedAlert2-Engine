import { describe, expect, test } from "bun:test";
import { AresAdvancedRubbleTrait } from "@/game/gameobject/trait/AresAdvancedRubbleTrait";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { ObjectType } from "@/engine/type/ObjectType";

function replacement(name: string, foundation: any = { width: 1, height: 1 }): any {
    const rules = {
        name,
        capturable: true,
        togglePower: true,
        unsellable: false,
        canBeOccupied: true,
    };
    return {
        name,
        rules,
        art: { foundation },
        owner: undefined,
        garrisonTrait: { marker: true },
        traits: { remove: () => undefined },
        poweredTrait: { setTurnedOn: () => undefined },
        healthTrait: {
            health: 100,
            maxHitPoints: 500,
            setHitPoints(value: number) { this.hitPoints = value; },
        },
        dispose: () => undefined,
    };
}

function source(owner: any, urban: any, foundation: any = { width: 1, height: 1 }): any {
    return {
        name: "SOURCE",
        owner,
        art: { foundation },
        isSpawned: true,
        isDestroyed: false,
        rules: { aresUrbanCombat: urban },
        tile: { rx: 4, ry: 5 },
        position: { worldPosition: { clone: () => ({ x: 1, y: 2, z: 3 }) } },
        dispose: () => undefined,
    };
}

describe("Ares Advanced Rubble runtime", () => {
    test("destruction replaces a LeaveRubble shell after the destroy transaction", () => {
        const defender = { id: "defender" };
        const old = source(defender, {
            rubbleDestroyed: {
                target: "RUBBLE",
                remove: false,
                owner: "default",
                strength: 0,
                animation: "RUBBLEFX",
            },
        });
        const created = replacement("RUBBLE");
        let afterTick: (() => void) | undefined;
        let unspawned = 0;
        let spawned: any;
        const events: any[] = [];
        const world: any = {
            afterTick: (callback: () => void) => { afterTick = callback; },
            unspawnObject: (obj: any) => { obj.isSpawned = false; unspawned++; },
            rules: { hasObject: (name: string, type: ObjectType) => name === "RUBBLE" && type === ObjectType.Building },
            createObject: () => created,
            changeObjectOwner: (obj: any, owner: any) => { obj.owner = owner; },
            spawnObject: (obj: any, tile: any) => { spawned = { obj, tile }; },
            events: { dispatch: (event: any) => events.push(event) },
        };

        new AresAdvancedRubbleTrait()[NotifyDestroy.onDestroy](old, world);
        expect(afterTick).toBeDefined();
        afterTick!();

        expect(unspawned).toBe(1);
        expect(spawned.obj).toBe(created);
        expect(spawned.tile).toBe(old.tile);
        expect(created.owner).toBe(defender);
        expect(created.rules.capturable).toBe(false);
        expect(created.rules.togglePower).toBe(false);
        expect(created.rules.unsellable).toBe(true);
        expect(created.rules.canBeOccupied).toBe(false);
        expect(created.garrisonTrait).toBeUndefined();
        expect(created._buildStatus).toBe(1);
        expect(created.lastBuildStatus).toBe(1);
        expect(events).toHaveLength(1);
    });

    test("engineer repair restores the intact type at one-percent health without consuming the engineer", () => {
        const defender = { id: "defender" };
        const rubble = source(defender, {
            rubbleIntact: {
                target: "INTACT",
                remove: false,
                owner: "default",
                strength: -1,
            },
        });
        const intact = replacement("INTACT");
        let unspawned = 0;
        let spawned = 0;
        const engineer = { owner: { id: "engineer-owner" }, isSpawned: true };
        const world: any = {
            unspawnObject: (obj: any) => { obj.isSpawned = false; unspawned++; },
            rules: { hasObject: (name: string) => name === "INTACT" },
            createObject: () => intact,
            changeObjectOwner: (obj: any, owner: any) => { obj.owner = owner; },
            spawnObject: () => { spawned++; },
            events: { dispatch: () => undefined },
        };
        const trait = new AresAdvancedRubbleTrait();
        const restored = trait.repairWithEngineer(rubble, engineer, world);

        expect(restored).toBe(intact);
        expect(unspawned).toBe(1);
        expect(spawned).toBe(1);
        expect(intact.healthTrait.health).toBe(1);
        expect(intact._buildStatus).toBe(1);
        expect(engineer.isSpawned).toBe(true);
        expect(intact.owner).toBe(defender);
    });

    test("custom and built-in foundations never match even with the same rectangle", () => {
        const rubble = source({ id: "defender" }, {
            rubbleIntact: {
                target: "INTACT",
                remove: false,
                owner: "default",
                strength: -1,
            },
        }, {
            width: 1,
            height: 1,
            custom: true,
            cells: [{ x: 0, y: 0 }],
        });
        const intact = replacement("INTACT", { width: 1, height: 1 });
        let unspawned = 0;
        const world: any = {
            unspawnObject: () => { unspawned++; },
            rules: { hasObject: () => true },
            createObject: () => intact,
        };

        expect(() => new AresAdvancedRubbleTrait().repairWithEngineer(rubble, {}, world)).toThrow(
            /foundation mismatch/i,
        );
        expect(unspawned).toBe(0);
        expect(rubble.isSpawned).toBe(true);
    });

    test("different custom occupied-cell sets are rejected atomically", () => {
        const rubble = source({ id: "defender" }, {
            rubbleIntact: {
                target: "INTACT",
                remove: false,
                owner: "default",
                strength: -1,
            },
        }, {
            width: 2,
            height: 2,
            custom: true,
            cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        });
        const intact = replacement("INTACT", {
            width: 2,
            height: 2,
            custom: true,
            cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
        });
        let unspawned = 0;
        const world: any = {
            unspawnObject: () => { unspawned++; },
            rules: { hasObject: () => true },
            createObject: () => intact,
        };
        expect(() => new AresAdvancedRubbleTrait().repairWithEngineer(rubble, {}, world)).toThrow();
        expect(unspawned).toBe(0);
    });

    test("Rubble.*.Remove performs only cleanup/animation and creates no replacement", () => {
        const old = source({ id: "owner" }, {
            rubbleDestroyed: {
                target: "RUBBLE",
                remove: true,
                owner: "default",
                strength: 0,
                animation: "REMOVEFX",
            },
        });
        let afterTick: (() => void) | undefined;
        let creates = 0;
        const events: any[] = [];
        const world: any = {
            afterTick: (callback: () => void) => { afterTick = callback; },
            unspawnObject: (obj: any) => { obj.isSpawned = false; },
            rules: { hasObject: () => true },
            createObject: () => { creates++; return replacement("RUBBLE"); },
            events: { dispatch: (event: any) => events.push(event) },
        };
        new AresAdvancedRubbleTrait()[NotifyDestroy.onDestroy](old, world);
        afterTick!();
        expect(creates).toBe(0);
        expect(events).toHaveLength(1);
    });
});
