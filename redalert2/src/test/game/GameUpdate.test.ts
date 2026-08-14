import { describe, expect, test } from "bun:test";
import { Game, GameStatus } from "@/game/Game";

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
        { getCombatants: () => [] },
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

describe("Game update traversal", () => {
    test("keeps mutation-safe snapshot semantics without updating newly added objects in the same tick", () => {
        const game = createGame();
        const updates: string[] = [];
        const added = {
            isSpawned: true,
            update() {
                updates.push("added");
            },
        };
        const first = {
            isSpawned: true,
            update() {
                updates.push("first");
                game.updatableObjects.delete(first);
                game.updatableObjects.add(added);
            },
        };
        const second = {
            isSpawned: true,
            update() {
                updates.push("second");
            },
        };
        game.updatableObjects.add(first);
        game.updatableObjects.add(second);

        game.update();
        expect(updates).toEqual(["first", "second"]);

        game.update();
        expect(updates).toEqual(["first", "second", "second", "added"]);
    });
});
