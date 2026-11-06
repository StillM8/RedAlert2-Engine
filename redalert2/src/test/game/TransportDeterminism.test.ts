import { describe, expect, test } from "bun:test";
import { TransportTrait } from "@/game/gameobject/trait/TransportTrait";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { ParadropTask } from "@/game/gameobject/task/ParadropTask";
import { StanceType } from "@/game/gameobject/infantry/StanceType";

function makeTransport() {
    return new TransportTrait({ id: 1, rules: { passengers: 8 } } as any);
}

function cargo(id: number): any {
    return { id, isDestroyed: false, isCrashing: false };
}

describe("transport canonical lifecycle state", () => {
    test("distinguishes held cargo, queue order, and crash resolution", () => {
        const held = makeTransport();
        held.units = [cargo(10)];
        const queued = makeTransport();
        queued.addToLoadQueue(cargo(10));
        expect(held.getHash()).not.toBe(queued.getHash());

        const forward = makeTransport();
        forward.addToLoadQueue(cargo(10));
        forward.addToLoadQueue(cargo(11));
        const reverse = makeTransport();
        reverse.addToLoadQueue(cargo(11));
        reverse.addToLoadQueue(cargo(10));
        expect(forward.getHash()).not.toBe(reverse.getHash());

        const unresolved = makeTransport();
        unresolved.units = [cargo(10)];
        const resolved = makeTransport();
        resolved.units = [cargo(10)];
        (resolved as any).crashPassengersResolved = true;
        expect(resolved.getHash()).not.toBe(unresolved.getHash());
    });

    test("round-trips ordered IDs and crash state into a dirty destination", () => {
        const source = makeTransport();
        source.units = [cargo(10), cargo(11)];
        source.addToLoadQueue(cargo(12));
        (source as any).crashPassengersResolved = true;
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const restored = makeTransport();
        restored.units = [cargo(99)];
        restored.addToLoadQueue(cargo(98));
        restored.restoreState(snapshot, {
            strict: true,
            resolveObjectById: id => cargo(id),
        });
        expect(restored.captureState()).toEqual(snapshot);
        expect(restored.units.map(unit => unit.id)).toEqual([10, 11]);
        expect((restored as any).loadQueue.map((unit: any) => unit.id)).toEqual([12]);
        expect(restored.getHash()).toBe(source.getHash());
    });

    test("resolver failure and malformed references leave live cargo untouched", () => {
        const trait = makeTransport();
        trait.units = [cargo(10)];
        trait.addToLoadQueue(cargo(11));
        const before = trait.captureState();
        expect(() => trait.restoreState(before, {
            strict: true,
            resolveObjectById: id => id === 10 ? cargo(id) : undefined,
        })).toThrow(/unresolved/);
        expect(trait.captureState()).toEqual(before);

        expect(() => trait.restoreState({
            version: 1,
            heldUnitIds: [10, 10],
            loadQueueUnitIds: [],
            crashPassengersResolved: false,
        }, { resolveObjectById: cargo })).toThrow(/duplicate/);
        expect(trait.captureState()).toEqual(before);
    });

    test("restored crash latch prevents a second passenger destruction pass", () => {
        const trait = makeTransport();
        const passenger = cargo(10);
        trait.restoreState({
            version: 1,
            heldUnitIds: [passenger.id],
            loadQueueUnitIds: [],
            crashPassengersResolved: true,
        }, {
            strict: true,
            resolveObjectById: () => passenger,
        });
        let destructionPasses = 0;
        trait[NotifyDestroy.onDestroy]((trait as any).obj, {
            destroyObject: () => destructionPasses++,
        } as any);
        expect(destructionPasses).toBe(0);
        expect(trait.units).toEqual([]);
    });

    test("drops passengers with type-appropriate landing cells when an aircraft fires", () => {
        const transport = {
            id: 50,
            rules: { passengers: 4 },
            tile: { rx: 2, ry: 3, onBridgeLandType: false },
            tileElevation: 6,
            position: { tileElevation: 6 },
            isAircraft: () => true,
        } as any;
        const tasks: any[] = [];
        const events: any[] = [];
        const makePassenger = (id: number, infantry: boolean) => ({
            id,
            name: infantry ? "Rifle" : "Tank",
            isDestroyed: false,
            isDisposed: false,
            isSpawned: false,
            limboData: {},
            isInfantry: () => infantry,
            position: { tile: undefined, tileElevation: 0, subCell: 0 },
            unitOrderTrait: {
                cancelAllTasks: () => undefined,
                addTask: (task: any) => tasks.push(task),
            },
        });
        const rifle = makePassenger(51, true);
        const tank = makePassenger(52, false);
        const trait = new TransportTrait(transport);
        trait.units = [rifle, tank];
        const world = {
            map: {
                getGroundObjectsOnTile: () => [{ isInfantry: () => true, position: { subCell: 2 } }],
            },
            unlimboObject: (object: any, tile: any) => {
                object.isSpawned = true;
                object.limboData = undefined;
                object.position.tile = tile;
            },
            events: { dispatch: (event: any) => events.push(event) },
        } as any;

        trait.dropPassengersForWeaponFire(transport, world);

        expect(trait.units).toEqual([]);
        expect(rifle.position.subCell).toBe(4);
        expect(rifle.stance).toBe(StanceType.Paradrop);
        expect(tank.position.subCell).toBe(0);
        expect(tasks).toHaveLength(2);
        expect(tasks.every(task => task instanceof ParadropTask)).toBe(true);
        expect(events).toHaveLength(1);
    });

    test("rejects resolver identity mismatches transactionally", () => {
        const trait = makeTransport();
        trait.units = [cargo(10)];
        const before = trait.captureState();

        expect(() => trait.restoreState({ ...before }, {
            strict: true,
            resolveObjectById: () => cargo(11),
        })).toThrow(/resolver returned/);
        expect(trait.captureState()).toEqual(before);
    });
});
