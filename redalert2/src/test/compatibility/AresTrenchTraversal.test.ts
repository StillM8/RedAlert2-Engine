import { describe, expect, test } from "bun:test";
import { canAresTrenchTraverse } from "@/extensions/ares/AresUrbanCombatRuntime";
import { GarrisonTrait } from "@/game/gameobject/trait/GarrisonTrait";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { OccupyOrder } from "@/game/order/OccupyOrder";
import { PointerType } from "@/engine/type/PointerType";

function player(id: string): any {
    return { id, isNeutral: false, buildingsCaptured: 0 };
}

function building(id: string, owner: any, rx: number, ry: number, trench = "1", capacity = 5): any {
    const result: any = {
        id,
        name: id,
        owner,
        tile: { rx, ry, z: 0 },
        isSpawned: true,
        isDestroyed: false,
        rules: {
            canBeOccupied: true,
            maxNumberOccupants: capacity,
            aresUrbanCombat: {
                isTrench: trench,
                bunkerRaidable: false,
                canBeOccupiedBy: [],
            },
            occupantsPowerBonus: 0,
            power: 0,
            primary: undefined,
        },
        healthTrait: { health: 100 },
        art: { foundation: { width: 1, height: 1 } },
        isBuilding: () => true,
        addTrait: () => undefined,
    };
    result.garrisonTrait = new GarrisonTrait(result, 0.25, capacity);
    return result;
}

function occupant(id: string, owner: any): any {
    const result: any = {
        id,
        name: id,
        owner,
        rules: { name: id, occupier: true, slaved: false },
        addTrait(trait: any) { this.aresGarrisonOccupantTrait = trait; },
        getHash: () => id.charCodeAt(0),
        debugGetState: () => ({ id }),
    };
    return result;
}

function game(): any {
    return {
        rules: {},
        map: { tiles: {}, tileOccupation: {} },
        areFriendly: (left: any, right: any) => left.owner === right.owner,
        changeObjectOwner: (obj: any, owner: any) => { obj.owner = owner; },
    };
}

describe("Ares IsTrench traversal", () => {
    test("matches Ares origin-cell adjacency: cardinal yes, diagonal no", () => {
        const owner = player("p1");
        const source = building("A", owner, 5, 5);
        const cardinal = building("B", owner, 6, 5);
        const diagonal = building("C", owner, 6, 6);
        source.garrisonTrait.addOccupant(occupant("E1", owner), game());

        expect(canAresTrenchTraverse(source, cardinal)).toBe(true);
        expect(canAresTrenchTraverse(source, diagonal)).toBe(false);
    });

    test("requires matching non-empty trench IDs, source occupants, and free target capacity", () => {
        const owner = player("p1");
        const source = building("A", owner, 5, 5, "alpha");
        const other = building("B", owner, 6, 5, "beta");
        const full = building("C", owner, 4, 5, "ALPHA", 1);

        expect(canAresTrenchTraverse(source, other)).toBe(false);
        source.garrisonTrait.addOccupant(occupant("E1", owner), game());
        full.garrisonTrait.addOccupant(occupant("E2", owner), game());
        expect(canAresTrenchTraverse(source, other)).toBe(false);
        expect(canAresTrenchTraverse(source, full)).toBe(false);
    });

    test("moves only as many occupants as the target can hold, preserving order", () => {
        const owner = player("p1");
        const context = game();
        const source = building("A", owner, 5, 5, "42", 5);
        const target = building("B", owner, 6, 5, "42", 2);
        const first = occupant("A", owner);
        const second = occupant("B", owner);
        const third = occupant("C", owner);
        source.garrisonTrait.addOccupant(first, context);
        source.garrisonTrait.addOccupant(second, context);
        source.garrisonTrait.addOccupant(third, context);

        expect(source.garrisonTrait.traverseTo(target, context)).toBe(2);
        expect(source.garrisonTrait.getOccupantCount()).toBe(1);
        expect(target.garrisonTrait.getOccupantCount()).toBe(2);
        expect(target.garrisonTrait.debugGetState().units.map((unit: any) => unit.id)).toEqual(["A", "B"]);

        // The per-infantry destruction bridge must now point at the destination.
        first.aresGarrisonOccupantTrait[NotifyDestroy.onDestroy](first, context);
        expect(target.garrisonTrait.getOccupantCount()).toBe(1);
        expect(source.garrisonTrait.getOccupantCount()).toBe(1);
    });

    test("selected trench buildings expose the ordinary Occupy cursor/order", () => {
        const owner = player("p1");
        const context = game();
        const source = building("A", owner, 5, 5, "7");
        const target = building("B", owner, 6, 5, "7");
        source.garrisonTrait.addOccupant(occupant("E1", owner), context);
        const order = new OccupyOrder(context);
        order.set(source, { obj: target, tile: target.tile } as any);

        expect(order.isValid()).toBe(true);
        expect(order.isAllowed()).toBe(true);
        expect(order.getPointerType(false)).toBe(PointerType.Occupy);
        const tasks = order.process();
        expect(tasks).toHaveLength(1);
        tasks[0].onTick(source);
        expect(source.garrisonTrait.getOccupantCount()).toBe(0);
        expect(target.garrisonTrait.getOccupantCount()).toBe(1);
    });
});
