import { describe, expect, test } from "bun:test";
import { captureWorldState, restoreWorldState } from "@/game/state/WorldStateSnapshot";
import { captureExtensionState, restoreExtensionState } from "@/game/state/ExtensionStateSnapshot";
import {
    createQualifiedWorld,
    qualifyRestore,
    RESTORE_QUALIFICATION_TICK,
    type QualifiedWorld,
} from "@/test/helpers/DeterministicRestoreHarness";

/**
 * End-to-end qualification for the full-world checkpoint walk over real
 * engine objects: a freshly built world restores the captured world state
 * without replaying pre-snapshot history, and both worlds then simulate
 * identically against the shared behavioral checkpoint.
 *
 * The checkpoint is captured and restored the way the real save/resume seam
 * does it: the world snapshot restores first, then the extension snapshot.
 * `Game.getHash()` spans both, so the behavioral comparison only passes when
 * the two slices together account for every canonical axis.
 */

interface ComposedSnapshot {
    world: unknown;
    extension: unknown;
}

function restoreOptions() {
    return {
        strict: true,
        createObject: () => undefined,
        spawnObject: () => undefined,
        unspawnObject: () => undefined,
    };
}

function sliceOptions(extra: Partial<Parameters<typeof qualifyRestore>[0]> = {}) {
    return {
        seed: 20260215,
        objectCount: 12,
        ticksBeforeSnapshot: RESTORE_QUALIFICATION_TICK,
        ticksAfterSnapshot: RESTORE_QUALIFICATION_TICK,
        effect: () => undefined,
        capture: (source: QualifiedWorld): ComposedSnapshot => ({
            world: captureWorldState(source.game),
            extension: captureExtensionState(source.game),
        }),
        restore: (target: QualifiedWorld, snapshot: unknown) => {
            const composed = snapshot as ComposedSnapshot;
            restoreWorldState(target.game, composed.world, restoreOptions());
            restoreExtensionState(target.game, composed.extension, {
                strict: true,
                superWeaponWorld: target.game,
            });
        },
        ...extra,
    };
}

describe("world state snapshot qualification", () => {
    test("restores a real engine world and keeps simulating identically", () => {
        const result = qualifyRestore(sliceOptions());

        expect(result.firstDivergence).toBeUndefined();
        expect(result.passed).toBe(true);
        expect(result.checkpointsCompared).toBeGreaterThan(1);
    });

    test("world state alone accounts for the player list and object identities", () => {
        const { game } = createQualifiedWorld({ seed: 5, objectCount: 6 });
        const snapshot = captureWorldState(game);
        const target = createQualifiedWorld({ seed: 5, objectCount: 6 });
        restoreWorldState(target.game, JSON.parse(JSON.stringify(snapshot)), restoreOptions());
        // Ownership and position, not merely the raw capture, round-trip.
        expect(target.game.world.getAllObjects().map((object: any) => object.id))
            .toEqual([1, 2, 3, 4, 5, 6]);
        expect(target.game.world.getAllObjects().map((object: any) => object.owner.playerListIndex))
            .toEqual([0, 1, 0, 1, 0, 1]);
        expect(target.game.world.getAllObjects().map((object: any) => `${object.position.tile.rx},${object.position.tile.ry}`))
            .toEqual(["0,0", "1,0", "2,0", "3,0", "4,0", "5,0"]);
    });

    test("captures every world object, player, and the canonical core axes", () => {
        const { game, players } = createQualifiedWorld({ seed: 5, objectCount: 6 });
        const snapshot = captureWorldState(game);

        expect(snapshot.version).toBe(1);
        expect(snapshot.objects).toHaveLength(6);
        expect(snapshot.objects.map(object => object.id)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(snapshot.objects.every(object => object.position !== undefined)).toBe(true);
        expect(snapshot.players).toHaveLength(players.length);
        expect(snapshot.players.every(player => Number.isSafeInteger(player.index))).toBe(true);
        expect(snapshot.prng.version).toBe(1);
        expect(snapshot.nextObjectId).toBe(7);
    });

    test("is idempotent: restoring the same snapshot twice yields the same capture", () => {
        const source = createQualifiedWorld({ seed: 9, objectCount: 8 });
        const snapshot = JSON.parse(JSON.stringify(captureWorldState(source.game)));
        const target = createQualifiedWorld({ seed: 9, objectCount: 8 });
        const options = {
            strict: true,
            createObject: () => undefined,
            spawnObject: () => undefined,
            unspawnObject: () => undefined,
        };

        restoreWorldState(target.game, snapshot, options);
        const first = captureWorldState(target.game);
        restoreWorldState(target.game, snapshot, options);
        const second = captureWorldState(target.game);

        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    test("rejects a truncated player set instead of silently diverging", () => {
        const source = createQualifiedWorld({ seed: 11, objectCount: 4 });
        const snapshot: any = captureWorldState(source.game);
        snapshot.players.pop();
        const target = createQualifiedWorld({ seed: 11, objectCount: 4 });

        expect(() => restoreWorldState(target.game, snapshot, restoreOptions()))
            .toThrow(/player set is incomplete/i);
    });

    test("rejects an object whose identity drifted from the checkpoint", () => {
        const source = createQualifiedWorld({ seed: 13, objectCount: 4 });
        const snapshot: any = captureWorldState(source.game);
        snapshot.objects[2].name = "tampered";
        const target = createQualifiedWorld({ seed: 13, objectCount: 4 });

        expect(() => restoreWorldState(target.game, snapshot, restoreOptions()))
            .toThrow(/identity changed/i);
    });

    test("rejects a player slot that no longer maps to the same identity", () => {
        const source = createQualifiedWorld({ seed: 17, objectCount: 4 });
        const snapshot: any = captureWorldState(source.game);
        snapshot.players[1].index = 0;
        const target = createQualifiedWorld({ seed: 17, objectCount: 4 });

        expect(() => restoreWorldState(target.game, snapshot, restoreOptions())).toThrow();
    });
});
