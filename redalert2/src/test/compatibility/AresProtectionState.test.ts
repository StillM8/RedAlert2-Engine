import { describe, expect, test } from "bun:test";
import { InvulnerableTrait } from "@/game/gameobject/trait/InvulnerableTrait";
import { MindControllableTrait } from "@/game/gameobject/trait/MindControllableTrait";
import { MindControllerTrait } from "@/game/gameobject/trait/MindControllerTrait";
import { captureExtensionState, restoreExtensionState } from "@/game/state/ExtensionStateSnapshot";

function player(name: string, playerListIndex: number): any {
    return { name, playerListIndex };
}

function worldFor(players: any[]): any {
    return {
        currentTick: 10,
        changeObjectOwner(object: any, owner: any) {
            object.owner = owner;
        },
        players,
    };
}

function controllable(id: number, name: string, owner: any, building = false): any {
    const object: any = {
        id,
        name,
        owner,
        isDisposed: false,
        isDestroyed: false,
        isBuilding: () => building,
        mindControllerTrait: undefined,
        traits: { getAll: () => [] },
    };
    object.mindControllableTrait = new MindControllableTrait(object, {
        getPlayerIndex: (candidate: any) => candidate?.playerListIndex,
    });
    return object;
}

function controller(id: number, name: string, owner: any, capacity = 1): any {
    const object: any = { id, name, owner, traits: { getAll: () => [] } };
    object.mindControllerTrait = new MindControllerTrait(object, capacity);
    return object;
}

describe("Ares protection and mind-control state", () => {
    test("keeps Iron Curtain state deterministic, capped, and versioned", () => {
        const trait = new InvulnerableTrait();
        trait.applyIronCurtain(100, -1, 0.5, 10);
        expect(trait.isIronCurtained()).toBe(true);
        expect(trait.getRemainingFrames()).toBe(50);
        const state = trait.captureState();
        expect(state).toMatchObject({
            version: 1,
            remainingFrames: 50,
            initialFrames: 50,
            activeSince: 10,
            source: "iron-curtain",
        });
        expect(trait.getHash()).not.toBe(new InvulnerableTrait().getHash());

        const restored = new InvulnerableTrait();
        restored.restoreState(state);
        expect(restored.captureState()).toEqual(state);
        expect(() => restored.restoreState({ ...state, version: 2 })).toThrow(/version/i);

        const timestampless = new InvulnerableTrait();
        timestampless.setActiveFor(12);
        const timestamplessCopy = new InvulnerableTrait();
        timestamplessCopy.restoreState(timestampless.captureState());
        expect(timestamplessCopy.getRemainingFrames()).toBe(12);
    });

    test("lets ordinary mind control restore and blocks permanent targets from recapture", () => {
        const ownerA = player("A", 0);
        const ownerB = player("B", 1);
        const world = worldFor([ownerA, ownerB]);
        const target = controllable(10, "Target", ownerA);
        const mindController = controller(20, "Dominator", ownerB, 1);

        expect(mindController.mindControllerTrait.control(target, world)).toBe(true);
        expect(target.owner).toBe(ownerB);
        expect(mindController.mindControllerTrait.isAtCapacity()).toBe(true);
        target.mindControllableTrait.restore(world);
        expect(target.owner).toBe(ownerA);
        expect(mindController.mindControllerTrait.getTargets()).toEqual([]);

        expect(target.mindControllableTrait.capturePermanent(ownerB, world)).toBe(true);
        expect(target.mindControllableTrait.isPermanent()).toBe(true);
        expect(target.mindControllableTrait.canBeMindControlled()).toBe(false);
        expect(mindController.mindControllerTrait.control(target, world)).toBe(false);
    });

    test("round-trips unlimited mind-controller capacity without non-JSON values", () => {
        const source = controller(20, "Mastermind", player("B", 1), Number.POSITIVE_INFINITY);
        const state = source.mindControllerTrait.captureState();
        expect(state.maxCapacity).toBeNull();
        const replacement = controller(20, "Replacement", player("B", 1), 1);
        replacement.mindControllerTrait.restoreState(state);
        expect(replacement.mindControllerTrait.isAtCapacity()).toBe(false);
        expect(replacement.mindControllerTrait.captureState()).toEqual(state);
        replacement.mindControllerTrait.restoreState({ ...state, maxCapacity: Number.POSITIVE_INFINITY });
        expect(replacement.mindControllerTrait.isAtCapacity()).toBe(false);
    });

    test("captures and strictly restores protection and permanent control state", () => {
        const ownerA = player("A", 0);
        const ownerB = player("B", 1);
        const target = controllable(10, "Target", ownerA, true);
        const protection = new InvulnerableTrait();
        protection.applyIronCurtain(80, -1, 1, 10);
        target.invulnerableTrait = protection;
        target.mindControllableTrait.capturePermanent(ownerB, { changeObjectOwner: (object: any, owner: any) => { object.owner = owner; } } as any);
        const game: any = {
            playerList: { getAll: () => [ownerA, ownerB] },
            world: { getAllObjects: () => [target], changeObjectOwner: (object: any, owner: any) => { object.owner = owner; } },
        };
        const snapshot = captureExtensionState(game);
        expect(snapshot.protectionStates).toHaveLength(1);
        expect(snapshot.mindControlStates).toHaveLength(1);

        const replacement = controllable(10, "Replacement", ownerA, true);
        replacement.invulnerableTrait = new InvulnerableTrait();
        const replacementGame: any = {
            playerList: { getAll: () => [ownerA, ownerB] },
            world: { getAllObjects: () => [replacement], changeObjectOwner: (object: any, owner: any) => { object.owner = owner; } },
        };
        restoreExtensionState(replacementGame, snapshot, { strict: true });
        expect(replacement.invulnerableTrait?.captureState()).toEqual(snapshot.protectionStates?.[0]?.state);
        expect(replacement.mindControllableTrait.isPermanent()).toBe(true);
        expect(replacement.owner).toBe(ownerB);
    });
});
