import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { LandType } from "@/game/type/LandType";
import { TerrainType } from "@/engine/type/TerrainType";
import { EventType } from "@/game/event/EventType";
import { HealthTrait } from "@/game/gameobject/trait/HealthTrait";
import { AresLaserFenceRuntime, getLaserFenceArtFrame, getLaserFenceDirection, isLaserFenceActive, parseAresLaserFenceRules, parseAresWallTower } from "@/extensions/ares/AresLaserFences";
import { AresLaserFenceTrait } from "@/game/gameobject/trait/AresLaserFenceTrait";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";
import { Warhead } from "@/game/Warhead";
import { WarheadRules } from "@/game/rules/WarheadRules";
import { fnv32aStrings } from "@/util/math";

type Listener = (event: any) => void;

function makeTile(x: number, y: number) {
    return { rx: x, ry: y, z: 0, dx: x, dy: y, landType: LandType.Clear, terrainType: TerrainType.Clear, rampType: 0 };
}

function makeGame() {
    const objects: any[] = [];
    const tiles = new Map<string, any>();
    for (let x = -1; x <= 8; x++) {
        for (let y = -1; y <= 8; y++) tiles.set(`${x},${y}`, makeTile(x, y));
    }
    const events = new Map<EventType, Listener[]>();
    const destroyed: any[] = [];
    const postRules = { name: "FAPOST", type: 2, laserFencePost: true, powered: true, power: -20, guardRange: 7, foundation: { width: 1, height: 1 } };
    const fenceRules = { name: "FAFNCE", type: 2, laserFence: true, foundation: { width: 1, height: 1 } };
    const alternateFenceRules = { name: "MIXFNCE", type: 2, laserFence: true, foundation: { width: 1, height: 1 } };
    const owner = { name: "owner", playerListIndex: 0, isNeutral: false, powerTrait: { isLowPower: () => false } };
    const rules = {
        buildingRules: new Map<string, any>([["FAFNCE", fenceRules], ["MIXFNCE", alternateFenceRules], ["FAPOST", postRules]]),
        general: { wallTower: "FAPOST" },
        getLandRules: () => ({ isBuildable: () => true }),
    };
    let nextId = 1;
    const getTile = (x: number, y: number) => tiles.get(`${x},${y}`);
    const getObjects = (tile: any) => objects.filter(object => object.isSpawned !== false && object.tile?.rx === tile?.rx && object.tile?.ry === tile?.ry);
    const makeObject = (name: string, id = nextId++): any => {
        const objectRules = name === "FAPOST" ? postRules : name === "MIXFNCE" ? alternateFenceRules : fenceRules;
        let powered = true;
        const object: any = {
            id,
            name,
            rules: objectRules,
            owner,
            tile: undefined,
            centerTile: undefined,
            isSpawned: false,
            isDestroyed: false,
            isDisposed: false,
            isBuilding: () => true,
            isTechno: () => true,
            isUnit: () => false,
            isInfantry: () => false,
            isVehicle: () => false,
            isAircraft: () => false,
            isOverlay: () => false,
            isTerrain: () => false,
            isSmudge: () => false,
            art: { foundation: { width: 1, height: 1 } },
            healthTrait: undefined,
            poweredTrait: name === "FAPOST" ? { isPoweredOn: () => powered } : undefined,
            empTrait: { isUnderEMP: () => false },
            setPowered: (value: boolean) => { powered = value; },
            dispose: () => { object.isDisposed = true; },
        };
        object.healthTrait = new HealthTrait(100, object as any, 0.5, 0.25);
        object.traits = { getAll: () => [] };
        return object;
    };
    const game: any = {
        owner,
        currentTick: 0,
        map: {
            tiles: { getByMapCoords: getTile },
            getObjectsOnTile: getObjects,
            getGroundObjectsOnTile: getObjects,
            tileOccupation: {
                getObjectsOnTile: getObjects,
                refreshTile: () => undefined,
            },
        },
        rules,
        world: { getAllObjects: () => objects.slice() },
        events: {
            subscribe: (type: EventType, listener: Listener) => {
                const list = events.get(type) ?? [];
                list.push(listener);
                events.set(type, list);
                return () => {
                    const current = events.get(type) ?? [];
                    const index = current.indexOf(listener);
                    if (index >= 0) current.splice(index, 1);
                };
            },
            dispatch: (event: any) => {
                for (const listener of events.get(event.type) ?? []) listener(event);
            },
        },
        createObject: (_type: number, name: string) => makeObject(name),
        changeObjectOwner: (object: any, newOwner: any) => { object.owner = newOwner; },
        spawnObject: (object: any, tile: any) => {
            object.tile = tile;
            object.centerTile = tile;
            object.isSpawned = true;
            objects.push(object);
            const trait = new AresLaserFenceTrait(object);
            object.traits.getAll = () => [trait];
            trait[NotifySpawn.onSpawn](object, game);
        },
        unspawnObject: (object: any) => {
            const index = objects.indexOf(object);
            if (index >= 0) objects.splice(index, 1);
            object.isSpawned = false;
            for (const listener of events.get(EventType.ObjectUnspawn) ?? []) listener({ type: EventType.ObjectUnspawn, gameObject: object });
        },
        destroyObject: (object: any) => {
            if (object.isDestroyed) return;
            object.isDestroyed = true;
            destroyed.push(object);
            const index = objects.indexOf(object);
            if (index >= 0) objects.splice(index, 1);
        },
        _objects: objects,
        _destroyed: destroyed,
        _events: events,
    };
    const runtime = new AresLaserFenceRuntime();
    runtime.attach(game);
    game.aresLaserFenceRuntime = runtime;
    return { game, runtime, owner, postRules, fenceRules, alternateFenceRules, makeObject, getObjects };
}

function spawnPost(game: any, x: number, y: number, id: number, owner = game.owner) {
    const post = game.createObject(2, "FAPOST");
    post.id = id;
    post.owner = owner;
    game.spawnObject(post, game.map.tiles.getByMapCoords(x, y));
    return post;
}

function spawnUnit(game: any, x: number, y: number, id: number) {
    const unit: any = {
        id,
        name: "UNIT",
        owner: game.owner,
        tile: game.map.tiles.getByMapCoords(x, y),
        isSpawned: true,
        isDestroyed: false,
        isDisposed: false,
        isUnit: () => true,
        isBuilding: () => false,
        isTechno: () => true,
        isCrashing: false,
        zone: 0,
        rules: {},
        healthTrait: { health: 100, getHitPoints: () => 100 },
        dispose: () => undefined,
    };
    game._objects.push(unit);
    return unit;
}

function triggerPostPower(post: any, value: boolean) {
    let current = value;
    post.poweredTrait = { isPoweredOn: () => current };
    post.setPowered = (next: boolean) => { current = next; };
}

function makeUnitWarhead() {
    const section = new IniSection("TestWarhead");
    section.set("Verses", "1");
    return new Warhead(new WarheadRules(section));
}

describe("Ares laser fences", () => {
    test("parses both flags with false defaults and reads WallTower", () => {
        const empty = new IniSection("Empty");
        expect(parseAresLaserFenceRules(empty)).toEqual({ laserFencePost: false, laserFence: false });
        const enabled = new IniSection("Enabled");
        enabled.set("LaserFencePost", "yes");
        enabled.set("LaserFence", "1");
        expect(parseAresLaserFenceRules(enabled)).toEqual({ laserFencePost: true, laserFence: true });
        expect(parseAresWallTower(" FAPOST ")).toBe("FAPOST");
        expect(parseAresWallTower("none")).toBeUndefined();
        expect(parseAresWallTower(undefined)).toBeUndefined();
    });

    test("builds canonical mixed authored connections and rotation frames", () => {
        const { game, runtime } = makeGame();
        const first = spawnPost(game, 0, 0, 10);
        const second = spawnPost(game, 4, 0, 11);
        const mixed = game.createObject(2, "MIXFNCE");
        mixed.id = 12;
        game.spawnObject(mixed, game.map.tiles.getByMapCoords(2, 0));
        runtime.reconcile(game);
        const fences = game._objects.filter(object => object.rules.laserFence);
        expect(fences.map(object => object.name).sort()).toEqual(["FAFNCE", "FAFNCE", "MIXFNCE"]);
        expect(fences.every(object => object.laserFenceConnectionMask === 0b1010)).toBe(true);
        expect(fences.every(object => object.laserFenceDirection === 90)).toBe(true);
        expect(fences.every(object => object.laserFencePostIds.includes(first.id) && object.laserFencePostIds.includes(second.id))).toBe(true);
        expect(getLaserFenceArtFrame(0b1010, true, 32)).toBe(10);
        expect(getLaserFenceArtFrame(0b1010, false, 32)).toBe(26);
        expect(getLaserFenceArtFrame(0b1010, false, 64)).toBe(42);
        expect(getLaserFenceDirection(0b1010)).toBe(90);
    });

    test("does not create a connection for adjacent posts", () => {
        const { game, runtime } = makeGame();
        const first = spawnPost(game, 0, 0, 70);
        const second = spawnPost(game, 1, 0, 71);
        runtime.reconcile(game);
        expect(first.laserFenceConnectedPostIds).toEqual([]);
        expect(second.laserFenceConnectedPostIds).toEqual([]);
        expect(game._objects.filter(object => object.rules.laserFence)).toHaveLength(0);
    });

    test("uses each post's GuardRange and recomputes asymmetric reach", () => {
        const { game, runtime, postRules } = makeGame();
        const first = spawnPost(game, 0, 0, 72);
        const second = spawnPost(game, 3, 0, 73);
        first.rules = { ...postRules, guardRange: 2, range: 0 };
        second.rules = { ...postRules, guardRange: 4, range: 0 };
        runtime.reconcile(game);
        expect(game._objects.filter(object => object.rules.laserFence)).toHaveLength(2);
        expect(first.laserFenceConnectedPostIds).toEqual([second.id]);
        expect(second.laserFenceConnectedPostIds).toEqual([first.id]);
        second.rules = { ...second.rules, guardRange: 1 };
        runtime.reconcile(game);
        expect(game._objects.filter(object => object.rules.laserFence)).toHaveLength(0);
    });

    test("uses post center cells for topology coordinates", () => {
        const { game, runtime } = makeGame();
        const first = spawnPost(game, 0, 0, 74);
        const second = spawnPost(game, 4, 0, 75);
        first.tile = game.map.tiles.getByMapCoords(-1, 0);
        second.tile = game.map.tiles.getByMapCoords(3, 0);
        first.centerTile = game.map.tiles.getByMapCoords(0, 0);
        second.centerTile = game.map.tiles.getByMapCoords(4, 0);
        runtime.reconcile(game);
        expect(game._objects.filter(object => object.rules.laserFence).map(object => object.tile.rx)).toEqual([1, 2, 3]);
    });

    test("removes obstruction on power loss and sweeps a crossing exactly once on restore", () => {
        const { game, runtime } = makeGame();
        const first = spawnPost(game, 0, 0, 20);
        const second = spawnPost(game, 3, 0, 21);
        runtime.reconcile(game);
        const fence = game._objects.find(object => object.rules.laserFence && object.tile.rx === 1);
        expect(fence).toBeDefined();
        expect(isLaserFenceActive(fence)).toBe(true);
        const unit = spawnUnit(game, 1, 0, 22);
        triggerPostPower(first, false);
        triggerPostPower(second, false);
        runtime.reconcile(game);
        expect(game._objects).toContain(fence);
        expect(game._objects.filter(object => object.rules.laserFence)).toHaveLength(2);
        expect(isLaserFenceActive(fence)).toBe(false);
        expect(game._destroyed).toEqual([]);
        triggerPostPower(first, true);
        triggerPostPower(second, true);
        runtime.reconcile(game);
        runtime.reconcile(game);
        expect(game._destroyed).toEqual([unit]);
        expect(unit.isDestroyed).toBe(true);
    });

    test("removes all connected art when a post is destroyed", () => {
        const { game, runtime } = makeGame();
        const post = spawnPost(game, 0, 0, 30);
        spawnPost(game, 3, 0, 31);
        runtime.reconcile(game);
        expect(game._objects.filter(object => object.rules.laserFence)).toHaveLength(2);
        runtime.detach(post, game, true);
        expect(game._objects.filter(object => object.rules.laserFence)).toHaveLength(0);
    });

    test("keeps normal damage invariant for fence sections", () => {
        const { game } = makeGame();
        const fence = game.createObject(2, "FAFNCE");
        const warhead = makeUnitWarhead();
        expect(warhead.computeDamage(100, fence, game)).toBe(0);
        const world = { traits: { filter: () => [] }, events: { dispatch: () => undefined } } as any;
        fence.healthTrait.inflictDamage(50, fence, world);
        expect(fence.healthTrait.health).toBe(100);
    });

    test("owner changes reset old art and EMP removes and restores power", () => {
        const { game, runtime } = makeGame();
        const first = spawnPost(game, 0, 0, 40);
        const second = spawnPost(game, 3, 0, 41);
        runtime.reconcile(game);
        expect(game._objects.filter(object => object.rules.laserFence)).toHaveLength(2);
        const otherOwner = { name: "other", playerListIndex: 1, powerTrait: { isLowPower: () => false } };
        second.owner = otherOwner;
        runtime.detach(second, game, true);
        runtime.reconcile(game);
        expect(game._objects.filter(object => object.rules.laserFence)).toHaveLength(0);
        second.owner = game.owner;
        runtime.reconcile(game);
        expect(game._objects.filter(object => object.rules.laserFence)).toHaveLength(2);
        first.empTrait.isUnderEMP = () => true;
        runtime.reconcile(game);
        expect(game._objects.filter(object => object.rules.laserFence).every(object => !isLaserFenceActive(object))).toBe(true);
        first.empTrait.isUnderEMP = () => false;
        runtime.reconcile(game);
        expect(game._objects.filter(object => object.rules.laserFence).every(object => isLaserFenceActive(object))).toBe(true);
    });

    test("hash and versioned snapshot round-trip deterministically", () => {
        const source = makeGame();
        spawnPost(source.game, 0, 0, 50);
        spawnPost(source.game, 3, 0, 51);
        source.runtime.reconcile(source.game);
        const snapshot = JSON.parse(JSON.stringify(source.runtime.captureState()));
        const target = makeGame();
        spawnPost(target.game, 0, 0, 50);
        spawnPost(target.game, 3, 0, 51);
        target.runtime.reconcile(target.game);
        target.runtime.restoreState(snapshot, true);
        expect(target.runtime.captureState()).toEqual(source.runtime.captureState());
        expect(target.runtime.getHash()).toBe(source.runtime.getHash());
        expect(fnv32aStrings([snapshot.version, snapshot.posts.length, snapshot.fences.length])).toBe(fnv32aStrings([1, 2, 2]));
        expect(() => target.runtime.validateState({ ...snapshot, version: 2 }, true)).toThrow(/version/i);
    });
});
