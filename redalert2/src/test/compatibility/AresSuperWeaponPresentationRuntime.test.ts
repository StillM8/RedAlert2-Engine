import { describe, expect, test } from "bun:test";
import { Coords } from "@/game/Coords";
import { EventType } from "@/game/event/EventType";
import { SuperWeaponFxHandler } from "@/engine/renderable/fx/handler/SuperWeaponFxHandler";
import { SoundHandler } from "@/gui/screen/game/SoundHandler";

function makeSubscriptions(): {
    handlers: Map<any, (event: any) => void>;
    events: any;
} {
    const handlers = new Map<any, (event: any) => void>();
    return {
        handlers,
        events: {
            subscribe(type: any, handler: (event: any) => void) {
                handlers.set(type, handler);
                return () => handlers.delete(type);
            },
        },
    };
}

describe("Ares superweapon presentation runtime", () => {
    test("renders a deferred custom animation at its target height and honors visibility", () => {
        const owner = { name: "Owner", isObserver: false };
        const enemy = { name: "Enemy", isObserver: false };
        const subscriptions = makeSubscriptions();
        const created: any[] = [];
        const game: any = {
            localPlayer: owner,
            alliances: { areAllied: () => false },
            map: {
                tileOccupation: { getBridgeOnTile: () => ({ tileElevation: 2 }) },
                getIonLighting: () => undefined,
            },
            rules: {
                audioVisual: {
                    weatherConClouds: [],
                    ironCurtainInvokeAnim: "IRON",
                    chronoBlast: "CHRONO",
                    chronoBlastDest: "CHRONO_DEST",
                    chronoPlacement: "CHRONO_PLACE",
                },
                general: { lightningStorm: { duration: 1 } },
            },
            events: subscriptions.events,
        };
        const renderableManager: any = {
            createTransientAnim(name: string, callback: (anim: any) => void) {
                const anim: any = {
                    setPosition(position: any) {
                        anim.position = position;
                    },
                };
                callback(anim);
                created.push({ name, anim });
                return anim;
            },
            createAnim: () => undefined,
            getRenderableContainer: () => undefined,
        };
        const handler = new SuperWeaponFxHandler(game, renderableManager, { addEffect: () => undefined });
        handler.init();

        const event = {
            type: EventType.AresSuperWeaponEffect,
            rules: { ares: {
                swAnimation: "MO_TARGET_ANIM",
                swAnimationHeight: 3,
                swAnimationVisibility: "owner",
            } },
            owner,
            atTile: { rx: 4, ry: 6, z: 1 },
        };
        subscriptions.handlers.get(EventType.AresSuperWeaponEffect)!(event);

        expect(created).toHaveLength(1);
        expect(created[0].name).toBe("MO_TARGET_ANIM");
        expect(created[0].anim.position).toEqual(
            Coords.tile3dToWorld(4.5, 6.5, 1 + 2 + 3),
        );

        subscriptions.handlers.get(EventType.AresSuperWeaponEffect)!({
            ...event,
            owner: enemy,
        });
        expect(created).toHaveLength(1);
        handler.dispose();
    });

    test("plays activation and target-cell Ares sounds through the shared sound handler", () => {
        const owner = { name: "Owner", isObserver: false };
        const calls: any[][] = [];
        const handler = new SoundHandler(
            { rules: {}, map: {}, alliances: { areAllied: () => false } },
            { playEffect: (...args: any[]) => calls.push(args) },
            { play: () => undefined },
            { play: () => undefined, getSoundSpec: () => undefined },
            { subscribe: () => () => undefined },
            { addSystemMessage: () => undefined },
            { get: (key: string) => key },
            owner,
        );
        const tile = { rx: 2, ry: 3, z: 1 };
        const rules = { ares: {
            swActivationSound: "MO_LAUNCH",
            swSound: "MO_IMPACT",
        } };

        (handler as any).handleGameEvent({
            type: EventType.SuperWeaponActivate,
            target: "GenericWarhead",
            owner,
            atTile: tile,
            noSfxWarning: false,
            rules,
        });
        (handler as any).handleGameEvent({
            type: EventType.AresSuperWeaponEffect,
            owner,
            atTile: tile,
            noSfxWarning: false,
            rules,
        });

        expect(calls).toHaveLength(2);
        expect(calls[0][0]).toBe("MO_LAUNCH");
        expect(calls[1][0]).toBe("MO_IMPACT");
        expect(calls[0][1]).toEqual(Coords.tile3dToWorld(2, 3, 1));
        expect(calls[1][1]).toEqual(Coords.tile3dToWorld(2, 3, 1));

        (handler as any).handleGameEvent({
            type: EventType.AresSuperWeaponEffect,
            owner,
            atTile: tile,
            noSfxWarning: true,
            rules,
        });
        expect(calls).toHaveLength(2);
    });
});
