import { describe, expect, test } from 'bun:test';
import { AresFirestormWallTrait } from '@/game/gameobject/trait/AresFirestormWallTrait';
import { NotifyTick } from '@/game/gameobject/trait/interface/NotifyTick';
import { EventType } from '@/game/event/EventType';
import { setAresFirestormActive } from '@/extensions/ares/AresFirestorm';

function makeWall(owner: any) {
    return {
        owner,
        rules: { firestormWall: true },
        isDestroyed: false,
        isBuilding: () => true,
        isTechno: () => true,
        tile: { rx: 3, ry: 4, z: 0 },
    };
}

function makeGame(owner: any, randomValue: number) {
    const events: any[] = [];
    return {
        map: {
            tiles: { getByMapCoords: () => undefined },
            getObjectsOnTile: () => [],
            getTileZone: () => 0,
            tileOccupation: { calculateTilesForGameObject: () => [] },
        },
        rules: {
            audioVisual: {
                firestormActiveAnim: "GAFSDF_A",
                firestormIdleAnim: "FSIDLE",
            },
            combatDamage: { firestormWarhead: undefined, c4Warhead: "C4" },
            getWarhead: () => undefined,
        },
        events: { dispatch: (event: any) => events.push(event) },
        generateRandom: () => randomValue,
        _events: events,
    };
}

describe('AresFirestormWallTrait presentation flicker', () => {
    test('dispatches the active wall animation when RNG rolls under the chance', () => {
        const owner = {};
        setAresFirestormActive(owner, true);
        const wall = makeWall(owner);
        const game = makeGame(owner, 0.01);
        const trait = new AresFirestormWallTrait();
        trait[NotifyTick.onTick](wall, game);

        const animEvents = game._events.filter((e: any) => e.type === EventType.TriggerAnim);
        expect(animEvents).toHaveLength(1);
        expect(animEvents[0].name).toBe("GAFSDF_A");
        expect(animEvents[0].tile).toBe(wall.tile);
    });

    test('does not dispatch the active wall animation when RNG rolls above the chance', () => {
        const owner = {};
        setAresFirestormActive(owner, true);
        const wall = makeWall(owner);
        const game = makeGame(owner, 0.99);
        const trait = new AresFirestormWallTrait();
        trait[NotifyTick.onTick](wall, game);

        const animEvents = game._events.filter((e: any) => e.type === EventType.TriggerAnim);
        expect(animEvents).toHaveLength(0);
    });

    test('does not flicker when the wall is inactive', () => {
        const owner = {};
        const wall = makeWall(owner);
        const game = makeGame(owner, 0.01);
        const trait = new AresFirestormWallTrait();
        trait[NotifyTick.onTick](wall, game);

        const animEvents = game._events.filter((e: any) => e.type === EventType.TriggerAnim);
        expect(animEvents).toHaveLength(0);
    });
});
