import { describe, expect, test } from "bun:test";
import { ActivateSuperWeaponAction } from "@/game/action/ActivateSuperWeaponAction";
import { setAresPreferredTargetingCell } from "@/extensions/ares/AresSuperWeaponTargetingCell";

/**
 * SW.UseAITargeting: a manual click only confirms activation — the documented
 * AI selector (the same shared selector the AutoFire pump uses) picks the cell
 * deterministically at the action tick.
 */

function makeWorld(rules: any, objects: any[] = []) {
    const activationCalls: any[] = [];
    const events: any[] = [];
    const player: any = { isNeutral: false };
    const game: any = {
        rules: { getSuperWeaponByIndex: () => rules },
        map: {
            tiles: { getByMapCoords: (x: number, y: number) => ({ rx: x, ry: y }) },
            getTileZone: () => 0,
        },
        world: { getAllObjects: () => objects },
        alliances: { areAllied: () => false },
        events: { dispatch: (event: any) => events.push(event) },
        traits: {
            get: () => ({
                activateSuperWeapon: (...args: any[]) => { activationCalls.push(args); return true; },
            }),
        },
    };
    return { game, player, activationCalls, events };
}

function makeAction(game: any, player: any, tile: { x: number; y: number }, tile2?: { x: number; y: number }) {
    const action = new ActivateSuperWeaponAction(game);
    const mutable = action as any;
    mutable.player = player;
    mutable.superWeaponType = 0;
    mutable.tile = tile;
    mutable.tile2 = tile2;
    return action;
}

const aiTargetedRules = (over: Record<string, unknown> = {}) => ({
    name: "ManualBlast",
    typeId: "ManualBlast",
    ares: {
        swUseAITargeting: true,
        swAITargeting: "Offensive",
        swAIRequiresTarget: "infantry",
        swAIRequiresHouse: "enemies",
        ...over,
    },
});

describe("SW.UseAITargeting manual activation flow", () => {
    test("fires at the AI-selected target instead of the click point", () => {
        const enemy = { isNeutral: false };
        const objects = [
            { id: 1, owner: enemy, isInfantry: () => true, tile: { rx: 9, ry: 9 } },
        ];
        const { game, player, activationCalls } = makeWorld(aiTargetedRules(), objects);

        makeAction(game, player, { x: 1, y: 1 }).process();

        expect(activationCalls).toHaveLength(1);
        expect(activationCalls[0][3]).toMatchObject({ rx: 9, ry: 9 });
    });

    test("preferred targeting cell overrides the selected target", () => {
        const enemy = { isNeutral: false };
        const objects = [
            { id: 1, owner: enemy, isInfantry: () => true, tile: { rx: 9, ry: 9 } },
        ];
        const { game, player, activationCalls } = makeWorld(
            aiTargetedRules({ swAITargetingPreference: "Offensive" }),
            objects,
        );
        setAresPreferredTargetingCell(player, "offensive", { x: 33, y: 34 });

        makeAction(game, player, { x: 1, y: 1 }).process();

        expect(activationCalls).toHaveLength(1);
        expect(activationCalls[0][3]).toMatchObject({ rx: 33, ry: 34 });
    });

    test("no AI-selected target drops the action gracefully", () => {
        const { game, player, activationCalls, events } = makeWorld(aiTargetedRules());

        makeAction(game, player, { x: 1, y: 1 }).process();

        expect(activationCalls).toHaveLength(0);
        expect(events).toHaveLength(1);
    });

    test("two-click flows keep their human-chosen destination", () => {
        const { game, player, activationCalls } = makeWorld(aiTargetedRules());

        makeAction(game, player, { x: 1, y: 1 }, { x: 2, y: 2 }).process();

        expect(activationCalls).toHaveLength(1);
        expect(activationCalls[0][3]).toMatchObject({ rx: 1, ry: 1 });
        expect(activationCalls[0][4]).toMatchObject({ rx: 2, ry: 2 });
    });

    test("ordinary weapons still fire at the click point", () => {
        const { game, player, activationCalls } = makeWorld({
            name: "Ordinary",
            typeId: "Ordinary",
            ares: {},
        });

        makeAction(game, player, { x: 4, y: 5 }).process();

        expect(activationCalls).toHaveLength(1);
        expect(activationCalls[0][3]).toMatchObject({ rx: 4, ry: 5 });
    });
});
