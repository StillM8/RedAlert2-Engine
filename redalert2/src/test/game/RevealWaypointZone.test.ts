import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { TriggerActionType } from "@/data/map/trigger/TriggerActionType";
import { TriggerReader } from "@/data/map/trigger/TriggerReader";
import { TerrainType } from "@/engine/type/TerrainType";
import { EventType } from "@/game/event/EventType";
import { GameEventBus } from "@/game/GameEventBus";
import { MapShroud, ShroudType } from "@/game/map/MapShroud";
import { MapShroudTrait } from "@/game/trait/MapShroudTrait";
import { NotifyTick } from "@/game/trait/interface/NotifyTick";
import { SpeedType } from "@/game/type/SpeedType";
import { TriggerExecutorFactory } from "@/game/trigger/TriggerExecutorFactory";
import { RevealWaypointZoneExecutor } from "@/game/trigger/executor/RevealWaypointZoneExecutor";

function section(name: string, entries: Record<string, string> = {}): IniSection {
    const result = new IniSection(name);
    for (const [key, value] of Object.entries(entries)) {
        result.set(key, value);
    }
    return result;
}

function tile(rx: number, ry: number, z: number = 0, extra: Record<string, any> = {}): any {
    return {
        rx,
        ry,
        z,
        dx: rx + ry,
        dy: rx + ry,
        terrainType: TerrainType.Clear,
        ...extra,
    };
}

function execute(context: any, waypointId: number = 4): void {
    new TriggerExecutorFactory().create({
        type: TriggerActionType.RevealWaypointZone,
        params: [0, waypointId, 0, 0, 0, 0, 99],
        triggerId: "T",
        index: 0,
    }, { name: "T" }).execute(context);
}

function player(overrides: Record<string, any> = {}): any {
    return {
        isAi: false,
        isObserver: false,
        isNeutral: false,
        defeated: false,
        ...overrides,
    };
}

function shroud(calls: any[][]): any {
    return {
        calls,
        revealAround: (...args: any[]) => calls.push(args),
    };
}

function makeContext(options: {
    waypoint: any;
    tiles: any[];
    sameZone: (start: any, end: any, startOnBridge: boolean, endOnBridge: boolean) => boolean;
    players?: any[];
    onZoneCheck?: (start: any, end: any, speedType: SpeedType, startOnBridge: boolean, endOnBridge: boolean) => void;
    waypointId?: number;
    playable?: (tile: any) => boolean;
    tileOccupation?: any;
}): any {
    const waypointId = options.waypointId ?? 4;
    const players = options.players ?? [player()];
    const map: any = {
        getTileAtWaypoint: (id: number) => id === waypointId ? options.waypoint : undefined,
        isWithinBounds: options.playable ?? ((candidate: any) => candidate.playable !== false),
        tiles: { getAll: () => options.tiles },
        terrain: {
            areInSameMovementZone: (start: any, end: any, speedType: SpeedType, startOnBridge: boolean, endOnBridge: boolean) => {
                options.onZoneCheck?.(start, end, speedType, startOnBridge, endOnBridge);
                return options.sameZone(start, end, startOnBridge, endOnBridge);
            },
        },
        tileOccupation: options.tileOccupation ?? {
            getBridgeOnTile: (candidate: any) => candidate.bridge,
        },
    };
    const shrouds = new Map<any, any>();
    for (const candidate of players) {
        shrouds.set(candidate, shroud([]));
    }
    return {
        map,
        mapShroudTrait: {
            getPlayerShroud: (candidate: any) => shrouds.get(candidate),
        },
        getCombatants: () => players,
        getShrouds: shrouds,
    };
}

describe("stock trigger action 18", () => {
    test("parses P2 and registers the factory executor", () => {
        const result = new TriggerReader().read(
            section("Triggers", { T: "Allied,,Test,0,1,1,1,0" }),
            section("Events"),
            section("Actions", { T: "1,18,0,4,0,0,0,0,E" }),
            [{ id: "tag", triggerId: "T", repeatType: 0, name: "Test" }],
        );
        expect(result.unknownActionTypes.size).toBe(0);
        const parsed = result.triggers[0].actions[0];
        expect(parsed.type).toBe(TriggerActionType.RevealWaypointZone);
        expect(parsed.params[1]).toBe("4");
        expect(new TriggerExecutorFactory().create(parsed, { name: "Test" }))
            .toBeInstanceOf(RevealWaypointZoneExecutor);
    });

    test("reveals radius two around matching playable cells for humans only", () => {
        const waypoint = tile(4, 4);
        const matching = tile(5, 5);
        const otherZone = tile(6, 6);
        const border = tile(7, 7, 0, { playable: false });
        const human = player();
        const ai = player({ isAi: true });
        const observer = player({ isObserver: true });
        const context = makeContext({
            waypoint,
            tiles: [waypoint, matching, otherZone, border],
            sameZone: (_start, end) => end === waypoint || end === matching,
            players: [human, ai, observer],
        });

        execute(context);

        expect(context.getShrouds.get(human).calls).toEqual([
            [waypoint, 2, waypoint.z],
            [matching, 2, matching.z],
        ]);
        expect(context.getShrouds.get(ai).calls).toEqual([]);
        expect(context.getShrouds.get(observer).calls).toEqual([]);
    });

    test("rejects missing and out-of-bounds waypoints", () => {
        const waypoint = tile(4, 4);
        const human = player();
        const context = makeContext({
            waypoint,
            tiles: [waypoint],
            sameZone: () => true,
            players: [human],
        });
        execute(context, 8);
        expect(context.getShrouds.get(human).calls).toEqual([]);

        const outside = tile(9, 9, 0, { playable: false });
        const outsideContext = makeContext({
            waypoint: outside,
            tiles: [outside],
            sameZone: () => true,
            players: [human],
        });
        execute(outsideContext);
        expect(outsideContext.getShrouds.get(human).calls).toEqual([]);
    });

    test("passes bridge state and excludes border cells from the zone scan", () => {
        const bridge = tile(4, 4, 0, { bridge: {} });
        const ground = tile(5, 5);
        const border = tile(6, 6, 0, { playable: false });
        const checks: any[] = [];
        const human = player();
        const context = makeContext({
            waypoint: bridge,
            tiles: [bridge, ground, border],
            sameZone: (_start, end, _startOnBridge, endOnBridge) => endOnBridge,
            players: [human],
            onZoneCheck: (start, end, speedType, startOnBridge, endOnBridge) => {
                checks.push({ start, end, speedType, startOnBridge, endOnBridge });
            },
        });

        execute(context);

        expect(checks.some((check) => check.end === border)).toBe(false);
        expect(checks.some((check) => check.end === bridge && check.startOnBridge && check.endOnBridge)).toBe(true);
        expect(checks.find((check) => check.end === bridge).speedType).toBe(SpeedType.Track);
    });

    test("routes queued reveals through shroud discovery events", () => {
        const cell = tile(2, 2);
        const tileMap: any = {
            getMapSize: () => ({ width: 5, height: 5 }),
            getMaxTileHeight: () => 0,
            getAll: () => [cell],
            getByMapCoords: () => cell,
        };
        const tileOccupation: any = {
            onChange: { subscribe: () => {}, unsubscribe: () => {} },
            calculateTilesForGameObject: () => [cell],
            getBridgeOnTile: () => undefined,
        };
        const human = player({
            name: "Human",
            buildings: new Set<any>(),
            getOwnedObjects: () => [],
        });
        const enemy = player({ name: "Enemy" });
        const object: any = {
            tile: cell,
            tileElevation: 0,
            owner: enemy,
            isSpawned: true,
            isDestroyed: false,
            isDisposed: false,
            isTechno: () => true,
        };
        const events = new GameEventBus();
        const discovered: any[] = [];
        const discoveredHouses: any[] = [];
        events.subscribe(EventType.ObjectDiscovered, (event: any) => discovered.push(event));
        events.subscribe(EventType.HouseDiscovered, (event: any) => discoveredHouses.push(event));
        const map: any = {
            tiles: tileMap,
            tileOccupation,
            terrain: { areInSameMovementZone: () => true },
            isWithinBounds: () => true,
            getTileAtWaypoint: () => cell,
        };
        const game: any = {
            map,
            events,
            getCombatants: () => [human],
            getWorld: () => ({ getAllObjects: () => [object] }),
            alliances: { getAllies: () => [] },
        };
        const trait = new MapShroudTrait(map, game.alliances);
        trait.init(game);
        const context: any = {
            map,
            mapShroudTrait: trait,
            getCombatants: () => [human],
        };

        execute(context);
        expect(trait.getPlayerShroud(human).getShroudType(cell)).toBe(ShroudType.Unexplored);
        (trait as any)[NotifyTick.onTick](game);

        expect(trait.getPlayerShroud(human).getShroudType(cell)).toBe(ShroudType.Explored);
        expect(discovered).toHaveLength(1);
        expect(discovered[0].target).toBe(object);
        expect(discovered[0].player).toBe(human);
        expect(discoveredHouses).toHaveLength(1);
        expect(discoveredHouses[0].house).toBe(enemy);
    });

    test("keeps the existing elevation contract for the new reveal path", () => {
        const low = tile(2, 2, 0);
        const high = tile(3, 2, 4);
        const map: any = {
            getMapSize: () => ({ width: 6, height: 6 }),
            getMaxTileHeight: () => 4,
            getAll: () => [low, high],
        };
        const shroud = new MapShroud().fromTiles(map);
        shroud.revealAround(low, 2, low.z);
        shroud.update();
        expect(shroud.getShroudType(high)).toBe(ShroudType.Unexplored);
    });
});
