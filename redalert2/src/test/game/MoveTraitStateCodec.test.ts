import { describe, expect, test } from "bun:test";
import { MoveTrait, MoveState, CollisionState } from "@/game/gameobject/trait/MoveTrait";

/**
 * Versioned movement slice (Locomotors row of
 * docs/DeterministicStateCoverage.md): trait scalars, locomotor private state,
 * and in-flight path reservations restore transactionally. Reservations are
 * stored as map cells, so a checkpoint taken while a unit is moving is
 * restorable; only a legacy counts-only checkpoint is still refused.
 */

function makeTrait(): any {
    return new MoveTrait({} as any, { tiles: { getByMapCoords: () => undefined } } as any);
}

/** A trait wired to a real 4x4 tile grid and a recording occupation tracker. */
function makeGriddedTrait(): any {
    const tiles: any[] = [];
    for (let rx = 0; rx < 4; rx++) {
        for (let ry = 0; ry < 4; ry++) {
            tiles.push({ rx, ry, z: 0, rampType: 0 });
        }
    }
    const occupied: any[] = [];
    const gameObject: any = { id: 1, position: { tiles: { getByMapCoords: (rx: number, ry: number) => tiles.find(t => t.rx === rx && t.ry === ry) } } };
    const tileOccupation: any = {
        tiles: { getByMapCoords: (rx: number, ry: number) => tiles.find(t => t.rx === rx && t.ry === ry) },
        occupySingleTile: (tile: any, obj: any) => occupied.push([tile, obj]),
        unoccupySingleTile: (tile: any, obj: any) => {
            const index = occupied.findIndex(([t, o]) => t === tile && o === obj);
            if (index !== -1) occupied.splice(index, 1);
        },
    };
    return { trait: new MoveTrait(gameObject, tileOccupation), occupied, tiles };
}

describe("MoveTrait state codec", () => {
    test("capture/restore round-trips trait scalars", () => {
        const source = makeTrait();
        source.setDisabled(true);
        source.setChronoAftereffectLocked(true);
        source.speedPenalty = 0.25;
        source.moveState = MoveState.Moving;
        source.collisionState = CollisionState.Waiting;
        source.velocity.set(1, 2, 3);
        source.lastTeleportTick = 42;
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const target = makeTrait();
        target.restoreState(snapshot, { strict: true });

        expect(target.captureState()).toEqual(source.captureState());
        expect(target.isChronoAftereffectLocked()).toBe(true);
    });

    test("locomotor private state patches onto the live locomotor", () => {
        const source = makeTrait();
        (source as any).locomotor = { phase: 1, cursor: 2, facing: 0.5 };
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const target = makeTrait();
        (target as any).locomotor = { phase: 0, cursor: 0, facing: 0 };
        target.restoreState(snapshot, { strict: true });
        expect((target as any).locomotor).toEqual({ phase: 1, cursor: 2, facing: 0.5 });

        // Strict restore refuses locomotor state for a target without one.
        const bare = makeTrait();
        expect(() => bare.restoreState(snapshot, { strict: true })).toThrow(/locomotor is unresolved/i);
        // Permissive restore skips the locomotor slice.
        bare.restoreState(snapshot);
        expect((bare as any).locomotor).toBeUndefined();
    });

    test("restores in-flight path reservations and the active waypoint", () => {
        const source = makeGriddedTrait();
        const cells = [
            { tile: source.tiles[1], onBridge: false },
            { tile: source.tiles[5], onBridge: true },
        ];
        (source.trait as any).reservedPathNodes = [...cells];
        (source.trait as any).currentWaypoint = cells[1];
        (source.trait as any).moveState = MoveState.Moving;
        const snapshot = JSON.parse(JSON.stringify(source.trait.captureState()));

        expect(snapshot.reservedPathNodes).toEqual([
            { rx: 0, ry: 1, onBridge: false },
            { rx: 1, ry: 1, onBridge: true },
        ]);
        expect(snapshot.currentWaypoint).toEqual({ rx: 1, ry: 1, onBridge: true });

        const target = makeGriddedTrait();
        target.trait.restoreState(snapshot, { strict: true });

        expect(target.trait.captureState()).toEqual(snapshot);
        // The reservations are re-registered against this world, not copied.
        expect(target.occupied.map(([tile]: any[]) => [tile.rx, tile.ry])).toEqual([[0, 1], [1, 1]]);
    });

    test("restoring over live reservations releases the old ones first", () => {
        const source = makeGriddedTrait();
        (source.trait as any).reservedPathNodes = [{ tile: source.tiles[0] }];
        const snapshot = JSON.parse(JSON.stringify(source.trait.captureState()));

        const target = makeGriddedTrait();
        (target.trait as any).reservedPathNodes = [{ tile: target.tiles[15] }];
        target.occupied.push([target.tiles[15], (target.trait as any).gameObject]);
        target.trait.restoreState(snapshot, { strict: true });

        expect(target.occupied.map(([tile]: any[]) => [tile.rx, tile.ry])).toEqual([[0, 0]]);
    });

    test("a live in-flight reservation is still released by a snapshot that has none", () => {
        const source = makeGriddedTrait();
        const snapshot = JSON.parse(JSON.stringify(source.trait.captureState()));

        const target = makeGriddedTrait();
        (target.trait as any).reservedPathNodes = [{ tile: target.tiles[15] }];
        target.occupied.push([target.tiles[15], (target.trait as any).gameObject]);
        target.trait.restoreState(snapshot, { strict: true });

        expect(target.trait.captureState().reservedPathNodes).toEqual([]);
        expect(target.occupied).toHaveLength(0);
    });

    test("a legacy counts-only in-flight checkpoint is still refused transactionally", () => {
        for (const over of [{ hasWaypoint: true }, { reservedPathNodeCount: 2 }]) {
            const source = makeTrait();
            const snapshot = {
                version: 1,
                disabled: false,
                speedPenalty: 0,
                moveState: MoveState.Moving,
                collisionState: CollisionState.Resolved,
                velocity: undefined,
                lastVelocity: undefined,
                ...over,
            };
            const target = makeTrait();
            target.setDisabled(true);
            const before = JSON.stringify(target.captureState());
            expect(() => target.restoreState(snapshot, { strict: true })).toThrow(/in-flight/i);
            expect(JSON.stringify(target.captureState())).toBe(before);
        }
    });

    test("an unresolvable path cell is rejected before any reservation is registered", () => {
        const source = makeGriddedTrait();
        (source.trait as any).reservedPathNodes = [{ tile: source.tiles[1] }];
        const snapshot = JSON.parse(JSON.stringify(source.trait.captureState()));
        snapshot.reservedPathNodes.push({ rx: 99, ry: 99, onBridge: false });

        const target = makeGriddedTrait();
        target.trait.setDisabled(true);
        const before = JSON.stringify(target.trait.captureState());
        expect(() => target.trait.restoreState(snapshot, { strict: true })).toThrow(/is unresolved/i);
        expect(JSON.stringify(target.trait.captureState())).toBe(before);
        expect(target.occupied).toHaveLength(0);
    });

    test("canonical identity markers resolve before mutation", () => {
        const source = makeTrait();
        (source as any).lastTargetOffset = { id: 7, dx: 1 };
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const good = makeTrait();
        (good as any).lastTargetOffset = { id: 7, dx: 999 };
        good.restoreState(snapshot, { strict: true });
        expect((good as any).lastTargetOffset).toEqual({ id: 7, dx: 1 });

        const bad = makeTrait();
        (bad as any).lastTargetOffset = { id: 8, dx: 0 };
        const badBefore = JSON.stringify(bad.captureState());
        expect(() => bad.restoreState(snapshot, { strict: true })).toThrow(/identity/i);
        // Transactional: identity failure leaves state untouched.
        expect(JSON.stringify(bad.captureState())).toBe(badBefore);
    });

    test("rejects unsupported versions and malformed payloads", () => {
        const trait = makeTrait();
        expect(() => trait.restoreState({ version: 2 })).toThrow(/version/i);
        expect(() => trait.restoreState(null)).toThrow(/object/i);
    });
});
