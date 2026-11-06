import { describe, expect, test } from "bun:test";
import { UnitOrderTrait } from "@/game/gameobject/trait/UnitOrderTrait";
import { OrderType } from "@/game/order/OrderType";
import { OrderFactory } from "@/game/order/OrderFactory";
import { TargetBridgeMode } from "@/game/Target";
import { WaitTicksTask } from "@/game/gameobject/task/system/WaitTicksTask";
import { TaskStatus } from "@/game/gameobject/task/system/TaskStatus";

/**
 * Orders are part of canonical state: a unit with a pending order will act on
 * it next tick. The codec rebuilds each order from its `OrderType` (which fully
 * determines its constructor flags) plus a stable object-id + cell target, so a
 * checkpoint taken while units have orders no longer has to be refused.
 */

function makeGrid(size = 4) {
    const tiles: any[] = [];
    for (let rx = 0; rx < size; rx++) {
        for (let ry = 0; ry < size; ry++) {
            tiles.push({ rx, ry, z: 0, rampType: 0, landType: 0 });
        }
    }
    const getByMapCoords = (rx: number, ry: number) => tiles.find(t => t.rx === rx && t.ry === ry);
    return {
        tiles,
        cell: (rx: number, ry: number) => getByMapCoords(rx, ry),
        tileOccupation: { getByMapCoords, getBridgeOnTile: () => undefined },
        map: { tiles: { getByMapCoords }, tileOccupation: { getByMapCoords, getBridgeOnTile: () => undefined } },
    };
}

function makeWorld() {
    const grid = makeGrid();
    const game: any = { map: grid.map, createTarget: () => undefined };
    const unit: any = { id: 10, isBuilding: () => false, isOverlay: () => false };
    const enemyTile = grid.cell(2, 2);
    const enemy: any = { id: 20, isBuilding: () => false, isOverlay: () => false, tile: enemyTile };
    const objects = new Map<number, any>([[10, unit], [20, enemy]]);
    return { game, unit, enemy, grid, resolveObjectById: (id: number) => objects.get(id) };
}

describe("unit order state codec", () => {
    test("round-trips a cell-only move order and its queued flag", () => {
        const { game, unit, grid, resolveObjectById } = makeWorld();
        const source = new UnitOrderTrait(unit as any) as any;
        const order = new OrderFactory(game, grid.map).create(OrderType.Move);
        order.set(unit, {
            obj: undefined,
            tile: grid.cell(2, 1),
            getBridgeMode: () => TargetBridgeMode.Auto,
        });
        source.orders.push(order);
        source.queuedOrders.add(order);

        const snapshot = JSON.parse(JSON.stringify(source.captureState()));
        expect(snapshot.version).toBe(2);
        expect(snapshot.orders).toEqual([{
            version: 1,
            orderType: OrderType.Move,
            queued: true,
            target: { objectId: null, rx: 2, ry: 1, bridgeMode: TargetBridgeMode.Auto },
            flags: { forceMove: false },
        }]);

        const target = new UnitOrderTrait(unit as any) as any;
        target.restoreState(snapshot, { strict: true, game, resolveObjectById });
        expect(target.orders).toHaveLength(1);
        expect(target.orders[0].orderType).toBe(OrderType.Move);
        expect(target.queuedOrders.has(target.orders[0])).toBe(true);
        expect(target.orders[0].sourceObject).toBe(unit);
        expect([target.orders[0].target.tile.rx, target.orders[0].target.tile.ry]).toEqual([2, 1]);
    });

    test("preserves the ForceMove / ForceAttack constructor distinction", () => {
        const { game, unit, grid, resolveObjectById } = makeWorld();
        const source = new UnitOrderTrait(unit as any) as any;
        for (const type of [OrderType.Move, OrderType.ForceMove, OrderType.Attack, OrderType.ForceAttack, OrderType.PlaceBomb]) {
            const order = new OrderFactory(game, grid.map).create(type);
            order.set(unit, { obj: undefined, tile: grid.cell(0, 0), getBridgeMode: () => 0 });
            source.orders.push(order);
        }
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const target = new UnitOrderTrait(unit as any) as any;
        target.restoreState(snapshot, { strict: true, game, resolveObjectById });
        // The flag the constructor owns must survive, not just the type number.
        expect((target.orders[0] as any).forceMove).toBe(false);
        expect((target.orders[1] as any).forceMove).toBe(true);
        expect((target.orders[2] as any).ivanBombAllowed).toBe(false);
        expect((target.orders[3] as any).forceAttack).toBe(true);
        expect((target.orders[3] as any).ivanBombAllowed).toBe(true);
        // PlaceBomb constructs an AttackOrder with a different Ivan policy; the
        // shared orderType would otherwise collapse the two.
        expect((target.orders[4] as any).ivanBombAllowed).toBe(true);
        expect((target.orders[4] as any).forceAttack).toBe(false);
    });

    test("hash distinguishes Attack from PlaceBomb", () => {
        const { game, unit, grid } = makeWorld();
        const build = (type: OrderType) => {
            const trait = new UnitOrderTrait(unit as any) as any;
            const order = new OrderFactory(game, grid.map).create(type);
            order.set(unit, { obj: undefined, tile: grid.cell(0, 0), getBridgeMode: () => 0 });
            trait.orders.push(order);
            return trait;
        };
        expect(build(OrderType.PlaceBomb).getHash()).not.toBe(build(OrderType.Attack).getHash());
    });

    test("rebinds an object target by stable id rather than by reference", () => {
        const { game, unit, grid, resolveObjectById } = makeWorld();
        const source = new UnitOrderTrait(unit as any) as any;
        const order = new OrderFactory(game, grid.map).create(OrderType.Attack);
        order.set(unit, {
            obj: { id: 20, isBuilding: () => false, isOverlay: () => false, tile: grid.cell(2, 2) },
            tile: grid.cell(2, 2),
            getBridgeMode: () => 0,
        });
        source.orders.push(order);
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));
        expect(snapshot.orders[0].target).toEqual({
            objectId: 20, rx: 2, ry: 2, bridgeMode: 0,
        });

        const target = new UnitOrderTrait(unit as any) as any;
        target.restoreState(snapshot, { strict: true, game, resolveObjectById });
        expect(target.orders[0].target.obj.id).toBe(20);
    });

    test("hash distinguishes orders that differ only by target", () => {
        const { game, unit, grid } = makeWorld();
        const build = (rx: number) => {
            const trait = new UnitOrderTrait(unit as any) as any;
            const order = new OrderFactory(game, grid.map).create(OrderType.Move);
            order.set(unit, {
                obj: undefined,
                tile: grid.cell(rx, 0),
                getBridgeMode: () => 0,
            });
            trait.orders.push(order);
            return trait;
        };
        expect(build(1).getHash()).not.toBe(build(2).getHash());
    });

    test("restores a queued wait task and refuses a task with no contract", () => {
        const { game, unit, resolveObjectById } = makeWorld();
        const source = new UnitOrderTrait(unit as any) as any;
        const wait = new WaitTicksTask(5) as any;
        wait.status = TaskStatus.Running;
        source.tasks.push(wait);
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const target = new UnitOrderTrait(unit as any) as any;
        target.restoreState(snapshot, { strict: true, game, resolveObjectById });
        expect(target.tasks).toHaveLength(1);
        expect((target.tasks[0] as any).deterministicType).toBe("wait-ticks");
        expect((target.tasks[0] as any).status).toBe(TaskStatus.Running);

        const unclassified = JSON.parse(JSON.stringify(snapshot));
        unclassified.tasks[0] = {
            type: "unclassified-task",
            status: 1,
            children: [],
            cancellable: true,
            blocking: true,
            waitingForChildrenToFinish: false,
            preventOpportunityFire: true,
            preventLanding: true,
            isAttackMove: false,
        };
        const refused = new UnitOrderTrait(unit as any) as any;
        expect(() => refused.restoreState(unclassified, { strict: true, game, resolveObjectById }))
            .toThrow(/unclassified-task/);
        // Permissive mode drops it rather than failing the resume.
        refused.restoreState(unclassified, { game, resolveObjectById });
        expect(refused.tasks).toHaveLength(0);
    });

    test("rejects an unresolvable order cell and target transactionally", () => {
        const { game, unit, grid, resolveObjectById } = makeWorld();
        const source = new UnitOrderTrait(unit as any) as any;
        const order = new OrderFactory(game, grid.map).create(OrderType.Move);
        order.set(unit, { obj: undefined, tile: grid.cell(0, 0), getBridgeMode: () => 0 });
        source.orders.push(order);
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        snapshot.orders[0].target.rx = 99;
        const target = new UnitOrderTrait(unit as any) as any;
        expect(() => target.restoreState(snapshot, { strict: true, game, resolveObjectById }))
            .toThrow(/is unresolved/);
        expect(target.orders).toHaveLength(0);

        const missingObject = JSON.parse(JSON.stringify(snapshot));
        missingObject.orders[0].target = { objectId: 777, rx: 0, ry: 0, bridgeMode: 0 };
        expect(() => target.restoreState(missingObject, { strict: true, game, resolveObjectById }))
            .toThrow(/object 777 is unresolved/);
        expect(target.orders).toHaveLength(0);
    });

    test("rejects a version-1 checkpoint instead of silently dropping orders", () => {
        const { game, unit, resolveObjectById } = makeWorld();
        expect(() => (new UnitOrderTrait(unit as any) as any).restoreState({
            version: 1,
            orderCount: 1,
            orderTypes: ["Move"],
            queuedOrderCount: 0,
            taskCount: 0,
            tasks: [],
            waypointCount: 0,
            hasCurrentWaypoint: false,
        }, { strict: true, game, resolveObjectById })).toThrow(/version: 1/);
    });

    test("restores the shared waypoint path and the active waypoint index", () => {
        const { game, unit, resolveObjectById } = makeWorld();
        const source = new UnitOrderTrait(unit as any) as any;
        const first: any = {};
        const second: any = { next: first };
        first.next = second;
        source.waypointPath = { waypoints: [first, second], units: [unit] };
        source.currentWaypoint = second;
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));
        expect(snapshot.waypointPath).toEqual({ waypointCount: 2, unitIds: [10] });
        expect(snapshot.currentWaypointIndex).toBe(1);

        const target = new UnitOrderTrait(unit as any) as any;
        target.restoreState(snapshot, { strict: true, game, resolveObjectById });
        expect(target.waypointPath.waypoints).toHaveLength(2);
        expect(target.waypointPath.units).toEqual([unit]);
        expect(target.currentWaypoint).toBe(target.waypointPath.waypoints[1]);
    });
});
