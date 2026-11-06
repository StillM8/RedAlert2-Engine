import { describe, expect, test } from "bun:test";
import { Replay, ReplayEventType } from "@/network/gamestate/Replay";
import { ReplayTurnManager } from "@/network/gamestate/ReplayTurnManager";
import { SoloPlayTurnManager } from "@/network/gamestate/SoloPlayTurnManager";

/**
 * The extension-state snapshot rides alongside the action log in the replay
 * container (format v2 trailing block). Files without a snapshot are written
 * exactly like version-1 files so existing replays and action-log saves keep
 * byte compatibility, while snapshot-carrying files bump the version so older
 * readers reject them cleanly instead of misparsing.
 */

function formatVersion(data: string): number {
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    return bytes[4] | (bytes[5] << 8);
}

function makeReplay() {
    const replay = new Replay();
    replay.gameId = "g-1";
    replay.gameTimestamp = 7;
    replay.engineVersion = "engine";
    replay.modHash = "mod";
    replay.gameOpts = { map: "snow" };
    replay.name = "match";
    replay.finish(42);
    replay.actionRecords.push({ tick: 1, playerId: 0, actionType: 2, data: new Uint8Array([1, 2, 3]) });
    replay.eventRecords.push({ tick: 2, type: ReplayEventType.Chat, playerId: 1, payload: "hello" });
    replay.hashCheckpoints.push({ tick: 3, hash: 99 });
    return replay;
}

describe("Replay extension-state payload", () => {
    test("round-trips extension state alongside the action log", () => {
        const source = makeReplay();
        source.extensionState = { version: 1, players: [{ playerListIndex: 0, superWeapons: [] }], attachEffects: [] };

        expect(formatVersion(source.serialize())).toBe(2);
        const restored = new Replay();
        restored.unserialize(source.serialize());

        expect(restored.extensionState).toEqual(source.extensionState);
        expect(restored.actionRecords).toEqual(source.actionRecords);
        expect(restored.eventRecords).toEqual(source.eventRecords);
        expect(restored.hashCheckpoints).toEqual(source.hashCheckpoints);
        expect(restored.finishedTick).toBe(42);
    });

    test("files without extension state read back as absent", () => {
        const source = makeReplay();
        const serialized = source.serialize();
        expect(formatVersion(serialized)).toBe(1);
        const restored = new Replay();
        restored.unserialize(serialized);

        expect(restored.extensionState).toBeUndefined();
        expect(restored.actionRecords).toEqual(source.actionRecords);
        expect(restored.hashCheckpoints).toEqual(source.hashCheckpoints);
    });

    test("production terminal restore runs at the saved tick before hash verification", () => {
        const replay = makeReplay();
        replay.finishedTick = 1;
        replay.extensionState = {
            version: 1,
            players: [],
            attachEffects: [],
            triggerState: { version: 1 },
        };
        replay.hashCheckpoints = [{ tick: 1, hash: 123 }];
        let restored = false;
        let updateCount = 0;
        const verifiedHashes: number[] = [];
        const game = {
            currentTick: 0,
            playerList: { getAll: () => [] },
            world: { getAllObjects: () => [] },
            triggers: {
                validateState: (state: unknown) => {
                    if ((state as any)?.version !== 1) throw new Error("invalid trigger state");
                },
                restoreState: () => {
                    restored = true;
                },
            },
            update() {
                updateCount++;
                this.currentTick++;
            },
            getHash() {
                const hash = restored ? 123 : 999;
                verifiedHashes.push(hash);
                return hash;
            },
        };
        const manager = new ReplayTurnManager(game, replay, { create: () => undefined });

        expect(manager.doGameTurn(0)).toBe(true);
        expect(restored).toBe(false);
        expect(manager.doGameTurn(0)).toBe(false);
        expect(restored).toBe(true);
        expect(game.currentTick).toBe(1);
        expect(updateCount).toBe(1);
        expect(verifiedHashes).toEqual([123]);
        expect(manager.isFinished()).toBe(true);
    });

    test("terminal extension incompatibility fails visibly", () => {
        const replay = makeReplay();
        replay.finishedTick = 0;
        replay.extensionState = { version: 99 };
        const game = {
            currentTick: 0,
            playerList: { getAll: () => [] },
            world: { getAllObjects: () => [] },
        };
        const manager = new ReplayTurnManager(
            game,
            replay,
            { create: () => undefined },
            undefined,
            () => {
                throw new Error("incompatible extension state");
            },
        );

        expect(() => manager.doGameTurn(0)).toThrow(/incompatible extension state/);
        expect(manager.isFinished()).toBe(false);
    });

    test("rejects newer format versions cleanly", () => {
        const source = makeReplay();
        source.extensionState = { version: 1, players: [], attachEffects: [] };
        const bytes = Uint8Array.from(atob(source.serialize()), (c) => c.charCodeAt(0));
        // Format version sits right after the 4-byte magic; 0xFFFF is newer
        // than any supported version under either endianness.
        bytes[4] = 0xff;
        bytes[5] = 0xff;
        const tampered = btoa(String.fromCharCode(...bytes));

        expect(() => new Replay().unserialize(tampered)).toThrow(/version/i);
    });

    test("save resume restores extension state after catch-up", () => {
        const state = { version: 1, players: [], attachEffects: [] };
        const restored: unknown[] = [];
        const game = {
            currentTick: 0,
            speed: { value: 1 },
            desiredSpeed: {
                value: 1,
                onChange: { subscribe() {}, unsubscribe() {} },
            },
            update() {
                this.currentTick++;
            },
        };
        const manager = new SoloPlayTurnManager(
            game,
            {},
            { dequeueAll: () => [] },
            undefined,
            undefined,
            {
                records: [],
                untilTick: 1,
                actionFactory: { create: () => undefined },
                extensionState: state,
                restoreExtensionState: value => restored.push(value),
            },
        );

        expect(manager.isResuming()).toBe(true);
        expect(manager.doGameTurn(0)).toBe(true);
        expect(manager.isResuming()).toBe(false);
        expect(restored).toEqual([state]);
    });
});
