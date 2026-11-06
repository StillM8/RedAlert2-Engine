import { describe, expect, test } from "bun:test";
import { TagRepeatType } from "@/data/map/tag/TagRepeatType";
import { TriggerActionType } from "@/data/map/trigger/TriggerActionType";
import { TriggerEventType } from "@/data/map/trigger/TriggerEventType";
import { CountdownTimer } from "@/game/CountdownTimer";
import { EventType } from "@/game/event/EventType";
import { Game, GameStatus } from "@/game/Game";
import { GameSpeed } from "@/game/GameSpeed";
import { TriggerExecutorFactory } from "@/game/trigger/TriggerExecutorFactory";
import { captureExtensionState, restoreExtensionState } from "@/game/state/ExtensionStateSnapshot";

describe("countdown timer deterministic state", () => {
    test("hashes both remaining ticks and running state", () => {
        const active = new CountdownTimer();
        active.setSeconds(10);
        active.start();
        const paused = new CountdownTimer();
        paused.setSeconds(10);
        expect(active.getHash()).not.toBe(paused.getHash());

        const differentTicks = new CountdownTimer();
        differentTicks.setSeconds(9);
        differentTicks.start();
        expect(active.getHash()).not.toBe(differentTicks.getHash());
    });

    test("round-trips and rejects malformed state transactionally", () => {
        const source = new CountdownTimer();
        source.setSeconds(7);
        source.start();
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));
        const destination = new CountdownTimer();
        destination.setSeconds(99);
        destination.restoreState(snapshot);
        expect(destination.captureState()).toEqual(snapshot);

        const before = destination.captureState();
        expect(() => destination.restoreState({
            version: 1,
            ticks: -1,
            running: false,
        })).toThrow(/ticks/);
        expect(destination.captureState()).toEqual(before);
    });

    test("round-trips through the extension snapshot seam", () => {
        const source = createGame();
        source.countdownTimer.setSeconds(3);
        source.countdownTimer.start();
        const snapshot = JSON.parse(JSON.stringify(captureExtensionState(source)));
        const target = createGame();
        restoreExtensionState(target, snapshot, { strict: true });
        expect(target.countdownTimer.captureState()).toEqual(source.countdownTimer.captureState());
    });

    test("start and stop ignore invalid duplicate transitions", () => {
        const timer = new CountdownTimer();
        timer.setSeconds(1);
        const initialHash = timer.getHash();
        executeTimerAction(TriggerActionType.TimerStart, undefined, { countdownTimer: timer });
        const runningHash = timer.getHash();
        executeTimerAction(TriggerActionType.TimerStart, undefined, { countdownTimer: timer });
        expect(timer.isRunning()).toBe(true);
        expect(timer.getHash()).toBe(runningHash);
        executeTimerAction(TriggerActionType.TimerStop, undefined, { countdownTimer: timer });
        const stoppedHash = timer.getHash();
        executeTimerAction(TriggerActionType.TimerStop, undefined, { countdownTimer: timer });
        expect(timer.isRunning()).toBe(false);
        expect(timer.getHash()).toBe(stoppedHash);
        expect(initialHash).not.toBe(runningHash);
        expect(runningHash).not.toBe(stoppedHash);
    });

    test("timer extend, shorten, and set restart with the existing seconds conversion", () => {
        const timer = new CountdownTimer();
        executeTimerAction(TriggerActionType.TimerSet, 2, { countdownTimer: timer });
        expect(timer.isRunning()).toBe(true);
        expect(timer.captureState().ticks).toBe(2 * GameSpeed.BASE_TICKS_PER_SECOND);

        timer.stop();
        executeTimerAction(TriggerActionType.TimerExtend, 3, { countdownTimer: timer });
        expect(timer.isRunning()).toBe(true);
        expect(timer.captureState().ticks).toBe(5 * GameSpeed.BASE_TICKS_PER_SECOND);

        timer.stop();
        executeTimerAction(TriggerActionType.TimerShorten, 1, { countdownTimer: timer });
        expect(timer.isRunning()).toBe(true);
        expect(timer.captureState().ticks).toBe(4 * GameSpeed.BASE_TICKS_PER_SECOND);

        timer.stop();
        executeTimerAction(TriggerActionType.TimerSet, 0, { countdownTimer: timer });
        expect(timer.isRunning()).toBe(true);
        expect(timer.captureState().ticks).toBe(0);
    });

    test("zero set expires on the next logic pass once and the timer continues ticking", () => {
        const game = createGame();
        const timer = game.countdownTimer;
        const timerEvents: any[] = [];
        game.events.subscribe(EventType.TimerExpire, (event: any) => timerEvents.push(event));
        const trigger = {
            id: "timer-expiry",
            name: "timer-expiry",
            disabled: false,
            difficulties: { easy: true, medium: true, hard: true },
            tag: { id: "timer-tag", repeatType: TagRepeatType.OnceAny },
            events: [{ type: TriggerEventType.MissionTimerExpired, params: [] }],
            actions: [{
                type: TriggerActionType.TimerSet,
                params: [0, 2],
                triggerId: "timer-expiry",
                index: 0,
            }],
        };
        game.map = {
            getInitialMapObjects: () => ({ technos: [] }),
            getCellTags: () => [],
            getVariables: () => new Map(),
            getTriggers: () => [trigger],
            tiles: { getByMapCoords: () => undefined },
        };
        game.triggers.init(game as any);

        executeTimerAction(TriggerActionType.TimerSet, 0, game);
        const armedHash = timer.getHash();
        game.update();
        expect(timerEvents).toHaveLength(1);
        expect(timer.isRunning()).toBe(false);
        expect(timer.getHash()).not.toBe(armedHash);

        game.update();
        expect(timerEvents).toHaveLength(1);
        expect(timer.isRunning()).toBe(true);
        expect(timer.captureState().ticks).toBe(2 * GameSpeed.BASE_TICKS_PER_SECOND - 1);

        game.update();
        expect(timerEvents).toHaveLength(1);
        expect(timer.captureState().ticks).toBe(2 * GameSpeed.BASE_TICKS_PER_SECOND - 2);
    });
});

function executeTimerAction(type: TriggerActionType, value: number | undefined, context: any): void {
    const action = {
        type,
        params: value === undefined ? [] : [0, value],
        triggerId: "test",
        index: 0,
    };
    new TriggerExecutorFactory().create(action, { name: "test" }).execute(context);
}

function createGame(): Game {
    const game = new Game(
        {},
        {},
        {},
        {},
        {},
        1,
        2,
        { gameSpeed: 5, humanPlayers: [], aiPlayers: [] },
        0,
        { getCombatants: () => [], getAll: () => [] },
        {},
        {},
        { value: 1 },
        {},
        { update() { } },
    );
    game.status = GameStatus.Started;
    game.lastGameEndCheck = Number.MAX_SAFE_INTEGER;
    return game;
}
