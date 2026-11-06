import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { Anim } from "@/engine/renderable/entity/Anim";
import { TransientAnim } from "@/engine/renderable/entity/TransientAnim";
import { TriggerActionFxHandler } from "@/engine/renderable/fx/handler/TriggerActionFxHandler";
import { EventType } from "@/game/event/EventType";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { PaletteType } from "@/engine/type/PaletteType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { LandType } from "@/game/type/LandType";
import { MovementZone } from "@/game/type/MovementZone";
import {
    AresMakeInfantryRuntime,
    AresMakeInfantryService,
    MakeInfantryOwner,
    parseMakeInfantryAnimation,
    parseMakeInfantryOwner,
    resolveMakeInfantryAnimationChain,
    selectMakeInfantryOwner,
    type AresMakeInfantryPendingState,
    type MakeInfantryAnimationDefinition,
    isMakeInfantrySpawnTileAvailable,
} from "@/extensions/ares/AresMakeInfantry";

function animation(
    name: string,
    makeInfantry = -1,
    next?: string,
    overrides: Partial<MakeInfantryAnimationDefinition> = {},
): MakeInfantryAnimationDefinition {
    return {
        name,
        makeInfantry,
        makeInfantryOwner: MakeInfantryOwner.Invoker,
        rate: 15,
        start: 0,
        end: 0,
        loopStart: 0,
        loopEnd: 0,
        loopCount: 1,
        reverse: false,
        ...(next ? { next } : {}),
        ...overrides,
    };
}

function player(index: number, name: string, neutral = false) {
    return { playerListIndex: index, name, isNeutral: neutral, defeated: false, color: { index } };
}

function tile(rx: number, ry: number, z = 0) {
    return { rx, ry, z };
}

function placementUnit(overrides: any = {}) {
    return {
        rules: { speedType: 1, movementZone: MovementZone.Infantry },
        onBridge: false,
        position: { desiredSubCell: 0, tileElevation: 0 },
        isInfantry: () => true,
        isAircraft: () => false,
        ...overrides,
    };
}

function placementMap(findObstacles: () => any[] = () => []) {
    return {
        terrain: {
            getPassableSpeed: () => 1,
            findObstacles,
        },
        tileOccupation: {
            getObjectsOnTile: () => [],
        },
    };
}

function runtimeFor(players: any[]) {
    return new AresMakeInfantryRuntime({
        getPlayerIndex: (value) => players.indexOf(value),
    });
}

describe("Ares MakeInfantry parser and chain", () => {
    test("parses all owner values case-insensitively with invoker default", () => {
        expect(parseMakeInfantryOwner("INVOKER")).toBe(MakeInfantryOwner.Invoker);
        expect(parseMakeInfantryOwner("killer")).toBe(MakeInfantryOwner.Killer);
        expect(parseMakeInfantryOwner("Victim")).toBe(MakeInfantryOwner.Victim);
        expect(parseMakeInfantryOwner("neutral")).toBe(MakeInfantryOwner.Neutral);
        expect(parseMakeInfantryOwner("random")).toBe(MakeInfantryOwner.Random);
        expect(parseMakeInfantryOwner("invalid")).toBe(MakeInfantryOwner.Invoker);
        expect(parseMakeInfantryOwner(undefined)).toBe(MakeInfantryOwner.Invoker);
    });

    test("parses Mental Omega authored animation values", () => {
        const section = new IniSection("NANODEATH1");
        section.set("MakeInfantry", "4");
        section.set("MakeInfantryOwner", "victim");
        section.set("Rate", "500");
        section.set("LoopCount", "1");
        const parsed = parseMakeInfantryAnimation("NANODEATH1", section);
        expect(parsed.makeInfantry).toBe(4);
        expect(parsed.makeInfantryOwner).toBe(MakeInfantryOwner.Victim);
        expect(parsed.rate).toBe(500 / 60);
    });

    test("uses the first animation owner and terminal MakeInfantry through Next", () => {
        const definitions = new Map([
            ["FIRST", animation("FIRST", -1, "MIDDLE", { makeInfantryOwner: MakeInfantryOwner.Random })],
            ["MIDDLE", animation("MIDDLE", 2, "LAST", { makeInfantryOwner: MakeInfantryOwner.Neutral })],
            ["LAST", animation("LAST", 7, undefined, { makeInfantryOwner: MakeInfantryOwner.Victim })],
        ]);
        const chain = resolveMakeInfantryAnimationChain("FIRST", (name) => definitions.get(name));
        expect(chain.valid).toBe(true);
        expect(chain.names).toEqual(["FIRST", "MIDDLE", "LAST"]);
        expect(chain.makeInfantry).toBe(7);
        expect(chain.makeInfantryOwner).toBe(MakeInfantryOwner.Random);
    });

    test("rejects cyclic Next chains without looping", () => {
        const definitions = new Map([
            ["A", animation("A", -1, "B")],
            ["B", animation("B", 1, "A")],
        ]);
        const chain = resolveMakeInfantryAnimationChain("A", (name) => definitions.get(name));
        expect(chain.cycle).toBe(true);
        expect(chain.valid).toBe(false);
    });
});

describe("Ares MakeInfantry owner contexts", () => {
    const killer = player(0, "killer");
    const victim = player(1, "victim");
    const neutral = player(2, "neutral", true);

    test("maps InfDeathAnim and DeathAnims invoker values exactly", () => {
        expect(selectMakeInfantryOwner(MakeInfantryOwner.Invoker, {
            kind: "infDeathAnim",
            killer,
            victim,
        })).toBe(killer);
        expect(selectMakeInfantryOwner(MakeInfantryOwner.Invoker, {
            kind: "deathAnims",
            killer,
            victim,
        })).toBe(victim);
        expect(selectMakeInfantryOwner(MakeInfantryOwner.Killer, {
            kind: "deathAnims",
            killer,
            victim,
        })).toBe(killer);
    });

    test("maps trigger invoker, killer, and victim to the trigger owner", () => {
        const owner = player(3, "trigger");
        for (const selector of [MakeInfantryOwner.Invoker, MakeInfantryOwner.Killer, MakeInfantryOwner.Victim]) {
            expect(selectMakeInfantryOwner(selector, {
                kind: "trigger",
                triggerOwner: owner,
                killer,
                victim,
            })).toBe(owner);
        }
    });

    test("random includes neutral and consumes the supplied deterministic choice", () => {
        const calls: number[] = [];
        const selected = selectMakeInfantryOwner(MakeInfantryOwner.Random, {
            kind: "infDeathAnim",
            players: [killer, neutral, victim],
            randomInt: (min, max) => {
                calls.push(min, max);
                return 1;
            },
        });
        expect(selected).toBe(neutral);
        expect(calls).toEqual([0, 2]);
    });
});

describe("Ares MakeInfantry deterministic lifecycle", () => {
    test("kills the victim, completes the chain, and spawns only at completion", () => {
        const players = [player(0, "owner")];
        const runtime = runtimeFor(players);
        const victim = { id: 4, isSpawned: true, isDestroyed: false, isDisposed: false };
        const states: AresMakeInfantryPendingState[] = [];
        let killed = 0;
        let spawned = 0;
        const pending = runtime.spawn({
            definitions: [animation("FIRST", -1, "LAST"), animation("LAST", 2)],
            tile: tile(3, 4),
            productIndex: 2,
            product: { name: "BRUTE" },
            owner: players[0],
            victim,
            context: "infDeathAnim",
        }, {
            killVictim: (target) => {
                killed++;
                target.isDestroyed = true;
                target.isSpawned = false;
                return true;
            },
            startAnimation: (state) => states.push(state),
            isOwnerValid: () => true,
            isKillerValid: () => true,
            isVictimValid: () => true,
            isSpawnTileAvailable: () => true,
            spawnProduct: () => spawned++,
        });
        expect(pending?.id).toBe(1);
        expect(killed).toBe(1);
        expect(states).toHaveLength(1);
        expect(spawned).toBe(0);
        runtime.update({
            isOwnerValid: () => true,
            isKillerValid: () => true,
            isVictimValid: () => true,
            isSpawnTileAvailable: () => true,
            spawnProduct: () => spawned++,
        });
        expect(runtime.getPendingCount()).toBe(1);
        expect(spawned).toBe(0);
        runtime.update({
            isOwnerValid: () => true,
            isKillerValid: () => true,
            isVictimValid: () => true,
            isSpawnTileAvailable: () => true,
            spawnProduct: () => spawned++,
        });
        expect(runtime.getPendingCount()).toBe(0);
        expect(spawned).toBe(1);
    });

    test("discards an occupied intended cell without retrying", () => {
        const owner = player(0, "owner");
        const runtime = runtimeFor([owner]);
        let discarded = 0;
        let spawned = 0;
        runtime.spawn({
            definitions: [animation("MUTATE", 0)],
            tile: tile(1, 1),
            productIndex: 0,
            product: { name: "PRODUCT" },
            owner,
            context: "trigger",
        }, {
            isOwnerValid: () => true,
            isSpawnTileAvailable: () => false,
            discardAnimation: () => discarded++,
            spawnProduct: () => spawned++,
        });
        runtime.update({
            isOwnerValid: () => true,
            isSpawnTileAvailable: () => false,
            discardAnimation: () => discarded++,
            spawnProduct: () => spawned++,
        });
        runtime.update({
            isOwnerValid: () => true,
            isSpawnTileAvailable: () => false,
            discardAnimation: () => discarded++,
            spawnProduct: () => spawned++,
        });
        expect(runtime.getPendingCount()).toBe(0);
        expect(discarded).toBe(1);
        expect(spawned).toBe(0);
    });

    test("cancels when the selected owner or an unclaimed victim becomes invalid", () => {
        const owner = player(0, "owner");
        const runtime = runtimeFor([owner]);
        runtime.spawn({
            definitions: [animation("MUTATE", 0)],
            tile: tile(1, 1),
            productIndex: 0,
            product: { name: "PRODUCT" },
            owner,
            context: "trigger",
        });
        owner.defeated = true;
        runtime.update({ isOwnerValid: (value) => value.defeated !== true });
        expect(runtime.getPendingCount()).toBe(0);

        const victim = { id: 8, isSpawned: true, isDestroyed: false, isDisposed: false };
        const second = runtimeFor([owner]);
        second.spawn({
            definitions: [animation("MUTATE", 0)],
            tile: tile(1, 1),
            productIndex: 0,
            product: { name: "PRODUCT" },
            owner,
            victim,
            context: "infDeathAnim",
        });
        victim.isDestroyed = true;
        second.update({ isOwnerValid: () => true, isVictimValid: (value) => !value.isDestroyed });
        expect(second.getPendingCount()).toBe(0);
    });

     test("hash changes with animation progress and is deterministic across equivalent runs", () => {
         const owner = player(0, "owner");
         const make = () => {
             const runtime = runtimeFor([owner]);
             runtime.spawn({
                 definitions: [animation("MUTATE", 0, undefined, { end: 4 })],
                 tile: tile(2, 3),
                 productIndex: 0,
                 product: { name: "PRODUCT" },
                 owner,
                 context: "trigger",
             });
             return runtime;
         };
         const first = make();
         const second = make();
         expect(first.getHash()).toBe(second.getHash());
         first.update({ isOwnerValid: () => true });
         expect(first.getHash()).not.toBe(second.getHash());
     });

     test("includes the canonical bridge layer in the pending hash", () => {
         const owner = player(0, "owner");
         const make = (onBridge: boolean) => {
             const runtime = runtimeFor([owner]);
             const pending = runtime.spawn({
                 definitions: [animation("MUTATE", 0)],
                 tile: tile(2, 3),
                 productIndex: 0,
                 product: { name: "PRODUCT" },
                 onBridge,
                 owner,
                 context: "infDeathAnim",
             });
             expect(pending?.onBridge).toBe(onBridge);
             return runtime;
         };
         expect(make(true).getHash()).not.toBe(make(false).getHash());
     });
 });

describe("Ares MakeInfantry placement validation", () => {
     test("uses the actual unit speed, infantry flag, and bridge layer", () => {
         const bridge = { tileElevation: 6 };
         const target = tile(4, 5);
         const unit = placementUnit({
             onBridge: true,
             rules: { speedType: 9, movementZone: MovementZone.Infantry },
             isInfantry: () => false,
         });
         let speedArguments: any[] = [];
         let obstacleUnit: any;
         let obstacleNode: any;
         const map = {
             terrain: {
                 getPassableSpeed: (...args: any[]) => {
                     speedArguments = args;
                     return 1;
                 },
                 findObstacles: (node: any, candidate: any) => {
                     obstacleNode = node;
                     obstacleUnit = candidate;
                     return [];
                 },
             },
             tileOccupation: {
                 getBridgeOnTile: () => bridge,
                 getObjectsOnTile: () => [],
             },
         };
         expect(isMakeInfantrySpawnTileAvailable(target, map, unit)).toBe(true);
         expect(speedArguments.slice(0, 4)).toEqual([target, 9, false, true]);
         expect(obstacleUnit).toBe(unit);
         expect(obstacleNode).toEqual({ tile: target, onBridge: bridge });
     });

     test("allows a passable gate", () => {
         const gate = { isBuilding: () => true, rules: { gate: true } };
         expect(isMakeInfantrySpawnTileAvailable(
             tile(1, 1),
             placementMap(() => [{ obj: gate }]),
             placementUnit(),
         )).toBe(true);
     });

     test("allows an inactive laser fence and rejects an active laser fence", () => {
         const inactive = {
             isBuilding: () => true,
             rules: { laserFence: true },
             laserFenceActive: false,
         };
         const active = { ...inactive, laserFenceActive: true };
         expect(isMakeInfantrySpawnTileAvailable(
             tile(1, 1),
             placementMap(() => [{ obj: inactive }]),
             placementUnit(),
         )).toBe(true);
         expect(isMakeInfantrySpawnTileAvailable(
             tile(1, 1),
             placementMap(() => [{ obj: active }]),
             placementUnit(),
         )).toBe(false);
     });

     test("rejects ordinary obstacles and occupying units", () => {
         const obstacle = { isBuilding: () => true, rules: {} };
         expect(isMakeInfantrySpawnTileAvailable(
             tile(1, 1),
             placementMap(() => [{ obj: obstacle }]),
             placementUnit(),
         )).toBe(false);
         const occupant = { isUnit: () => true, onBridge: false };
         expect(isMakeInfantrySpawnTileAvailable(
             tile(1, 1),
             placementMap(() => [{ obj: occupant }]),
             placementUnit(),
         )).toBe(false);
     });
});

describe("Ares MakeInfantry bridge placement", () => {
     function makeGame(target: any, bridge: any) {
         const owner = player(0, "owner");
         const product = { name: "PRODUCT" };
         const unit: any = placementUnit({
             rules: { speedType: 1, movementZone: MovementZone.Infantry },
             position: { desiredSubCell: 0, tileElevation: 0 },
         });
         const speedCalls: any[][] = [];
         const obstacleNodes: any[] = [];
         let spawned: any;
         const game: any = {
             currentTick: 1,
             playerList: { getAll: () => [owner] },
             getAllPlayers: () => [owner],
             rules: {
                 general: { animToInfantry: ["PRODUCT"] },
                 getObject: () => product,
                 audioVisual: {},
             },
             events: {
                 subscribe: () => () => undefined,
                 dispatch: () => undefined,
             },
             destroyObject: (victim: any) => {
                 victim.isDestroyed = true;
                 victim.isDisposed = true;
             },
             createUnitForPlayer: (_rules: any, unitOwner: any) => {
                 unit.owner = unitOwner;
                 return unit;
             },
             spawnObject: (created: any) => {
                 created.position.tile = target;
                 created.isSpawned = true;
                 spawned = created;
             },
             map: {
                 tileOccupation: {
                     getBridgeOnTile: () => bridge,
                     getObjectsOnTile: () => [],
                 },
                 terrain: {
                     getPassableSpeed: (...args: any[]) => {
                         speedCalls.push(args);
                         return 1;
                     },
                     findObstacles: (node: any) => {
                         obstacleNodes.push(node);
                         return [];
                     },
                 },
             },
         };
         return { game, owner, product, unit, speedCalls, obstacleNodes, getSpawned: () => spawned };
     }

     test("places a victim mutation on its bridge layer and elevation", () => {
         const target = { rx: 7, ry: 8, z: 2, landType: LandType.Water, onBridgeLandType: LandType.Road };
         const bridge = { tileElevation: 9 };
         const fixture = makeGame(target, bridge);
         const victim: any = {
             id: 41,
             tile: target,
             owner: fixture.owner,
             onBridge: true,
             isSpawned: true,
             isDestroyed: false,
             isDisposed: false,
             isInfantry: () => true,
             position: { worldPosition: { clone: () => ({}) } },
         };
         const service = new AresMakeInfantryService(fixture.game, {
             resolveAnimation: () => animation("MUTATE", 0),
             resolveProduct: () => fixture.product,
         });
         const pending = service.startDeathAnims(victim, "MUTATE", undefined, fixture.owner);
         expect(pending?.onBridge).toBe(true);
         service.update();
         expect(fixture.getSpawned()).toBe(fixture.unit);
         expect(fixture.unit.onBridge).toBe(true);
         expect(fixture.unit.position.tileElevation).toBe(9);
         expect(fixture.unit.zone).toBe(ZoneType.Ground);
         expect(fixture.speedCalls[0].slice(0, 4)).toEqual([target, 1, true, true]);
         expect(fixture.obstacleNodes[0]).toEqual({ tile: target, onBridge: bridge });
         service.dispose();
     });

     test("keeps trigger placement on the ground layer of a bridge tile", () => {
         const target = { rx: 9, ry: 10, z: 2, landType: LandType.Water, onBridgeLandType: LandType.Road };
         const bridge = { tileElevation: 9 };
         const fixture = makeGame(target, bridge);
         const service = new AresMakeInfantryService(fixture.game, {
             resolveAnimation: () => animation("MUTATE", 0),
             resolveProduct: () => fixture.product,
         });
         const event: any = { name: "MUTATE", tile: target, triggerOwner: fixture.owner };
         expect(service.handleTriggerAnimation(event)).toBe(true);
         expect(service.runtime.getPending(event.mutationId)?.onBridge).toBe(false);
         service.update();
         expect(fixture.getSpawned()).toBe(fixture.unit);
         expect(fixture.unit.onBridge).toBe(false);
         expect(fixture.unit.position.tileElevation).toBe(0);
         expect(fixture.unit.zone).toBe(ZoneType.Water);
         expect(fixture.speedCalls[0].slice(0, 4)).toEqual([target, 1, true, false]);
         expect(fixture.obstacleNodes[0]).toEqual({ tile: target, onBridge: undefined });
         service.dispose();
     });
});

describe("Ares MakeInfantry snapshot and palette state", () => {
    test("round-trips versioned pending animation state and continues identically", () => {
        const owner = player(0, "owner");
        const source = runtimeFor([owner]);
        const victim = { id: 3, isSpawned: false, isDestroyed: true, isDisposed: false };
        source.spawn({
            definitions: [animation("MUTATE", 0, undefined, { end: 4 })],
            tile: tile(5, 6, 1),
            productIndex: 0,
            productName: "PRODUCT",
            product: { name: "PRODUCT" },
            owner,
            victim,
            victimDestroyedByService: true,
            context: "infDeathAnim",
        }, { killVictim: () => true });
        source.update({ isOwnerValid: () => true, isVictimValid: () => true });
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));
        const target = runtimeFor([owner]);
        const context = {
            strict: true,
            resolveAnimation: (name: string) => animation(name, name === "MUTATE" ? 0 : -1, undefined, { end: 4 }),
            resolveProduct: () => ({ name: "PRODUCT" }),
            resolveTile: (rx: number, ry: number) => tile(rx, ry, 1),
            resolvePlayerByIndex: (index: number) => [owner][index],
            resolveObjectById: () => victim,
        };
        expect(() => target.restoreState(snapshot, context)).not.toThrow();
        expect(target.captureState()).toEqual(snapshot);
        expect(target.getHash()).toBe(source.getHash());
        expect(() => target.restoreState({ ...snapshot, version: 9 }, context)).toThrow(/version/i);
    });

     test("restores the bridge layer in strict continuation state", () => {
         const owner = player(0, "owner");
         const source = runtimeFor([owner]);
         source.spawn({
             definitions: [animation("MUTATE", 0)],
             tile: tile(5, 6, 1),
             productIndex: 0,
             product: { name: "PRODUCT" },
             onBridge: true,
             owner,
             context: "infDeathAnim",
         });
         const snapshot = JSON.parse(JSON.stringify(source.captureState()));
         const target = runtimeFor([owner]);
         const context = {
             strict: true,
             resolveAnimation: (name: string) => animation(name, 0),
             resolveProduct: () => ({ name: "PRODUCT" }),
             resolveTile: (rx: number, ry: number) => tile(rx, ry, 1),
             resolvePlayerByIndex: (index: number) => [owner][index],
         };
         let observedBridge = false;
         let spawned = false;
         target.restoreState(snapshot, context);
         target.update({
             isOwnerValid: () => true,
             isSpawnTileAvailable: (_tile, _unit, state) => {
                 observedBridge = state.onBridge;
                 return true;
             },
             spawnProduct: () => {
                 spawned = true;
             },
         });
         expect(observedBridge).toBe(true);
         expect(spawned).toBe(true);
         expect(target.getPendingCount()).toBe(0);
     });

     test("uses the unit palette and remaps the selected owner color", () => {
        const calls: Array<{ type: PaletteType; map: any }> = [];
        const palette = {
            clone() {
                return this;
            },
            remap(map: any) {
                calls.push({ type: PaletteType.Unit, map });
            },
        };
        const anim = Object.create(Anim.prototype) as any;
        anim.mainObj = undefined;
        anim.palette = { clone: () => ({ remap: () => undefined }) };
        anim.theater = {
            getPalette: (type: PaletteType) => {
                expect(type).toBe(PaletteType.Unit);
                return palette;
            },
        };
        const color = { index: 4 };
        anim.remapUnitColor(color);
        expect(calls).toEqual([{ type: PaletteType.Unit, map: color }]);
    });
});

describe("Ares MakeInfantry service and presentation integration", () => {
    test("runs a victim mutation through service completion and spawns the product", () => {
        const owner = player(0, "owner");
        const product = { name: "PRODUCT", type: "infantry" };
        const victim: any = {
            id: 11,
            tile: tile(4, 5),
            owner: player(1, "victim"),
            isSpawned: true,
            isDestroyed: false,
            isDisposed: false,
            isInfantry: () => true,
            position: { worldPosition: { x: 1, y: 2, z: 0 } },
        };
        const sourceObject: any = { id: 12, owner, isDestroyed: false, isDisposed: false };
        const events: any[] = [];
        let spawned: any;
        const game: any = {
            currentTick: 4,
            playerList: { getAll: () => [owner] },
            rules: {
                general: { animToInfantry: ["PRODUCT"] },
                getObject: () => product,
                audioVisual: {},
            },
            art: { getAnimation: () => animation("MUTATE", 0) },
            events: {
                subscribe: () => () => undefined,
                dispatch: (event: any) => events.push(event),
            },
            destroyObject: (target: any) => {
                target.isDestroyed = true;
                target.isDisposed = true;
            },
            createUnitForPlayer: (rules: any, playerOwner: any) => ({ rules, owner: playerOwner }),
            spawnObject: (unit: any) => {
                spawned = unit;
            },
            map: { tileOccupation: { getObjectsOnTile: () => [] } },
            getAllPlayers: () => [owner],
        };
        const service = new AresMakeInfantryService(game, {
            resolveAnimation: () => animation("MUTATE", 0),
            resolveProduct: () => product,
            isSpawnTileAvailable: () => true,
        });
        const pending = service.startInfDeathAnimation(victim, "MUTATE", sourceObject, owner, sourceObject);
        expect(pending).toBeDefined();
        expect(victim.isDestroyed).toBe(true);
        expect(events).toHaveLength(1);
        expect(events[0].animationChain).toEqual(["MUTATE"]);
         service.update();
         expect(spawned).toMatchObject({ rules: product, owner, onBridge: false, zone: ZoneType.Ground });
         service.dispose();
    });

    test("plays each authored animation sequentially and applies the unit palette", () => {
        let listener: (event: any) => void = () => undefined;
        const created: Array<{ name: string; finish: () => void; remaps: any[] }> = [];
        const game: any = {
            events: {
                subscribe: (_type: EventType, callback: (event: any) => void) => {
                    listener = callback;
                    return () => undefined;
                },
            },
        };
        const manager: any = {
            createTransientAnim: (name: string, callback: (anim: any) => void, onFinished?: () => void) => {
                const remaps: any[] = [];
                const anim = {
                    setPosition: () => undefined,
                    remapUnitColor: (color: any) => remaps.push(color),
                };
                callback(anim);
                created.push({ name, finish: onFinished ?? (() => undefined), remaps });
                return anim;
            },
        };
        const handler = new TriggerActionFxHandler(game, manager);
        handler.init();
        const owner = { color: { index: 6 } };
        const event = new TriggerAnimEvent("FIRST", tile(1, 2), undefined, owner);
        event.animationChain = ["FIRST", "SECOND"];
        event.mutationOwner = owner;
        event.useUnitPalette = true;
        listener(event);
        expect(created.map((entry) => entry.name)).toEqual(["FIRST"]);
        expect(created[0].remaps).toEqual([owner.color]);
        created[0].finish();
        expect(created.map((entry) => entry.name)).toEqual(["FIRST", "SECOND"]);
        expect(created[1].remaps).toEqual([owner.color]);
        handler.dispose();
    });

    test("TransientAnim invokes completion once", () => {
        const anim = Object.create(TransientAnim.prototype) as any;
        let completions = 0;
        let removals = 0;
        let disposals = 0;
        anim.finished = false;
        anim.isAnimNotStarted = () => false;
        anim.isAnimFinished = () => true;
        anim.remove = () => removals++;
        anim.dispose = () => disposals++;
        anim.onFinished = () => completions++;
        anim.update(0);
        anim.update(0);
        expect(completions).toBe(1);
        expect(removals).toBe(1);
        expect(disposals).toBe(1);
    });
});
