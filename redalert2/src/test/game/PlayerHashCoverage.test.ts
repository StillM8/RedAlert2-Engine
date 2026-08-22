import { describe, expect, test } from "bun:test";
import { Player } from "@/game/Player";
import { Color } from "@/util/Color";

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
});
