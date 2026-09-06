import { describe, expect, test } from "bun:test";
import {
    AresAnimationDamageRuntime,
    type AresAnimationDamageDefinition,
} from "@/extensions/ares/AresAnimationDamageRuntime";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

const definition: AresAnimationDamageDefinition = {
    name: "RuntimeBlast",
    damage: 0.5,
    damageDelay: 0,
    rate: 15,
    start: 0,
    end: 12,
    loopStart: 2,
    loopEnd: 8,
    loopCount: -1,
    reverse: false,
};

function tile(rx: number, ry: number, z = 0) {
    return { rx, ry, z, center: { x: rx + 0.5, y: z, z: ry + 0.5 } };
}

function request(
    id: number,
    overrides: Partial<Parameters<AresAnimationDamageRuntime["spawn"]>[0]> = {},
) {
    return {
        definition,
        tile: tile(4, 5),
        position: { x: 400 + id, y: 8, z: 500 + id },
        elevation: 2,
        zone: ZoneType.Ground,
        ...overrides,
    };
}

function runtimeWithTwoActiveInstances() {
    const players = [{ name: "Duplicate", playerListIndex: 0 }, { name: "Duplicate", playerListIndex: 1 }];
    const objects = [{ id: 101 }, { id: 102 }];
    const runtime = new AresAnimationDamageRuntime({
        getPlayerIndex: player => players.indexOf(player) === -1 ? undefined : players.indexOf(player),
    });
    // Consume id 1 and remove it, leaving a deliberate allocation gap.
    runtime.spawn(request(0, { definition: { ...definition, end: 0, loopCount: 1 } }));
    runtime.update({ applyAresAnimationDamageArea: () => undefined });
    runtime.spawn(request(2, { sourcePlayer: players[0], sourceObject: objects[0] }));
    runtime.spawn(request(3, {
        tile: tile(6, 7, 1),
        position: { x: 601, y: 9, z: 702 },
        elevation: 4,
        zone: ZoneType.Water,
        sourcePlayer: players[1],
        sourceObject: objects[1],
    }));
    return { runtime, players, objects };
}

describe("Ares standalone animation-damage deterministic state", () => {
    test("captures exact runtime IDs, nextId, position, and player identity", () => {
        const { runtime } = runtimeWithTwoActiveInstances();
        const state = runtime.captureState();

        expect(state.nextId).toBe(4);
        expect(state.instances.map(instance => instance.id)).toEqual([2, 3]);
        expect(state.instances[0]).toMatchObject({
            id: 2,
            positionX: 402,
            positionY: 8,
            positionZ: 502,
            sourcePlayerIndex: 0,
        });
        expect(state.instances[1]).toMatchObject({
            id: 3,
            tileRx: 6,
            tileRy: 7,
            tileZ: 1,
            positionX: 601,
            positionY: 9,
            positionZ: 702,
            elevation: 4,
            zone: ZoneType.Water,
            sourcePlayerIndex: 1,
        });
    });

    test("restores exact IDs and replaces a dirty destination allocation stream", () => {
        const { runtime, players } = runtimeWithTwoActiveInstances();
        for (let i = 0; i < 8; i++) runtime.spawn(request(20 + i));
        const snapshot = JSON.parse(JSON.stringify(runtimeWithTwoActiveInstances().runtime.captureState()));
        const destination = new AresAnimationDamageRuntime({
            getPlayerIndex: player => players.indexOf(player) === -1 ? undefined : players.indexOf(player),
        });
        for (let i = 0; i < 12; i++) destination.spawn(request(50 + i));

        destination.restoreState(snapshot, {
            strict: true,
            resolveTile: (rx, ry) => tile(rx, ry, rx === 6 && ry === 7 ? 1 : 0),
            resolvePlayerByIndex: index => players[index],
            resolveDefinition: name => name === definition.name ? definition :
                name === "RuntimeBlast" ? definition : undefined,
        });
        expect(destination.captureState()).toEqual(snapshot);

        const nextIdSnapshot = destination.captureState().nextId;
        destination.spawn(request(99));
        expect(destination.captureState().instances.at(-1)?.id).toBe(nextIdSnapshot);
    });

    test("does not hash the source object until the delivery path consumes it", () => {
        const first = new AresAnimationDamageRuntime();
        const second = new AresAnimationDamageRuntime();
        first.spawn(request(1, { sourceObject: { id: 100 } }));
        second.spawn(request(1, { sourceObject: { id: 200 } }));
        expect(second.getHash()).toBe(first.getHash());
        expect(second.captureState()).toEqual(first.captureState());
    });

    test("hashes source player, exact position, elevation, and zone state", () => {
        const playerA = { name: "Duplicate", playerListIndex: 0 };
        const playerB = { name: "Duplicate", playerListIndex: 1 };
        const make = (overrides: any) => {
            const runtime = new AresAnimationDamageRuntime({
                getPlayerIndex: player => player === playerA ? 0 : player === playerB ? 1 : undefined,
            });
            runtime.spawn(request(1, overrides));
            return runtime;
        };

        expect(make({ sourcePlayer: playerA }).getHash()).not.toBe(make({ sourcePlayer: playerB }).getHash());
        expect(make({ position: { x: 1, y: 2, z: 3 } }).getHash())
            .not.toBe(make({ position: { x: 1, y: 2, z: 4 } }).getHash());
        expect(make({ elevation: 1 }).getHash()).not.toBe(make({ elevation: 2 }).getHash());
        expect(make({ zone: ZoneType.Ground }).getHash()).not.toBe(make({ zone: ZoneType.Water }).getHash());
    });

    test("does not fall back to a display name when a canonical resolver rejects a player", () => {
        const stalePlayer = { name: "Duplicate", playerListIndex: 3 };
        const runtime = new AresAnimationDamageRuntime({ getPlayerIndex: () => undefined });
        runtime.spawn(request(1, { sourcePlayer: stalePlayer }));
        const state = runtime.captureState() as any;
        expect(state.instances[0].sourcePlayerIndex).toBeUndefined();
        expect(state.instances[0].sourcePlayerName).toBeUndefined();
        expect(state.instances[0].sourcePlayerUnresolved).toBe(true);
        expect(() => runtime.restoreState(state, { strict: true })).toThrow(/unresolved/);
    });

    test("strict restore preserves the live runtime when a resolver throws halfway through", () => {
        const { runtime } = runtimeWithTwoActiveInstances();
        const before = runtime.captureState();
        const beforeHash = runtime.getHash();
        let definitionResolution = 0;
        expect(() => runtime.restoreState(before, {
            strict: true,
            resolveTile: (rx, ry) => tile(rx, ry, rx === 6 && ry === 7 ? 1 : 0),
            resolvePlayerByIndex: () => ({}),
            resolveDefinition: (name) => {
                if (name === definition.name && definitionResolution++ === 0) return definition;
                throw new Error("resolver failed on second entry");
            },
        })).toThrow(/second entry/);
        expect(runtime.captureState()).toEqual(before);
        expect(runtime.getHash()).toBe(beforeHash);
    });

    test("strict restore rejects missing definitions, players, tiles, duplicate IDs, and invalid nextId", () => {
        const { runtime } = runtimeWithTwoActiveInstances();
        const state = runtime.captureState() as any;
        const context = {
            strict: true,
            resolveTile: (rx: number, ry: number) => tile(rx, ry, rx === 6 && ry === 7 ? 1 : 0),
            resolvePlayerByIndex: (index: number) => index === 0 ? {} : undefined,
            resolveDefinition: (name: string) => name === definition.name ? definition : undefined,
        };
        expect(() => runtime.restoreState({ ...state, nextId: 1 }, context)).toThrow(/below nextId/);
        expect(() => runtime.restoreState({ ...state, instances: [{ ...state.instances[0], id: state.instances[1].id }, state.instances[1]] }, context)).toThrow(/duplicate/);
        expect(() => runtime.restoreState(state, { ...context, resolveDefinition: () => undefined })).toThrow(/definition/);
        expect(() => runtime.restoreState(state, { ...context, resolvePlayerByIndex: () => undefined })).toThrow(/player/);
        expect(() => runtime.restoreState(state, { ...context, resolveTile: () => undefined })).toThrow(/tile/);
    });

    test("continues for 100 ticks identically after strict reconstruction", () => {
        const { runtime, players } = runtimeWithTwoActiveInstances();
        const snapshot = JSON.parse(JSON.stringify(runtime.captureState()));
        const reconstructedPlayers = players.map(player => ({ ...player }));
        const restored = new AresAnimationDamageRuntime({
            getPlayerIndex: player => reconstructedPlayers.indexOf(player) === -1
                ? undefined
                : reconstructedPlayers.indexOf(player),
        });
        const context = {
            strict: true,
            resolveTile: (rx: number, ry: number) => tile(rx, ry, rx === 6 && ry === 7 ? 1 : 0),
            resolvePlayerByIndex: (index: number) => reconstructedPlayers[index],
            resolveDefinition: (name: string) => name === definition.name ? definition : undefined,
        };
        restored.restoreState(snapshot, context);
        const liveDeliveries: any[] = [];
        const restoredDeliveries: any[] = [];
        for (let tick = 0; tick < 100; tick++) {
            runtime.update({ applyAresAnimationDamageArea: request => liveDeliveries.push(request) });
            restored.update({ applyAresAnimationDamageArea: request => restoredDeliveries.push(request) });
            expect(restored.captureState()).toEqual(runtime.captureState());
            expect(restored.getHash()).toBe(runtime.getHash());
        }
        expect(liveDeliveries.length).toBeGreaterThan(0);
        expect(restoredDeliveries.map(request => ({
            damage: request.damage,
            sourcePlayerIndex: reconstructedPlayers.indexOf(request.sourcePlayer),
        }))).toEqual(liveDeliveries.map(request => ({
            damage: request.damage,
            sourcePlayerIndex: players.indexOf(request.sourcePlayer),
        })));
    });
});
