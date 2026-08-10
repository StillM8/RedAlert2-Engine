import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { SpeedType } from "@/game/type/SpeedType";
import {
    UnitDeliveryEffect,
    resolveUnitDeliveryOwner,
    resolveUnitDeliveryType,
} from "@/game/superweapon/UnitDeliveryEffect";

interface FakeObjectOptions {
    foundation?: any;
    infantry?: boolean;
    aircraft?: boolean;
}

function makePlayer(id: string, isAi = false): any {
    return {
        country: { id, name: id, sideId: id },
        isAi,
        owned: [],
        addOwnedObject(object: any) {
            this.owned.push(object);
            object.owner = this;
        },
        removeOwnedObject(object: any) {
            this.owned = this.owned.filter((owned: any) => owned !== object);
            if (object.owner === this) object.owner = undefined;
        },
    };
}

function makeTile(rx: number, ry: number): any {
    return {
        rx,
        ry,
        dx: rx,
        dy: ry,
        z: 0,
        onBridgeLandType: undefined,
    };
}

function makeGame(objects: Record<string, FakeObjectOptions> = {}): any {
    const spawned: any[] = [];
    const players = [makePlayer("Alpha"), makePlayer("Civilian"), makePlayer("Special"), makePlayer("Neutral")];
    const tileAt = (rx: number, ry: number) => makeTile(rx, ry);
    const rules = {
        general: { flightLevel: 5 },
        hasObject(name: string, type: ObjectType) {
            const definition = objects[name];
            if (!definition) return false;
            if (definition.foundation) return type === ObjectType.Building;
            if (definition.infantry && type === ObjectType.Infantry) return true;
            if (definition.aircraft && type === ObjectType.Aircraft) return true;
            return !definition.infantry && !definition.aircraft && type === ObjectType.Vehicle;
        },
        getObject(name: string) {
            return objects[name];
        },
    };
    const map: any = {
        tiles: { getByMapCoords: tileAt },
        mapBounds: { isWithinBounds: () => true },
        tileOccupation: {
            calculateTilesForGameObject(tile: any, object: any) {
                const foundation = object.getFoundation?.() ?? { width: 1, height: 1 };
                const cells = foundation.cells ?? Array.from({ length: foundation.width * foundation.height }, (_, index) => ({
                    x: Math.floor(index / foundation.height),
                    y: index % foundation.height,
                }));
                return cells.map((cell: any) => tileAt(tile.rx + cell.x, tile.ry + cell.y));
            },
        },
        terrain: {
            getPassableSpeed: () => 1,
            findObstacles: () => [],
        },
        getGroundObjectsOnTile(tile: any) {
            return spawned.filter(object => object.tile?.rx === tile.rx && object.tile?.ry === tile.ry);
        },
    };
    return {
        rules,
        map,
        players,
        spawned,
        getAllPlayers: () => players,
        getCivilianPlayer: () => players[1],
        createObject(type: ObjectType, name: string) {
            const definition = objects[name] ?? {};
            const foundation = definition.foundation ?? { width: 1, height: 1 };
            const object: any = {
                name,
                type,
                rules: {
                    speedType: SpeedType.Track,
                    defaultToGuardArea: false,
                    flightLevel: 7,
                    baseNormal: true,
                },
                art: {
                    foundation,
                    foundationCenter: { x: Math.floor(foundation.width / 2), y: Math.floor(foundation.height / 2) },
                },
                position: {
                    desiredSubCell: 0,
                    subCell: 0,
                    tileElevation: 0,
                },
                isSpawned: false,
                isBuilding: () => type === ObjectType.Building,
                isInfantry: () => definition.infantry === true,
                isVehicle: () => type === ObjectType.Vehicle,
                isAircraft: () => definition.aircraft === true,
                isUnit: () => type !== ObjectType.Building,
                getFoundation: () => foundation,
                dispose() {
                    this.disposed = true;
                },
            };
            return object;
        },
        changeObjectOwner(object: any, player: any) {
            player.addOwnedObject(object);
        },
        spawnObject(object: any, tile: any) {
            object.tile = tile;
            object.isSpawned = true;
            spawned.push(object);
        },
    };
}

describe("Ares UnitDelivery", () => {
    test("resolves documented owner modes without remapping unknown values", () => {
        const game: any = makeGame();
        const invoker = game.players[0];

        expect(resolveUnitDeliveryOwner(undefined, invoker, game)).toBe(invoker);
        expect(resolveUnitDeliveryOwner("civilian", invoker, game)).toBe(game.players[1]);
        expect(resolveUnitDeliveryOwner("special", invoker, game)).toBe(game.players[2]);
        expect(resolveUnitDeliveryOwner("neutral", invoker, game)).toBe(game.players[3]);
        expect(resolveUnitDeliveryOwner("future-owner-mode", invoker, game)).toBe(invoker);
    });

    test("resolves deliverable TechnoTypes across all supported object classes", () => {
        const game = makeGame({
            E1: { infantry: true },
            HARV: {},
            ORCA: { aircraft: true },
            OUTPOST: { foundation: { width: 2, height: 2, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } },
        });

        expect(resolveUnitDeliveryType(game.rules, "E1")).toBe(ObjectType.Infantry);
        expect(resolveUnitDeliveryType(game.rules, "HARV")).toBe(ObjectType.Vehicle);
        expect(resolveUnitDeliveryType(game.rules, "ORCA")).toBe(ObjectType.Aircraft);
        expect(resolveUnitDeliveryType(game.rules, "OUTPOST")).toBe(ObjectType.Building);
        expect(resolveUnitDeliveryType(game.rules, "MISSING")).toBeUndefined();
    });

    test("waits for Antares' default-style deferment before placing a unit", () => {
        const game = makeGame({ E1: { infantry: true } });
        const owner = game.players[0];
        const tile = makeTile(5, 5);
        const effect = new UnitDeliveryEffect("UnitDelivery", owner, tile, ["E1"], 2);

        effect.onStart(game);
        expect(effect.onTick(game)).toBe(false);
        expect(game.spawned).toHaveLength(0);
        expect(effect.onTick(game)).toBe(true);
        expect(game.spawned).toHaveLength(1);
        expect(game.spawned[0].name).toBe("E1");
        expect(game.spawned[0].owner).toBe(owner);
        expect(game.spawned[0].guardMode).toBe(true);
    });

    test("places aircraft in the air after ground-valid delivery placement", () => {
        const game = makeGame({ ORCA: { aircraft: true } });
        const owner = game.players[0];
        const effect = new UnitDeliveryEffect("UnitDelivery", owner, makeTile(5, 5), ["ORCA"], 0);

        expect(effect.onTick(game)).toBe(true);
        expect(game.spawned[0].zone).toBe(1);
        expect(game.spawned[0].position.tileElevation).toBe(7);
    });

    test("uses occupied custom foundation cells and preserves Deliver.BaseNormal=no", () => {
        const foundation = {
            width: 3,
            height: 3,
            cells: [
                { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
                { x: 0, y: 1 }, { x: 1, y: 1 },
                { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
            ],
        };
        const game = makeGame({ OUTPOST: { foundation } });
        const owner = game.players[0];
        const effect = new UnitDeliveryEffect("UnitDelivery", owner, makeTile(5, 5), ["OUTPOST"], 0, undefined, false);

        expect(effect.onTick(game)).toBe(true);
        expect(game.spawned).toHaveLength(1);
        expect(game.spawned[0].baseNormalOverride).toBe(false);
        expect(game.spawned[0].initialFactoryOwnerId).toBe("Alpha");
    });
});
