import { describe, expect, test } from "bun:test";
import { Prng } from "@/game/Prng";

describe("deterministic PRNG state", () => {
    test("restores the exact future stream after a long draw sequence", () => {
        const source = new Prng(0x12345678);
        for (let i = 0; i < 4537; i++) source.generateRandom();
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));
        const expected = Array.from({ length: 5000 }, () => source.generateRandom());

        const restored = new Prng(0xabcdef01);
        for (let i = 0; i < 73; i++) restored.generateRandom();
        restored.restoreState(snapshot);
        const actual = Array.from({ length: 5000 }, () => restored.generateRandom());
        expect(actual).toEqual(expected);
        expect(restored.getHash()).toBe(source.getHash());
    });

    test("restores nextId-equivalent generator state exactly into a dirty destination", () => {
        const source = new Prng(17);
        source.generateRandomInt(1, 100);
        const snapshot = source.captureState();
        const destination = new Prng(99);
        for (let i = 0; i < 20; i++) destination.generateRandomInt(1, 100);
        destination.restoreState(snapshot);
        expect(destination.captureState()).toEqual(snapshot);
        expect(destination.generateRandom()).toBe(source.generateRandom());
    });

    test("rejects malformed state without mutating the live generator", () => {
        const runtime = new Prng(42);
        runtime.generateRandom();
        const before = runtime.captureState();
        expect(() => runtime.restoreState({ ...before, state: [...before.state].slice(1) }))
            .toThrow(/624 words/);
        expect(runtime.captureState()).toEqual(before);
    });
});
