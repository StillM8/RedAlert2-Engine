import { describe, expect, test } from "bun:test";
import { UnitOrderTrait } from "@/game/gameobject/trait/UnitOrderTrait";
import { MoveTask } from "@/game/gameobject/task/move/MoveTask";
import {
    getTaskStateFactory,
    isRestorableTaskType,
    registerTaskStateFactory,
} from "@/game/gameobject/task/TaskStateRegistry";
import { TaskStatus } from "@/game/gameobject/task/system/TaskStatus";

/**
 * The live task graph is the last open part of canonical state. A task opts in
 * by registering a factory for its stable `deterministicType`; a task with no
 * contract keeps the explicit `unclassified-task` marker and strict restore
 * refuses it rather than silently dropping the unit's intent.
 */

function makeGrid(size = 4) {
    const tiles: any[] = [];
    for (let rx = 0; rx < size; rx++) {
        for (let ry = 0; ry < size; ry++) {
            tiles.push({ rx, ry, z: 0, rampType: 0, landType: 0 });
        }
    }
    return {
        tiles,
        getByMapCoords: (rx: number, ry: number) => tiles.find(t => t.rx === rx && t.ry === ry),
    };
}

function makeWorld() {
    const grid = makeGrid();
    const game: any = {
        map: {
            tiles: { getByMapCoords: grid.getByMapCoords },
            tileOccupation: { getBridgeOnTile: () => undefined },
        },
    };
    const blocker: any = { id: 30 };
    const objects = new Map<number, any>([[30, blocker]]);
    return { game, grid, blocker, resolveObjectById: (id: number) => objects.get(id) };
}

describe("task state registry", () => {
    test("wait-ticks and turn are registered and restorable", () => {
        expect(isRestorableTaskType("wait-ticks")).toBe(true);
        expect(isRestorableTaskType("turn")).toBe(true);
        expect(isRestorableTaskType("unclassified-task")).toBe(false);
        expect(getTaskStateFactory("wait-ticks")!({ ticks: 4 }, { game: {} as any })).toBeDefined();
    });

    test("rejects a duplicate or malformed registration", () => {
        expect(() => registerTaskStateFactory("", (() => undefined) as any)).toThrow();
        expect(() => registerTaskStateFactory("x", undefined as any)).toThrow();
        const factory = () => undefined as any;
        registerTaskStateFactory("test.duplicate", factory);
        expect(() => registerTaskStateFactory("test.duplicate", factory)).not.toThrow();
        expect(() => registerTaskStateFactory("test.duplicate", () => undefined as any))
            .toThrow(/already registered/);
    });
});

describe("MoveTask state codec", () => {
    test("round-trips the target cell, path, and planning latches", () => {
        const { game, grid } = makeWorld();
        const source = new MoveTask(game, grid.getByMapCoords(3, 2)!, true, {
            forceMove: true,
            closeEnoughTiles: 2,
        });
        (source as any).path = [
            { tile: grid.getByMapCoords(0, 0) },
            { tile: grid.getByMapCoords(1, 0) },
        ];
        (source as any).pushTried = true;
        (source as any).needsPathUpdate = true;
        (source as any).inPlanningForTicks = 17;
        (source as any).destinationLeptons.set(384, 256);
        (source as any).currentWaypointLeptons.set(128, 0);
        (source as any).unreachableTargets = [{ tile: grid.getByMapCoords(3, 1), toBridge: false }];
        source.status = TaskStatus.Running;

        const snapshot = JSON.parse(JSON.stringify(source.getDeterministicState()));
        expect(snapshot.type).toBe("move");
        expect(snapshot.targetTile).toEqual({ rx: 3, ry: 2 });
        expect(snapshot.path).toEqual([{ rx: 0, ry: 0 }, { rx: 1, ry: 0 }]);
        expect(snapshot.inPlanningForTicks).toBe(17);

        const target = new MoveTask(game, grid.getByMapCoords(0, 0)!, false);
        (target as any).restoreDeterministicState(snapshot, {
            game,
            strict: true,
            resolveTile: grid.getByMapCoords,
        });
        expect([(target as any).targetTile.rx, (target as any).targetTile.ry]).toEqual([3, 2]);
        expect((target as any).toBridge).toBe(true);
        expect((target as any).path.map((node: any) => [node.tile.rx, node.tile.ry]))
            .toEqual([[0, 0], [1, 0]]);
        expect((target as any).pushTried).toBe(true);
        expect((target as any).inPlanningForTicks).toBe(17);
        expect((target as any).destinationLeptons.x).toBe(384);
        expect((target as any).options.forceMove).toBe(true);
        expect((target as any).options.closeEnoughTiles).toBe(2);
        expect((target as any).unreachableTargets).toHaveLength(1);
    });

    test("rebuilds a blocked-node reference by stable object id", () => {
        const { game, grid, blocker, resolveObjectById } = makeWorld();
        const source = new MoveTask(game, grid.getByMapCoords(2, 2)!, false);
        (source as any).blockedPathNodes = [{
            node: { tile: grid.getByMapCoords(1, 1) },
            obj: blocker,
        }];
        const snapshot = JSON.parse(JSON.stringify(source.getDeterministicState()));
        expect(snapshot.blockedPathNodes).toEqual([{
            cell: { rx: 1, ry: 1 },
            onBridge: false,
            objectId: 30,
        }]);

        const target = new MoveTask(game, grid.getByMapCoords(0, 0)!, false);
        (target as any).restoreDeterministicState(snapshot, {
            game,
            strict: true,
            resolveTile: grid.getByMapCoords,
            resolveObjectById,
        });
        expect((target as any).blockedPathNodes[0].obj).toBe(blocker);

        const orphan = JSON.parse(JSON.stringify(snapshot));
        orphan.blockedPathNodes[0].objectId = 999;
        const refused = new MoveTask(game, grid.getByMapCoords(0, 0)!, false);
        expect(() => (refused as any).restoreDeterministicState(orphan, {
            game,
            strict: true,
            resolveTile: grid.getByMapCoords,
            resolveObjectById,
        })).toThrow(/blocker 999 is unresolved/);
    });

    test("an unresolvable cell is rejected before any assignment", () => {
        const { game, grid } = makeWorld();
        const source = new MoveTask(game, grid.getByMapCoords(2, 2)!, false);
        (source as any).path = [{ tile: grid.getByMapCoords(1, 1) }];
        const snapshot = JSON.parse(JSON.stringify(source.getDeterministicState()));
        snapshot.path.push({ rx: 99, ry: 99 });

        const target = new MoveTask(game, grid.getByMapCoords(0, 0)!, false);
        (target as any).pushTried = false;
        expect(() => (target as any).restoreDeterministicState(snapshot, {
            game,
            strict: true,
            resolveTile: grid.getByMapCoords,
        })).toThrow(/is unresolved/);
        expect([(target as any).targetTile.rx, (target as any).targetTile.ry]).toEqual([0, 0]);
        expect((target as any).path).toBeUndefined();
    });

    test("a move task in a unit's queue restores through UnitOrderTrait", () => {
        const { game, grid } = makeWorld();
        const unit: any = { id: 10 };
        const source = new UnitOrderTrait(unit) as any;
        const move = new MoveTask(game, grid.getByMapCoords(3, 3)!, false);
        (move as any).path = [{ tile: grid.getByMapCoords(1, 0) }];
        source.tasks.push(move);
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const target = new UnitOrderTrait(unit) as any;
        target.restoreState(snapshot, {
            strict: true,
            game,
            resolveTile: grid.getByMapCoords,
            resolveObjectById: () => undefined,
        });
        expect(target.tasks).toHaveLength(1);
        expect((target.tasks[0] as any).deterministicType).toBe("move");
        expect((target.tasks[0] as any).path.map((n: any) => [n.tile.rx, n.tile.ry]))
            .toEqual([[1, 0]]);
    });

    test("a nested child task is restored and its status preserved", () => {
        const { game, grid } = makeWorld();
        const unit: any = { id: 10 };
        const source = new UnitOrderTrait(unit) as any;
        const move = new MoveTask(game, grid.getByMapCoords(2, 2)!, false);
        const child = new MoveTask(game, grid.getByMapCoords(1, 2)!, false);
        child.status = TaskStatus.Running;
        move.children.push(child as any);
        source.tasks.push(move);
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const target = new UnitOrderTrait(unit) as any;
        target.restoreState(snapshot, {
            strict: true,
            game,
            resolveTile: grid.getByMapCoords,
            resolveObjectById: () => undefined,
        });
        expect((target.tasks[0] as any).children).toHaveLength(1);
        expect((target.tasks[0] as any).children[0].status).toBe(TaskStatus.Running);
    });
});
