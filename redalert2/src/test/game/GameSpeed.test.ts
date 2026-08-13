import { describe, expect, test } from "bun:test";
import { GameSpeed } from "@/game/GameSpeed";

describe("GameSpeed", () => {
    test("preserves the RA2/YR multiplayer tick-rate ladder", () => {
        expect(GameSpeed.computeGameSpeed(0) * GameSpeed.BASE_TICKS_PER_SECOND).toBe(10);
        expect(GameSpeed.computeGameSpeed(1) * GameSpeed.BASE_TICKS_PER_SECOND).toBe(12);
        expect(GameSpeed.computeGameSpeed(2) * GameSpeed.BASE_TICKS_PER_SECOND).toBe(15);
        expect(GameSpeed.computeGameSpeed(3) * GameSpeed.BASE_TICKS_PER_SECOND).toBe(20);
        expect(GameSpeed.computeGameSpeed(4) * GameSpeed.BASE_TICKS_PER_SECOND).toBe(30);
        expect(GameSpeed.computeGameSpeed(5) * GameSpeed.BASE_TICKS_PER_SECOND).toBe(45);
        expect(GameSpeed.computeGameSpeed(6) * GameSpeed.BASE_TICKS_PER_SECOND).toBe(60);
    });
});
