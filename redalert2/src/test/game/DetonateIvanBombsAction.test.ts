import { describe, expect, test } from "bun:test";
import { DetonateIvanBombsAction } from "@/game/action/DetonateIvanBombsAction";
import { DetonateIvanBombsActionFactory } from "@/game/action/factories/DetonateIvanBombsActionFactory";
import { ActionType } from "@/game/action/ActionType";
import { ActionFactory } from "@/game/action/ActionFactory";
import { ActionFactoryReg } from "@/game/action/ActionFactoryReg";
import { ActionQueue } from "@/game/action/ActionQueue";
import { ActionsApi } from "@/game/api/ActionsApi";
import { TntChargeTrait } from "@/game/gameobject/trait/TntChargeTrait";

/**
 * Ares remote Ivan-bomb detonation: the planter detonates an active bomb
 * early, gated by the bomb's documented IvanBomb.CanDetonateTimeBomb /
 * IvanBomb.CanDetonateDeathBomb rules. Malformed or unauthorized requests are
 * dropped deterministically instead of aborting tick processing.
 */

class RecordingTrait extends TntChargeTrait {
    public detonations = 0;
    protected detonateIvanWarhead(): void {
        this.detonations++;
    }
}

describe("DetonateIvanBombsAction", () => {
    test("serializes and unserializes the target object id", () => {
        const factory = new DetonateIvanBombsActionFactory({});
        const action = factory.create();
        expect(action).toBeInstanceOf(DetonateIvanBombsAction);

        for (const objectId of [1, 255, 70000]) {
            (action as any).setObjectId(objectId);
            const bytes = action.serialize();
            const restored = new DetonateIvanBombsAction({});
            restored.unserialize(bytes);
            expect((restored as any).objectId).toBe(objectId);
            expect(restored.serialize()).toEqual(bytes);
        }
    });

    test("detonates the planter's active bomb through the trait seam", () => {
        const player = {};
        const trait = new RecordingTrait();
        trait.setCharge(30, 0, { player }, {
            deathBomb: false,
            canDetonateTimeBomb: true,
            canDetonateDeathBomb: false,
        } as any);
        const target: any = { tntChargeTrait: trait };
        const game = { getObjectById: (id: number) => (id === 5 ? target : undefined) };

        const action = new DetonateIvanBombsAction(game);
        (action as any).player = player;
        (action as any).objectId = 5;
        action.process();

        expect(trait.detonations).toBe(1);
    });

    test("drops requests for missing or unarmed targets", () => {
        const trait = new RecordingTrait();
        const target: any = { tntChargeTrait: trait };
        const game = { getObjectById: (id: number) => (id === 5 ? target : undefined) };
        const action = new DetonateIvanBombsAction(game);
        (action as any).player = {};

        // Unknown object id.
        (action as any).objectId = 99;
        expect(() => action.process()).not.toThrow();
        // Object without a bomb.
        (action as any).objectId = 5;
        expect(() => action.process()).not.toThrow();
        expect(trait.detonations).toBe(0);
    });

    test("refuses detonation for a different player's bomb", () => {
        const trait = new RecordingTrait();
        trait.setCharge(30, 0, { player: { id: "owner" } }, {
            deathBomb: false,
            canDetonateTimeBomb: true,
            canDetonateDeathBomb: false,
        } as any);
        const target: any = { tntChargeTrait: trait };
        const game = { getObjectById: () => target };

        const action = new DetonateIvanBombsAction(game);
        (action as any).player = { id: "intruder" };
        (action as any).objectId = 5;
        action.process();

        expect(trait.detonations).toBe(0);
        expect(trait.hasCharge()).toBe(true);
    });

    test("respects the CanDetonateTimeBomb / CanDetonateDeathBomb gates", () => {
        const player = {};

        // Time bomb with CanDetonateTimeBomb=no is not remotely detonatable.
        const lockedTime = new RecordingTrait();
        lockedTime.setCharge(30, 0, { player }, {
            deathBomb: false,
            canDetonateTimeBomb: false,
            canDetonateDeathBomb: true,
        } as any);
        expect(lockedTime.tryManualDetonate({} as any, {} as any)).toBe(false);
        expect(lockedTime.detonations).toBe(0);

        // Death bomb is gated by CanDetonateDeathBomb, not CanDetonateTimeBomb.
        const lockedDeath = new RecordingTrait();
        lockedDeath.setCharge(-1, 0, { player }, {
            deathBomb: true,
            canDetonateTimeBomb: true,
            canDetonateDeathBomb: false,
        } as any);
        expect(lockedDeath.tryManualDetonate({} as any, {} as any)).toBe(false);
        expect(lockedDeath.detonations).toBe(0);

        const openDeath = new RecordingTrait();
        openDeath.setCharge(-1, 0, { player }, {
            deathBomb: true,
            canDetonateTimeBomb: false,
            canDetonateDeathBomb: true,
        } as any);
        expect(openDeath.tryManualDetonate({} as any, {} as any)).toBe(true);
        expect(openDeath.detonations).toBe(1);

        // Unarmed trait never detonates.
        const unarmed = new RecordingTrait();
        expect(unarmed.tryManualDetonate({} as any, {} as any)).toBe(false);
    });

    test("factory-produced actions carry the new action type", () => {
        const action = new DetonateIvanBombsActionFactory({}).create();
        expect((action as any).actionType).toBe(ActionType.DetonateIvanBombs);
    });

    test("ActionsApi queues the local player action", () => {
        const player = { name: "Local" };
        const game = {
            map: {},
            getPlayerByName: (name: string) => name === player.name ? player : undefined,
        };
        const actionFactory = new ActionFactory();
        new ActionFactoryReg().register(actionFactory, game, player.name);
        const actionQueue = new ActionQueue();
        const api = new ActionsApi(game as any, actionFactory, actionQueue, {
            name: player.name,
            getDebugMode: () => false,
        });

        api.detonateIvanBombs(73);
        const action = actionQueue.dequeueAll()[0] as DetonateIvanBombsAction;

        expect(action).toBeInstanceOf(DetonateIvanBombsAction);
        expect(action.player).toBe(player);
        expect((action as any).objectId).toBe(73);
    });
});
