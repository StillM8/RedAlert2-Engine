import { describe, expect, test } from "bun:test";
import { Player } from "@/game/Player";
import { Color } from "@/util/Color";
import { ObjectType } from "@/engine/type/ObjectType";
import { ProductionQueue, QueueType } from "@/game/player/production/ProductionQueue";
import { UpdateQueueAction, UpdateType } from "@/game/action/UpdateQueueAction";

/**
 * Adversarial coverage for Player canonical-hash coverage.
 *
 * Only future-affecting state belongs in the lockstep hash. These cases
 * assert the omissions found by the coverage audit:
 *
 * - defeated flips isCombatant(), which gates Warhead fear logic, repair
 *   order targeting, and asset redistribution;
 * - score breaks the asset-redistribution tie-break.
 *
 * resigned/dropped are deliberately NOT asserted: they are consumed only by
 * UI actions (Observe/Resign/DropPlayer), not by simulation decisions.
 */
function makePlayer(name: string): Player {
    // A playable country is required: without one the Player constructor
    // marks the player an observer and isCombatant() is always false.
    const country = {
        id: name,
        isPlayable: () => true,
        sideId: "side",
        name,
    } as never;
    return new Player(name, country, undefined, new Color(255, 0, 0));
}

describe("Player canonical hash coverage", () => {
    test("defeat state changes the hash", () => {
        const active = makePlayer("Soviet");
        const defeated = makePlayer("Soviet");
        defeated.defeated = true;
        expect(defeated.getHash()).not.toBe(active.getHash());
        // And it is behaviorally meaningful: isCombatant() flips with it.
        expect(active.isCombatant()).toBe(true);
        expect(defeated.isCombatant()).toBe(false);
    });

    test("score changes the hash", () => {
        const first = makePlayer("Soviet");
        const second = makePlayer("Soviet");
        second.score = 500;
        expect(second.getHash()).not.toBe(first.getHash());
    });

    test("identical independent players hash identically", () => {
        const first = makePlayer("Soviet");
        first.credits = 1000;
        first.score = 250;
        const second = makePlayer("Soviet");
        second.credits = 1000;
        second.score = 250;
        expect(second.getHash()).toBe(first.getHash());
    });

    test("canonical player-list identity participates in the player hash", () => {
        const first = makePlayer("Same");
        const second = makePlayer("Same");
        first.playerListIndex = 0;
        second.playerListIndex = 1;
        expect(first.getHash()).not.toBe(second.getHash());
    });

    test("negative BuildLimit history changes the hash and future queue admission", () => {
        const first = makePlayer("Soviet");
        const second = makePlayer("Soviet");
        const limitedUnit = {
            id: "foo-1",
            name: "Foo",
            type: ObjectType.Infantry,
            owner: first,
            buildLimit: -2,
        } as any;
        first.addUnitsBuilt(limitedUnit, 1);
        second.addUnitsBuilt({ ...limitedUnit, owner: second }, 2);
        expect(first.getHash()).not.toBe(second.getHash());

        const addToQueue = (player: Player) => {
            const queue = new ProductionQueue(QueueType.Infantry, 10, 10);
            player.production = {
                getQueue: () => queue,
                isAvailableForProduction: () => true,
            } as any;
            const action = new UpdateQueueAction({} as any) as any;
            action.player = player;
            action.queueType = QueueType.Infantry;
            action.updateType = UpdateType.Add;
            action.item = { ...limitedUnit, owner: player };
            action.quantity = 1;
            action.process();
            return queue;
        };
        expect(addToQueue(first).currentSize).toBe(1);
        expect(addToQueue(second).currentSize).toBe(0);
    });

    test("units-built history rejects non-integer counts", () => {
        expect(() => makePlayer("Soviet").addUnitsBuilt({
            name: "Foo",
            type: ObjectType.Infantry,
            buildLimit: -1,
        } as any, 0.5)).toThrow(/non-negative integer/);
    });
});
