import { describe, expect, test } from "bun:test";
import {
    captureAresPreferredTargetingCells,
    getAresPreferredTargetingCell,
    restoreAresPreferredTargetingCells,
    setAresPreferredTargetingCell,
} from "@/extensions/ares/AresSuperWeaponTargetingCell";
import { SetAresPreferredTargetingCellExecutor } from "@/game/trigger/executor/SetAresPreferredTargetingCellExecutor";
import { GameApi } from "@/game/api/GameApi";
import { captureExtensionState, restoreExtensionState } from "@/game/state/ExtensionStateSnapshot";

describe("Ares preferred AI targeting cell", () => {
    test("store round-trips, clears, and isolates players", () => {
        const america = {};
        const russia = {};

        expect(getAresPreferredTargetingCell(america, "offensive")).toBeUndefined();

        setAresPreferredTargetingCell(america, "offensive", { x: 10.9, y: 20.1 });
        expect(getAresPreferredTargetingCell(america, "offensive")).toEqual({ x: 10, y: 20 });
        // Per-kind and per-player isolation.
        expect(getAresPreferredTargetingCell(america, "defensive")).toBeUndefined();
        expect(getAresPreferredTargetingCell(russia, "offensive")).toBeUndefined();

        setAresPreferredTargetingCell(america, "defensive", { x: 1, y: 2 });
        setAresPreferredTargetingCell(america, "offensive", undefined);
        expect(getAresPreferredTargetingCell(america, "offensive")).toBeUndefined();
        expect(getAresPreferredTargetingCell(america, "defensive")).toEqual({ x: 1, y: 2 });
    });

    test("map actions 135/140 set and clear the house preference", () => {
        const player = { country: { name: "America" } };
        const context = {
            map: { getTileAtWaypoint: (id: number) => (id === 3 ? { rx: 7, ry: 8 } : undefined) },
            getAllPlayers: () => [player],
        };
        const make = (kind: "offensive" | "defensive", waypoint: number) =>
            new SetAresPreferredTargetingCellExecutor(
                { params: ["0", "0", "0", "0", "0", "0", String(waypoint)], triggerId: "T", index: 0 },
                { name: "Trigger", houseName: "America" },
                kind,
            );

        make("offensive", 3).execute(context);
        expect(getAresPreferredTargetingCell(player, "offensive")).toEqual({ x: 7, y: 8 });

        // An unresolvable waypoint clears the preference (Cell_Clear semantics).
        make("offensive", 99).execute(context);
        expect(getAresPreferredTargetingCell(player, "offensive")).toBeUndefined();

        make("defensive", 3).execute(context);
        expect(getAresPreferredTargetingCell(player, "defensive")).toEqual({ x: 7, y: 8 });
    });

    test("host API resolves the preference by player name", () => {
        const player = { country: { name: "America" } };
        const gameStub = {
            getPlayerByName: (name: string) => (name === "America" ? player : undefined),
            rules: {},
            map: {},
        };
        setAresPreferredTargetingCell(player, "offensive", { x: 4, y: 5 });

        const api = new GameApi(gameStub, true);
        expect(api.getAresSuperWeaponTargetingCell("America", "offensive")).toEqual({ x: 4, y: 5 });
        expect(api.getAresSuperWeaponTargetingCell("America", "defensive")).toBeUndefined();
        expect(api.getAresSuperWeaponTargetingCell("Russia", "offensive")).toBeUndefined();
    });

    test("capture/restore helpers preserve and clear preferences", () => {
        const player = {};
        setAresPreferredTargetingCell(player, "offensive", { x: 3, y: 4 });

        const state = captureAresPreferredTargetingCells(player);
        expect(state).toEqual({ offensive: { x: 3, y: 4 } });

        const target = {};
        restoreAresPreferredTargetingCells(target, JSON.parse(JSON.stringify(state)));
        expect(getAresPreferredTargetingCell(target, "offensive")).toEqual({ x: 3, y: 4 });

        // An absent slice clears previously set preferences (Cell_Clear state).
        restoreAresPreferredTargetingCells(target, undefined);
        expect(getAresPreferredTargetingCell(target, "offensive")).toBeUndefined();
        expect(captureAresPreferredTargetingCells({})).toBeUndefined();
    });

    test("preferred cells ride the extension snapshot walk", () => {
        const sourcePlayer = { playerListIndex: 0 };
        const sourceGame = {
            playerList: { getAll: () => [sourcePlayer] },
            world: { getAllObjects: () => [] },
        };
        setAresPreferredTargetingCell(sourcePlayer, "defensive", { x: 9, y: 8 });

        const snapshot = JSON.parse(JSON.stringify(captureExtensionState(sourceGame)));
        const targetPlayer = { playerListIndex: 0 };
        const targetGame = {
            playerList: { getAll: () => [targetPlayer] },
            world: { getAllObjects: () => [] },
        };
        restoreExtensionState(targetGame, snapshot, { strict: true });

        expect(getAresPreferredTargetingCell(targetPlayer, "defensive")).toEqual({ x: 9, y: 8 });
        expect(getAresPreferredTargetingCell(targetPlayer, "offensive")).toBeUndefined();
    });
});
