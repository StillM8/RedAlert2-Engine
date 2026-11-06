import { describe, expect, test } from "bun:test";
import { Alliances } from "@/game/Alliances";
import { ObjectType } from "@/engine/type/ObjectType";
import { Player } from "@/game/Player";
import { PlayerList } from "@/game/PlayerList";
import { Prng } from "@/game/Prng";
import { Replay } from "@/network/gamestate/Replay";
import { captureWorldState, restoreWorldState } from "@/game/state/WorldStateSnapshot";
import { registerObjectTraitFactory } from "@/game/state/ObjectTraitFactoryRegistry";
import { World } from "@/game/World";
import { UnitSelection } from "@/game/gameobject/selection/UnitSelection";

class AttachedTestTrait {
    static readonly runtimeAttachKey = "test.attached";
    targetId: number | null = null;
    constructor(readonly context: { label: string }) { }
    captureContext() { return { label: this.context.label }; }
    captureState() { return { version: 1, targetId: this.targetId }; }
    restoreState(state: any) { this.targetId = state.targetId; }
    getHash() { return this.targetId ?? -1; }
}

registerObjectTraitFactory(AttachedTestTrait.runtimeAttachKey, (context) => new AttachedTestTrait(context));

function makeObject(id: number, owner: Player, tile: any) {
    const trait = {
        deterministicStateKey: "TestTrait",
        value: 1,
        captureState() { return { value: this.value }; },
        restoreState(state: any) { this.value = state.value; },
    };
    const traits: any[] = [trait];
    const object: any = {
        id,
        type: ObjectType.Infantry,
        name: `E${id}`,
        rules: { selectable: true, wall: false },
        owner,
        isSpawned: true,
        isCrashing: false,
        isDestroyed: false,
        isDisposed: false,
        deathType: 0,
        direction: 90,
        zone: 0,
        onBridge: false,
        isFiring: false,
        position: {
            tile,
            subCell: 0,
            tileElevation: 0,
            worldPosition: { y: 0 },
            setAbsoluteElevationWorld() { },
        },
        traits: { getAll: () => traits, add: (added: any) => traits.push(added) },
        isInfantry: () => true,
        isBuilding: () => false,
        isUnit: () => true,
        isProjectile: () => false,
        isDebris: () => false,
        dispose() { },
        testTrait: trait,
    };
    owner.addOwnedObject(object);
    return object;
}

function makeWorld(seed: number) {
    const world = new World();
    const playerList = new PlayerList();
    const owner = new Player("Owner");
    const other = new Player("Other");
    playerList.addPlayer(owner);
    playerList.addPlayer(other);
    const alliances = new Alliances(playerList);
    const tile = { rx: 4, ry: 5, z: 0, rampType: 0 };
    const object = makeObject(1, owner, tile);
    world.spawnObject(object as any);
    const selection = new UnitSelection();
    selection.addToSelection(object as any);
    const game: any = {
        world,
        playerList,
        alliances,
        unitSelection: selection,
        currentTick: 12,
        currentTime: 800,
        nextObjectId: { value: 2 },
        status: 1,
        prng: new Prng(seed),
        map: { tiles: { getByMapCoords: (x: number, y: number) => x === 4 && y === 5 ? tile : undefined } },
        traits: { getAll: () => [] },
        changeObjectOwner: (target: any, nextOwner: any) => {
            target.owner?.removeOwnedObject(target);
            nextOwner.addOwnedObject(target);
            target.owner = nextOwner;
        },
    };
    return { game, world, playerList, owner, other, object, tile };
}

function restore(game: any, state: unknown) {
    restoreWorldState(game, state, {
        strict: true,
        createObject: () => undefined,
        spawnObject: () => undefined,
        unspawnObject: () => undefined,
    });
}

describe("world state snapshot", () => {
    test("round-trips core world, player, selection, PRNG, and trait state", () => {
        const source = makeWorld(11);
        const snapshot = JSON.parse(JSON.stringify(captureWorldState(source.game)));
        const expectedPrngHash = source.game.prng.getHash();
        source.game.currentTick = 99;
        source.game.prng.generateRandomInt(0, 100);
        source.object.testTrait.value = 7;
        source.owner.credits = 4321;
        source.object.direction = 12;

        const target = makeWorld(11);
        restore(target.game, snapshot);

        expect(target.game.currentTick).toBe(12);
        expect(target.game.prng.getHash()).toBe(expectedPrngHash);
        expect(target.owner.credits).toBe(0);
        expect(target.object.direction).toBe(90);
        expect(target.object.testTrait.value).toBe(1);
        expect(target.game.unitSelection.isSelected(target.object as any)).toBe(true);
    });

    test("rejects duplicate object identities transactionally", () => {
        const source = makeWorld(3);
        const snapshot = captureWorldState(source.game) as any;
        snapshot.objects.push({ ...snapshot.objects[0] });
        const target = makeWorld(3);
        expect(() => restore(target.game, snapshot)).toThrow(/duplicate object/i);
        expect(target.object.testTrait.value).toBe(1);
    });

    test("re-attaches runtime traits the object factory does not build", () => {
        const source = makeWorld(5);
        const attached = new AttachedTestTrait({ label: "seeker" });
        attached.targetId = 77;
        source.object.traits.add(attached);
        source.game.addObjectTrait = (object: any, trait: any) => object.traits.add(trait);
        const snapshot = JSON.parse(JSON.stringify(captureWorldState(source.game)));

        expect(snapshot.objects[0].attachedTraits).toEqual([{
            key: "test.attached",
            context: { label: "seeker" },
            state: { version: 1, targetId: 77 },
        }]);
        expect(snapshot.objects[0].traits.map((entry: any) => entry.key))
            .not.toContain("AttachedTestTrait");

        const target = makeWorld(5);
        target.game.addObjectTrait = (object: any, trait: any) => object.traits.add(trait);
        restore(target.game, snapshot);
        const restored = target.object.traits.getAll()
            .find((entry: any) => entry instanceof AttachedTestTrait) as AttachedTestTrait;
        expect(restored).toBeDefined();
        expect(restored.context.label).toBe("seeker");
        expect(restored.targetId).toBe(77);
    });

    test("rejects an attached trait with no registered factory", () => {
        const source = makeWorld(6);
        const snapshot: any = captureWorldState(source.game);
        snapshot.objects[0].attachedTraits = [{
            key: "test.unregistered",
            context: {},
            state: {},
        }];
        const target = makeWorld(6);
        target.game.addObjectTrait = (object: any, trait: any) => object.traits.add(trait);
        expect(() => restore(target.game, snapshot)).toThrow(/has no factory/i);
    });

    test("replay format 3 carries world state and keeps extension format 2", () => {
        const replay = new Replay();
        replay.gameId = "g";
        replay.gameTimestamp = 1;
        replay.engineVersion = "e";
        replay.modHash = "m";
        replay.gameOpts = {};
        replay.finish(4);
        replay.extensionState = { version: 1 };
        const extensionDecoded = new Replay();
        extensionDecoded.unserialize(replay.serialize());
        expect(extensionDecoded.extensionState).toEqual(replay.extensionState);
        replay.worldState = { version: 1 };
        const decoded = new Replay();
        decoded.unserialize(replay.serialize());
        expect(decoded.worldState).toEqual(replay.worldState);
        expect(decoded.extensionState).toEqual(replay.extensionState);
    });
});
