import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { TriggerEventType } from "@/data/map/trigger/TriggerEventType";
import { TriggerReader } from "@/data/map/trigger/TriggerReader";
import { ObjectType } from "@/engine/type/ObjectType";
import { TerrainType } from "@/engine/type/TerrainType";
import { EventType } from "@/game/event/EventType";
import { ObjectSelectedEvent } from "@/game/event/ObjectSelectedEvent";
import { GameEventBus } from "@/game/GameEventBus";
import { MapShroudTrait } from "@/game/trait/MapShroudTrait";
import { NotifyTick } from "@/game/trait/interface/NotifyTick";
import { UnitSelection } from "@/game/gameobject/selection/UnitSelection";
import { SellTrait } from "@/game/trait/SellTrait";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { MovementZone } from "@/game/type/MovementZone";
import { TriggerConditionFactory } from "@/game/trigger/TriggerConditionFactory";

function section(name: string, entries: Record<string, string> = {}): IniSection {
    const result = new IniSection(name);
    for (const [key, value] of Object.entries(entries)) {
        result.set(key, value);
    }
    return result;
}

function houseContext() {
    const player = {
        name: "Player",
        country: { id: "Alpha", name: "Alpha" },
        startLocation: 0,
        isNeutral: false,
    };
    const enemy = {
        name: "Enemy",
        country: { id: "Beta", name: "Beta" },
        startLocation: 1,
        isNeutral: false,
    };
    return {
        player,
        enemy,
        context: {
            getAllPlayers: () => [player, enemy],
            rules: {
                getMultiplayerCountries: () => [{ id: "Alpha" }, { id: "Beta" }],
            },
        },
    };
}

describe("stock trigger events", () => {
    test("parses Zone Entry By ID 24", () => {
        const result = new TriggerReader().read(
            section("Triggers", { T: "Allied,,Test,0,1,1,1,0" }),
            section("Events", { T: "1,24,0,2" }),
            section("Actions"),
            [{ id: "tag", triggerId: "T", repeatType: 0, name: "Test" }],
        );
        expect(result.unknownEventTypes.size).toBe(0);
        expect(result.triggers[0].events).toEqual([{
            triggerId: "T",
            eventIndex: 0,
            type: TriggerEventType.ZoneEntryBy,
            params: [0, "2"],
        }]);
    });

    test("keeps stock destruction IDs distinct", () => {
        expect(TriggerEventType.DestroyedByAnythingExceptInfiltration).toBe(29);
        expect(TriggerEventType.DestroyedByAnything).toBe(48);
    });

    test("event 29 excludes infiltration while event 48 includes it and sell", () => {
        const target = { isTechno: () => true };
        const factory = new TriggerConditionFactory();
        const trigger = { houseName: "Alpha" };
        const exceptInfiltration = factory.create({ type: 29, params: [0, "0"] }, trigger);
        const anything = factory.create({ type: 48, params: [0, "0"] }, trigger);
        exceptInfiltration.setTargets([target]);
        anything.setTargets([target]);
        expect(exceptInfiltration.check({}, [{ type: EventType.ObjectDestroy, target }])).toEqual([target]);
        expect(exceptInfiltration.check({}, [{ type: EventType.ObjectSell, target }])).toEqual([target]);
        expect(exceptInfiltration.check({}, [{ type: EventType.ObjectOwnerChange, target }])).toEqual([target]);
        expect(exceptInfiltration.check({}, [{ type: EventType.BuildingCapture, target }])).toEqual([target]);
        expect(exceptInfiltration.check({}, [{ type: EventType.BuildingInfiltration, target }])).toEqual([]);
        expect(anything.check({}, [{ type: EventType.ObjectDestroy, target }])).toEqual([target]);
        expect(anything.check({}, [{ type: EventType.ObjectSell, target }])).toEqual([target]);
        expect(anything.check({}, [{ type: EventType.ObjectOwnerChange, target }])).toEqual([target]);
        expect(anything.check({}, [{ type: EventType.BuildingInfiltration, target }])).toEqual([target]);
    });

    test("discovery, house discovery, and selection consume numeric EventType events", () => {
        const { player, enemy, context } = houseContext();
        const target = { isTechno: () => true };
        const factory = new TriggerConditionFactory();
        const trigger = { houseName: "Alpha" };
        const discovered = factory.create({ type: 4, params: [0, "0"] }, trigger);
        const houseDiscovered = factory.create({ type: 5, params: [0, "Beta"] }, trigger);
        const selected = factory.create({ type: 33, params: [0, "0"] }, trigger);
        discovered.init(context);
        houseDiscovered.init(context);
        selected.init(context);
        discovered.setTargets([target]);
        houseDiscovered.setTargets([]);
        selected.setTargets([target]);
        expect(discovered.check(context, [{ type: EventType.ObjectDiscovered, target, player }])).toBe(true);
        expect(discovered.check(context, [{ type: EventType.ObjectDiscovered, target, player, attacker: true }])).toBe(true);
        expect(discovered.check(context, [{ type: "ObjectDiscovered", target, player }])).toBe(false);
        expect(houseDiscovered.check(context, [{ type: EventType.HouseDiscovered, house: enemy, player }])).toBe(true);
        expect(selected.check(context, [{ type: EventType.ObjectSelected, target, player }])).toEqual([target]);
    });

    test("Zone Entry By accepts matching ground movement and rejects air", () => {
        const { player, context } = houseContext();
        const tile = {};
        const condition = new TriggerConditionFactory().create(
            { type: TriggerEventType.ZoneEntryBy, params: [0, "Alpha"] },
            { houseName: "Alpha" },
        );
        condition.init(context);
        condition.setTargets([tile]);
        expect(condition.check(context, [{
            type: EventType.EnterTile,
            target: tile,
            source: { owner: player, zone: ZoneType.Ground, isUnit: () => true },
        }])).toEqual([tile]);
        expect(condition.check(context, [{
            type: EventType.EnterTile,
            target: tile,
            source: { owner: player, zone: ZoneType.Air, isUnit: () => true },
        }])).toEqual([]);
        const taggedCell = {};
        const destination = {};
        condition.setTargets([taggedCell]);
        expect(condition.check({
            ...context,
            map: { terrain: { areInSameMovementZone: () => true } },
        }, [{
            type: EventType.EnterTile,
            target: destination,
            source: {
                owner: player,
                zone: ZoneType.Ground,
                isUnit: () => true,
                rules: { speedType: 0, movementZone: MovementZone.Normal },
            },
        }])).toEqual([destination]);
    });

    test("Build Object Type filters by the trigger owner", () => {
        const { player, context } = houseContext();
        const other = { name: "Other", country: { id: "Beta" }, startLocation: 1 };
        const condition = new TriggerConditionFactory().create(
            { type: TriggerEventType.BuildBuilding, params: [0, 7] },
            { houseName: "Alpha" },
        );
        condition.init({ ...context, getAllPlayers: () => [player, other] });
        const event = {
            type: EventType.ObjectSpawn,
            gameObject: { type: ObjectType.Building, rules: { index: 7 }, owner: player },
        };
        expect(condition.check(context, [event])).toBe(true);
        expect(condition.check(context, [{
            ...event,
            gameObject: { ...event.gameObject, owner: other },
        }])).toBe(false);
    });

    test("selection producer emits one numeric ObjectSelected event", () => {
        const events: any[] = [];
        const player = { name: "Player" };
        const unit: any = {
            isBuilding: () => false,
            rules: { selectable: true },
            isSpawned: true,
            isDestroyed: false,
            isDisposed: false,
            owner: player,
        };
        const selection = new UnitSelection();
        selection.setEventSink((selected) => events.push(new ObjectSelectedEvent(selected, player)));
        selection.addToSelection(unit);
        selection.addToSelection(unit);
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe(EventType.ObjectSelected);
        expect(events[0].target).toBe(unit);
        expect(events[0].player).toBe(player);
    });

    test("discovery producer emits object and house events after shroud visibility", () => {
        const tile = { rx: 0, ry: 0, z: 0, terrainType: TerrainType.Clear };
        const tiles = {
            getMapSize: () => ({ width: 1, height: 1 }),
            getMaxTileHeight: () => 0,
            getAll: () => [tile],
            getByMapCoords: () => tile,
        };
        const tileOccupation = {
            onChange: { subscribe: () => {}, unsubscribe: () => {} },
            calculateTilesForGameObject: () => [tile],
        };
        const map: any = { tiles, tileOccupation };
        const player: any = {
            name: "Player",
            country: { id: "Alpha", name: "Alpha" },
            isObserver: false,
            isNeutral: false,
            defeated: false,
            buildings: new Set<any>(),
            getOwnedObjects: () => [],
        };
        const enemy: any = {
            name: "Enemy",
            country: { id: "Beta", name: "Beta" },
            isObserver: false,
            isNeutral: false,
            defeated: false,
        };
        const object: any = {
            tile,
            tileElevation: 0,
            owner: enemy,
            isSpawned: true,
            isDestroyed: false,
            isDisposed: false,
            isTechno: () => true,
            isBuilding: () => false,
        };
        const events = new GameEventBus();
        const game: any = {
            map,
            events,
            getCombatants: () => [player],
            getWorld: () => ({ getAllObjects: () => [object] }),
            alliances: { getAllies: () => [] },
        };
        const discoveries: any[] = [];
        const houses: any[] = [];
        events.subscribe(EventType.ObjectDiscovered, (event: any) => discoveries.push(event));
        events.subscribe(EventType.HouseDiscovered, (event: any) => houses.push(event));
        const trait = new MapShroudTrait(map, game.alliances);
        trait.init(game);
        player.buildings.add({ isSpawned: true, isDestroyed: false, rules: { spySat: true }, owner: player });
        (trait as any)[NotifyTick.onTick](game);
        expect(discoveries).toHaveLength(1);
        expect(discoveries[0].type).toBe(EventType.ObjectDiscovered);
        expect(discoveries[0].target).toBe(object);
        expect(discoveries[0].player).toBe(player);
        expect(houses).toHaveLength(1);
        expect(houses[0].type).toBe(EventType.HouseDiscovered);
        expect(houses[0].house).toBe(enemy);
        expect(houses[0].player).toBe(player);
    });

    test("sell producer emits ObjectSell for the destruction conditions", () => {
        const events: any[] = [];
        let disposed = false;
        const target: any = {
            isBuilding: () => true,
            isTechno: () => true,
            rules: { unsellable: false, soylent: 100, wall: false },
            traits: { filter: () => [] },
            owner: { credits: 0, isAi: false },
            dispose: () => { disposed = true; },
        };
        const game: any = {
            events: { dispatch: (event: any) => events.push(event) },
            getConstructionWorker: () => ({ unplace: (_object: any, callback: () => void) => callback() }),
        };
        new SellTrait(game, { refundPercent: 1 }).sell(target);
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe(EventType.ObjectSell);
        expect(events[0].target).toBe(target);
        expect(disposed).toBe(true);
    });
});
