import { describe, expect, test } from "bun:test";
import { GenericWarheadEffect, type GenericWarheadFactory } from "@/game/superweapon/GenericWarheadEffect";

class TestWarhead {
    static calls: any[][] = [];
    constructor(public readonly rules: any) { }
    detonate(...args: any[]): void {
        TestWarhead.calls.push(args);
    }
}

describe("Ares GenericWarhead superweapon", () => {
    test("detonates the configured warhead on the target cell", () => {
        TestWarhead.calls = [];
        const owner: any = {};
        const tile = { rx: 2, ry: 5, z: 1 };
        const game: any = {
            rules: { getWarhead: (name: string) => ({ name }) },
            map: {
                tileOccupation: { getBridgeOnTile: () => undefined },
                getTileZone: () => 0,
            },
            createTarget: (object: any, targetTile: any) => ({ object, targetTile }),
        };
        const effect = new GenericWarheadEffect(
            "GenericWarhead",
            owner,
            tile,
            750,
            "MOBlastWH",
            undefined,
            undefined,
            TestWarhead as unknown as GenericWarheadFactory,
        );

        effect.onStart(game);

        expect(TestWarhead.calls).toHaveLength(1);
        expect(TestWarhead.calls[0][1]).toBe(750);
        expect(TestWarhead.calls[0][2]).toBe(tile);
        expect(TestWarhead.calls[0][7]).toEqual({ object: undefined, targetTile: tile });
        expect(TestWarhead.calls[0][8].player).toBe(owner);
        expect(typeof TestWarhead.calls[0][13]).toBe("function");
        expect(TestWarhead.calls[0][13]({ owner }, tile)).toBe(true);
    });
});
