import { describe, expect, test } from "bun:test";
import { CountdownTimer } from "@/game/CountdownTimer";

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
});
