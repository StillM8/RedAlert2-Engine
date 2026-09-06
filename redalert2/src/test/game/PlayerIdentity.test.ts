import { describe, expect, test } from "bun:test";
import { Player } from "@/game/Player";
import { PlayerList } from "@/game/PlayerList";
import { Replay } from "@/network/gamestate/Replay";
import { ReplayRecorder } from "@/network/gamestate/ReplayRecorder";

describe("canonical player identity", () => {
    test("PlayerList assigns stable slots even when display names collide", () => {
        const first = new Player("");
        const second = new Player("");
        const list = new PlayerList();
        list.addPlayer(first);
        list.addPlayer(second);

        expect(list.getPlayerNumber(first)).toBe(0);
        expect(list.getPlayerNumber(second)).toBe(1);
        expect(first.playerListIndex).toBe(0);
        expect(second.playerListIndex).toBe(1);
        expect(() => list.getPlayerByName("")).toThrow(/ambiguous/);
    });

    test("replay records use PlayerList slots without changing the wire field", () => {
        const first = new Player("Same");
        const second = new Player("Same");
        const list = new PlayerList();
        list.addPlayer(first);
        list.addPlayer(second);
        const replay = new Replay();
        const game: any = {
            getPlayerNumber: (player: Player) => list.getPlayerNumber(player),
            getPlayerByName: (name: string) => list.getPlayerByName(name),
        };
        const recorder = new ReplayRecorder(game, replay);

        recorder.recordActions(4, [{
            player: second,
            actionType: 7,
            serialize: () => new Uint8Array([1]),
        }]);

        expect(replay.actionRecords[0].playerId).toBe(1);
        expect(() => recorder.recordChatMessage(5, "Same", "ambiguous")).toThrow(/ambiguous/);
    });
});
