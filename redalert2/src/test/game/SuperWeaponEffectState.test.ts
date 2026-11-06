import { describe, expect, test } from "bun:test";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";
import { EffectStatus, SuperWeaponEffect } from "@/game/superweapon/SuperWeaponEffect";
import { ChronoSphereEffect } from "@/game/superweapon/ChronoSphereEffect";
import { DropPodEffect } from "@/game/superweapon/DropPodEffect";
import { EMPulseEffect } from "@/game/superweapon/EMPulseEffect";
import { ForceShieldEffect } from "@/game/superweapon/ForceShieldEffect";
import { LightningStormEffect } from "@/game/superweapon/LightningStormEffect";
import { ParadropEffect } from "@/game/superweapon/ParadropEffect";
import { PsychicDominatorEffect } from "@/game/superweapon/PsychicDominatorEffect";
import { UnitDeliveryEffect } from "@/game/superweapon/UnitDeliveryEffect";
import {
    captureExtensionState,
    restoreExtensionState,
} from "@/game/state/ExtensionStateSnapshot";
import { Replay } from "@/network/gamestate/Replay";

class UnknownEffect extends SuperWeaponEffect {
    onStart(): void { }
}

function tile(rx: number, ry: number): any {
    return { rx, ry, z: 0 };
}

function makeContext(players: any[], objects: any[], rules: any) {
    return {
        strict: true,
        resolveTile: (rx: number, ry: number) => tile(rx, ry),
        resolveObjectById: (id: number) => objects.find((object) => object.id === id),
        resolvePlayerByIndex: (index: number) => players[index],
        resolveInfantryRules: (name: string) => ({ name }),
        resolveSuperWeaponRule: () => rules,
    };
}

function makeStatefulEffects(owner: any, objects: any[]): SuperWeaponEffect[] {
    const plane = objects[0];
    const teleportObject = objects[1];
    const launchSite = objects[2];
    const lightning = new LightningStormEffect("LightningStorm", owner, tile(4, 5));
    Object.assign(lightning, {
        status: EffectStatus.Running,
        state: 1,
        manifestStartTimer: 12,
        manifestEndTimer: -1,
        nextDirectHitTimer: 7,
        nextRandomHitTimer: 8,
        clouds: [{ tile: tile(6, 7), durationTicks: 30, ticksLeft: 11 }],
    });
    const chrono = new ChronoSphereEffect("ChronoSphere", owner, tile(4, 5), tile(9, 10));
    Object.assign(chrono, {
        status: EffectStatus.Running,
        delayTicks: 6,
        objectsToTeleport: [{ obj: teleportObject, destTile: tile(11, 12) }],
    });
    const paradrop = new ParadropEffect("Paradrop", owner, tile(4, 5), { inf: "E1", num: 3 }, 10);
    Object.assign(paradrop, {
        status: EffectStatus.Running,
        state: 2,
        failedAttempts: 1,
        spawnDelay: 4,
        passengerCount: 2,
        targetTile: tile(13, 14),
        pdPlane: plane,
        passengerRules: { name: "E1" },
    });
    const dominator = new PsychicDominatorEffect("PsychicDominator", owner, tile(4, 5), 8);
    Object.assign(dominator, {
        status: EffectStatus.Running,
        ticksLeft: 17,
        initialDeferment: 3,
    });
    const delivery = new UnitDeliveryEffect("UnitDelivery", owner, tile(4, 5), ["E1"], 9, "invoker", true);
    Object.assign(delivery, { status: EffectStatus.Running, remainingTicks: 5 });
    const empulse = new EMPulseEffect("EMPulse", owner, tile(4, 5), { extensionType: "EMPulse" } as any, undefined);
    Object.assign(empulse, {
        status: EffectStatus.Running,
        pendingFrames: 4,
        launched: false,
        launchSites: [launchSite],
    });
    const dropPod = new DropPodEffect("DropPod", owner, tile(4, 5), { extensionType: "DropPod" } as any);
    Object.assign(dropPod, { status: EffectStatus.Running, completed: false });
    const forceShield = new ForceShieldEffect("ForceShield", owner, tile(4, 5));
    Object.assign(forceShield, {
        status: EffectStatus.Running,
        ticksLeft: 22,
        duration: 40,
        fadeSoundTime: 6,
        specialSound: "ShieldFade",
        fadeSoundPlayed: true,
        configured: true,
    });
    return [lightning, chrono, paradrop, dominator, delivery, empulse, dropPod, forceShield];
}

function makeTrait(effects: SuperWeaponEffect[]): SuperWeaponsTrait {
    const trait = new SuperWeaponsTrait();
    (trait as any).effects = effects;
    return trait;
}

describe("superweapon effect state codec", () => {
    test("round-trips every mutable stateful effect through stable references", () => {
        const sourceOwner = { playerListIndex: 0 };
        const sourceObjects = [{ id: 10 }, { id: 11 }, { id: 12 }];
        const sourceEffects = makeStatefulEffects(sourceOwner, sourceObjects);
        const sourceTrait = makeTrait(sourceEffects);
        const sourceRule = { name: "ChronoSphereSpecial", index: 4 };
        (sourceTrait as any).chronoSphereSources = new Map([[sourceOwner, {
            tile: tile(15, 16),
            rules: sourceRule,
        }]]);
        const state = JSON.parse(JSON.stringify(sourceTrait.captureAresState()));

        const targetOwner = { playerListIndex: 0 };
        const targetObjects = [{ id: 10 }, { id: 11 }, { id: 12 }];
        const targetEffects = makeStatefulEffects(targetOwner, targetObjects).map((effect) => {
            effect.status = EffectStatus.NotStarted;
            return effect;
        });
        Object.assign(targetEffects[0] as any, {
            state: 0,
            manifestStartTimer: 0,
            manifestEndTimer: 0,
            nextDirectHitTimer: 0,
            nextRandomHitTimer: 0,
            clouds: [],
        });
        Object.assign(targetEffects[1] as any, { delayTicks: 0, objectsToTeleport: [] });
        Object.assign(targetEffects[2] as any, {
            state: 0,
            failedAttempts: 0,
            spawnDelay: 0,
            passengerCount: undefined,
            targetTile: undefined,
            pdPlane: undefined,
        });
        Object.assign(targetEffects[3] as any, {
            ticksLeft: 0,
            initialDeferment: 0,
            configured: false,
            firstAnim: undefined,
            firstAnimHeight: 0,
            secondAnim: undefined,
            secondAnimHeight: 0,
            controlAnim: undefined,
            capture: false,
            ripple: false,
            captureMindControlled: false,
            capturePermaMindControlled: false,
            captureImmuneToPsionics: true,
            permanentCapture: false,
        });
        Object.assign(targetEffects[4] as any, { remainingTicks: 0 });
        Object.assign(targetEffects[5] as any, { pendingFrames: 0, launched: true, launchSites: [] });
        Object.assign(targetEffects[6] as any, { completed: true });
        Object.assign(targetEffects[7] as any, {
            ticksLeft: 0,
            duration: 0,
            fadeSoundTime: 0,
            specialSound: undefined,
            fadeSoundPlayed: false,
            configured: false,
        });
        const targetTrait = makeTrait(targetEffects);
        (targetTrait as any).chronoSphereSources = new Map([[targetOwner, {
            tile: tile(99, 99),
            rules: { name: "Wrong", index: 9 },
        }]]);
        const targetRule = { name: "ChronoSphereSpecial", index: 4 };
        const context = makeContext([targetOwner], targetObjects, targetRule);
        const targetTileBeforeRestore = targetEffects[0].tile;

        targetTrait.restoreAresState(state, context);

        expect(targetTrait.captureAresState()).toEqual(state);
        expect(targetTrait.getHash()).toBe(sourceTrait.getHash());
        expect(targetEffects[0].tile).not.toBe(targetTileBeforeRestore);
        expect((targetEffects[2] as any).pdPlane).toBe(targetObjects[0]);
        expect((targetEffects[1] as any).objectsToTeleport[0].obj).toBe(targetObjects[1]);
        expect((targetEffects[5] as any).launchSites[0]).toBe(targetObjects[2]);
        expect((targetTrait as any).chronoSphereSources.get(targetOwner).tile).toMatchObject({ rx: 15, ry: 16 });
        expect((targetTrait as any).chronoSphereSources.get(targetOwner).rules).toBe(targetRule);
        expect(JSON.stringify(state)).not.toContain("targetObjects");
    });

    test("validates malformed state and unresolved references transactionally", () => {
        const owner = { playerListIndex: 0 };
        const objects = [{ id: 10 }];
        const source = makeTrait(makeStatefulEffects(owner, objects));
        const targetOwner = { playerListIndex: 0 };
        const targetObjects = [{ id: 10 }, { id: 11 }, { id: 12 }];
        const target = makeTrait(makeStatefulEffects(targetOwner, targetObjects));
        const before = target.captureAresState();
        const beforeHash = target.getHash();
        const context = makeContext([targetOwner], targetObjects, { name: "ChronoSphereSpecial", index: 4 });

        const invalid = JSON.parse(JSON.stringify(source.captureAresState()));
        invalid.effects.find((entry: any) => entry.kind === "lightning-storm").nextDirectHitTimer = -1;
        expect(() => target.restoreAresState(invalid, context)).toThrow(/nextDirectHitTimer/);
        expect(target.captureAresState()).toEqual(before);
        expect(target.getHash()).toBe(beforeHash);

        const unresolvedContext = { ...context, resolveObjectById: () => undefined };
        expect(() => target.restoreAresState(source.captureAresState(), unresolvedContext)).toThrow(/unresolved/);
        expect(target.captureAresState()).toEqual(before);
        expect(target.getHash()).toBe(beforeHash);
    });

    test("stores and restores the effect slice through the shared snapshot", () => {
        const sourceOwner = { playerListIndex: 0 };
        const sourceObjects = [{ id: 10 }, { id: 11 }, { id: 12 }];
        const sourceTrait = makeTrait(makeStatefulEffects(sourceOwner, sourceObjects));
        const sourceRule = { name: "ChronoSphereSpecial", index: 4 };
        const sourceGame = {
            playerList: { getAll: () => [sourceOwner] },
            world: { getAllObjects: () => sourceObjects },
            getObjectById: (id: number) => sourceObjects.find((object) => object.id === id),
            map: { tiles: { getByMapCoords: (rx: number, ry: number) => tile(rx, ry) } },
            rules: {
                superWeaponRules: new Map([[4, sourceRule]]),
                getObject: (name: string) => ({ name }),
            },
            traits: {
                find: () => sourceTrait,
                getAll: () => [sourceTrait],
            },
        };
        const snapshot = JSON.parse(JSON.stringify(captureExtensionState(sourceGame)));
        const replay = new Replay();
        replay.gameOpts = {};
        replay.extensionState = snapshot;
        const decodedReplay = new Replay();
        decodedReplay.unserialize(replay.serialize());
        expect(decodedReplay.extensionState).toEqual(snapshot);

        const targetOwner = { playerListIndex: 0 };
        const targetObjects = [{ id: 10 }, { id: 11 }, { id: 12 }];
        const targetTrait = makeTrait(makeStatefulEffects(targetOwner, targetObjects));
        const targetRule = { name: "ChronoSphereSpecial", index: 4 };
        const targetGame = {
            ...sourceGame,
            playerList: { getAll: () => [targetOwner] },
            world: { getAllObjects: () => targetObjects },
            getObjectById: (id: number) => targetObjects.find((object) => object.id === id),
            rules: {
                superWeaponRules: new Map([[4, targetRule]]),
                getObject: (name: string) => ({ name }),
            },
            traits: {
                find: () => targetTrait,
                getAll: () => [targetTrait],
            },
        };
        restoreExtensionState(targetGame, snapshot, { strict: true });
        expect((captureExtensionState(targetGame) as any).superWeaponEffectsState)
            .toEqual((snapshot as any).superWeaponEffectsState);
    });

    test("keeps unknown effect types JSON-safe and restores their common state", () => {
        const owner = { playerListIndex: 0 };
        const sourceEffect = new UnknownEffect("Custom", owner, tile(2, 3));
        sourceEffect.status = EffectStatus.Running;
        (sourceEffect as any).counter = 4;
        (sourceEffect as any).opaqueObject = { player: owner };
        const source = makeTrait([sourceEffect]);
        const state = JSON.parse(JSON.stringify(source.captureAresState()));
        expect(state.effects[0].kind).toBe("unknown");
        expect(state.effects[0]).not.toHaveProperty("opaqueObject");
        expect(state.effects[0].unknownFields.counter).toBe(4);

        const targetOwner = { playerListIndex: 0 };
        const targetEffect = new UnknownEffect("Different", targetOwner, tile(8, 9));
        const target = makeTrait([targetEffect]);
        target.restoreAresState(state, makeContext([targetOwner], [], {}));
        expect(targetEffect.type).toBe("Custom");
        expect(targetEffect.owner).toBe(targetOwner);
        expect(targetEffect.tile).toMatchObject({ rx: 2, ry: 3 });
        expect(targetEffect.status).toBe(EffectStatus.Running);
        expect((targetEffect as any).counter).toBe(4);
    });

    test("hashes pending ChronoSphere sources and effect state deterministically", () => {
        const ownerA = { playerListIndex: 0 };
        const ownerB = { playerListIndex: 0 };
        const first = makeTrait([]);
        const second = makeTrait([]);
        (first as any).chronoSphereSources = new Map([[ownerA, {
            tile: tile(1, 2),
            rules: { name: "Chrono", index: 1 },
        }]]);
        (second as any).chronoSphereSources = new Map([[ownerB, {
            tile: tile(3, 4),
            rules: { name: "Chrono", index: 1 },
        }]]);
        expect(first.getHash()).not.toBe(second.getHash());

        const thirdOwner = { playerListIndex: 0 };
        const third = makeTrait([]);
        (third as any).chronoSphereSources = new Map([[thirdOwner, {
            tile: tile(1, 2),
            rules: { name: "Chrono", index: 1 },
        }]]);
        expect(third.getHash()).toBe(first.getHash());
    });
});
