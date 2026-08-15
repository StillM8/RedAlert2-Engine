import { describe, expect, test } from 'bun:test';
import { AresFirestormWallStateChangeEvent } from '@/game/event/AresFirestormWallStateChangeEvent';
import { EventType } from '@/game/event/EventType';
import { FirestormWallFxHandler } from '@/engine/renderable/fx/handler/FirestormWallFxHandler';

function createGame() {
    const events: Array<{ type: EventType; handler: (event: any) => void }> = [];
    return {
        rules: {
            audioVisual: {
                firestormActiveAnim: "GAFSDF_A",
                firestormIdleAnim: "FSIDLE",
            },
        },
        events: {
            subscribe: (type: EventType, handler: (event: any) => void) => {
                events.push({ type, handler });
                return { dispose: () => undefined };
            },
        },
        _events: events,
    };
}

function createRenderableManager() {
    const anims: any[] = [];
    return {
        anims,
        createTransientAnim: (name: string, callback: (anim: any) => void) => {
            const anim = {
                name,
                removed: false,
                disposed: false,
                setPosition: (position: any) => { anim.position = position; },
                remove: () => { anim.removed = true; },
                dispose: () => { anim.disposed = true; },
            };
            anims.push(anim);
            if (callback) callback(anim);
            return anim;
        },
    };
}

describe('FirestormWallFxHandler', () => {
    test('tracks wall activation state from state-change events', () => {
        const game = createGame();
        const renderableManager = createRenderableManager();
        const handler = new FirestormWallFxHandler(game as any, renderableManager as any);
        handler.init();
        const subscriber = game._events.find((e) => e.type === EventType.AresFirestormWallStateChange);
        expect(subscriber).toBeDefined();

        const building = { tile: { rx: 3, ry: 4, z: 0 } };
        subscriber!.handler(new AresFirestormWallStateChangeEvent(building, true));
        expect((handler as any).wallState.size).toBe(1);
        expect((handler as any).wallState.get(building)).toBe(true);
        handler.dispose();
    });

    test('removes walls from the registry when they are destroyed', () => {
        const game = createGame();
        const renderableManager = createRenderableManager();
        const handler = new FirestormWallFxHandler(game as any, renderableManager as any);
        handler.init();
        const subscriber = game._events.find((e) => e.type === EventType.AresFirestormWallStateChange)!;

        const building = { tile: { rx: 1, ry: 1, z: 0 }, isDestroyed: false };
        subscriber.handler(new AresFirestormWallStateChangeEvent(building, true));
        building.isDestroyed = true;
        subscriber.handler(new AresFirestormWallStateChangeEvent(building, false));

        expect((handler as any).wallState.size).toBe(0);
        handler.dispose();
    });

    test('keeps the registry updated across repeated state changes', () => {
        const game = createGame();
        const renderableManager = createRenderableManager();
        const handler = new FirestormWallFxHandler(game as any, renderableManager as any);
        handler.init();
        const subscriber = game._events.find((e) => e.type === EventType.AresFirestormWallStateChange)!;

        const building = { tile: { rx: 0, ry: 0, z: 0 } };
        subscriber.handler(new AresFirestormWallStateChangeEvent(building, true));
        subscriber.handler(new AresFirestormWallStateChangeEvent(building, false));
        expect((handler as any).wallState.get(building)).toBe(false);
        subscriber.handler(new AresFirestormWallStateChangeEvent(building, true));
        expect((handler as any).wallState.get(building)).toBe(true);
        handler.dispose();
    });

    test('does not create animations directly (random flicker lives in the game trait)', () => {
        const game = createGame();
        const renderableManager = createRenderableManager();
        const handler = new FirestormWallFxHandler(game as any, renderableManager as any);
        handler.init();
        const subscriber = game._events.find((e) => e.type === EventType.AresFirestormWallStateChange)!;

        subscriber.handler(new AresFirestormWallStateChangeEvent({ tile: { rx: 5, ry: 5, z: 0 } }, true));
        expect(renderableManager.anims).toHaveLength(0);
        handler.dispose();
    });

    test('clears the registry on dispose', () => {
        const game = createGame();
        const renderableManager = createRenderableManager();
        const handler = new FirestormWallFxHandler(game as any, renderableManager as any);
        handler.init();
        const subscriber = game._events.find((e) => e.type === EventType.AresFirestormWallStateChange)!;

        subscriber.handler(new AresFirestormWallStateChangeEvent({ tile: { rx: 0, ry: 0, z: 0 } }, true));
        subscriber.handler(new AresFirestormWallStateChangeEvent({ tile: { rx: 9, ry: 9, z: 0 } }, true));
        handler.dispose();
        expect((handler as any).wallState.size).toBe(0);
    });
});
