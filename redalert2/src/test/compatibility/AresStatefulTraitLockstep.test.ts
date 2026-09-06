import { describe, expect, test } from "bun:test";
import { AresPassengerTurretTrait } from "@/game/gameobject/trait/AresPassengerTurretTrait";
import {
    AresFirestormWallTrait,
    AresFirestormWallState,
} from "@/game/gameobject/trait/AresFirestormWallTrait";
import { AresGarrisonOccupantTrait } from "@/game/gameobject/trait/AresGarrisonOccupantTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { setAresFirestormActive } from "@/extensions/ares/AresFirestorm";

/**
 * Lockstep/snapshot qualification for the stateful Ares building/vehicle
 * traits. These traits previously carried mutable state with no getHash(),
 * so the canonical object hash treated them as constant and a diverged
 * state (most critically, the firestorm flicker cooldown that gates
 * `generateRandom` consumption) could desync peers invisibly.
 */

describe("AresPassengerTurretTrait lockstep state", () => {
    test("hash diverges when the latched turret index differs", () => {
        const make = (passengers: number) => {
            const trait = new AresPassengerTurretTrait();
            trait[NotifyTick.onTick]({
                rules: { turretCount: 3 },
                transportTrait: { units: Array.from({ length: passengers }, () => ({})) },
            });
            return trait;
        };
        expect(make(0).getHash()).not.toBe(make(1).getHash());
        expect(make(1).getHash()).not.toBe(make(2).getHash());
        // Unlatched and zero-passenger states are distinct states.
        expect(new AresPassengerTurretTrait().getHash()).not.toBe(make(0).getHash());
    });

    test("restore round-trip preserves behavior: no rewrite until passenger count changes", () => {
        const live = new AresPassengerTurretTrait();
        const transport = { units: [{}, {}] };
        // turretCount 4 keeps index == passenger count for 0..3 so the later
        // third passenger produces a genuinely new turret index.
        const liveObject: any = { rules: { turretCount: 4 }, transportTrait: transport };
        live[NotifyTick.onTick](liveObject);
        expect(liveObject.turretNo).toBe(2);

        const restored = new AresPassengerTurretTrait();
        restored.restoreState(JSON.parse(JSON.stringify(live.serializeState())));
        expect(restored.getHash()).toBe(live.getHash());

        // The restored latch suppresses the redundant write exactly like the
        // live trait; only a real change rewrites turretNo.
        const restoredObject: any = { rules: { turretCount: 4 }, transportTrait: transport, writes: 0 };
        Object.defineProperty(restoredObject, "turretNo", {
            set: function (v: number) { this._turretNo = v; this.writes++; },
            get: function () { return this._turretNo ?? -1; },
        });
        restored[NotifyTick.onTick](restoredObject);
        expect(restoredObject.writes).toBe(0);
        transport.units.push({});
        restored[NotifyTick.onTick](restoredObject);
        expect(restoredObject.turretNo).toBe(3);
    });

    test("codec rejects invalid payloads transactionally", () => {
        const trait = new AresPassengerTurretTrait();
        expect(() => trait.restoreState({ version: 2, lastTurretIndex: 0 })).toThrow(/version/i);
        expect(() => trait.restoreState({ version: 1, lastTurretIndex: -2 })).toThrow(/lastTurretIndex/i);
        expect(() => trait.restoreState({ version: 1, lastTurretIndex: 1.5 })).toThrow(/lastTurretIndex/i);
        // Failed restores must not mutate.
        expect(trait.serializeState().lastTurretIndex).toBe(-1);
    });
});

describe("AresFirestormWallTrait lockstep state", () => {
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

    function makeGame(randomValues: number[]) {
        let call = 0;
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
                combatDamage: {},
            },
            events: { dispatch: () => undefined },
            generateRandom: () => randomValues[Math.min(call++, randomValues.length - 1)],
            rngCalls: () => call,
        };
    }

    test("hash diverges when the RNG-gating cooldown differs", () => {
        const owner = {};
        setAresFirestormActive(owner, true);
        const wall = makeWall(owner);

        // Drive one wall into cooldown by winning the roll, leave another idle.
        const winner = new AresFirestormWallTrait();
        winner[NotifyTick.onTick](wall, makeGame([0.01]));
        const idle = new AresFirestormWallTrait();
        idle[NotifyTick.onTick](wall, makeGame([]));
        expect(winner.getHash()).not.toBe(idle.getHash());
    });

    test("restored cooldown consumes the RNG stream identically to the live wall", () => {
        const owner = {};
        setAresFirestormActive(owner, true);
        const wall = makeWall(owner);

        const live = new AresFirestormWallTrait();
        live[NotifyTick.onTick](wall, makeGame([0.01]));
        expect(live.serializeState().flickerCooldownTicks).toBe(15);

        const restored = new AresFirestormWallTrait();
        const snapshot: AresFirestormWallState =
            JSON.parse(JSON.stringify(live.serializeState()));
        restored.restoreState(snapshot);
        expect(restored.getHash()).toBe(live.getHash());

        // Both walls must skip the same number of rolls while cooling down,
        // then roll on the same tick. Divergence here shifts every later
        // random draw for the whole match.
        const liveGame = makeGame([0.99, 0.99, 0.01]);
        const restoredGame = makeGame([0.99, 0.99, 0.01]);
        for (let tick = 0; tick < 17; tick++) {
            live[NotifyTick.onTick](wall, liveGame);
            restored[NotifyTick.onTick](wall, restoredGame);
        }
        expect(restoredGame.rngCalls()).toBe(liveGame.rngCalls());
        expect(live.serializeState()).toEqual(restored.serializeState());
    });

    test("codec rejects invalid payloads transactionally", () => {
        const trait = new AresFirestormWallTrait();
        expect(() => trait.restoreState({ version: 1, active: "yes", flickerCooldownTicks: 0 }))
            .toThrow(/active/i);
        expect(() => trait.restoreState({ version: 1, active: true, flickerCooldownTicks: -1 }))
            .toThrow(/flickerCooldownTicks/i);
        expect(() => trait.restoreState({ version: 9, active: true, flickerCooldownTicks: 0 }))
            .toThrow(/version/i);
        const before = trait.serializeState();
        expect(trait.serializeState()).toEqual(before);
    });
});

describe("AresGarrisonOccupantTrait lockstep state", () => {
    test("hash diverges between hostless, hosted, and different-host states", () => {
        const hostA = { id: 1 };
        const hostB = { id: 2 };
        expect(new AresGarrisonOccupantTrait(undefined).getHash())
            .not.toBe(new AresGarrisonOccupantTrait(hostA).getHash());
        expect(new AresGarrisonOccupantTrait(hostA).getHash())
            .not.toBe(new AresGarrisonOccupantTrait(hostB).getHash());
    });

    test("restore round-trip re-links the hosting building by deterministic id", () => {
        const host = { id: 7, isDestroyed: false, garrisonTrait: { handleOccupantDestroyed: () => undefined } };
        const live = new AresGarrisonOccupantTrait(host);
        const snapshot = JSON.parse(JSON.stringify(live.serializeState()));
        expect(snapshot.buildingId).toBe(7);

        const restoredHost = { id: 7, isDestroyed: false };
        const restored = new AresGarrisonOccupantTrait(undefined);
        restored.restoreState(snapshot, {
            resolveBuildingById: (id) => (id === 7 ? restoredHost : undefined),
        });
        expect(restored.getHash()).toBe(live.getHash());

        // Membership survives restore: destroying the occupant still reaches
        // the restored host's garrison handler.
        let notified = false;
        (restoredHost as any).garrisonTrait = { handleOccupantDestroyed: () => { notified = true; } };
        restored[NotifyDestroy.onDestroy]({}, {});
        expect(notified).toBe(true);
    });

    test("unresolvable ids degrade to hostless instead of failing the restore", () => {
        const trait = new AresGarrisonOccupantTrait({ id: 3 });
        trait.restoreState({ version: 1, buildingId: 999 }, { resolveBuildingById: () => undefined });
        expect(traint_getBuildingId(trait)).toBeUndefined();
    });

    test("strict restore rejects unresolved or mismatched hosts transactionally", () => {
        const trait = new AresGarrisonOccupantTrait({ id: 3 });
        expect(() => trait.restoreState(
            { version: 1, buildingId: 999 },
            { strict: true, resolveBuildingById: () => undefined },
        )).toThrow(/unresolved/i);
        expect(traint_getBuildingId(trait)).toBe(3);

        expect(() => trait.restoreState(
            { version: 1, buildingId: 999 },
            { strict: true, resolveBuildingById: () => ({ id: 1000 }) },
        )).toThrow(/mismatched/i);
        expect(traint_getBuildingId(trait)).toBe(3);
    });

    test("hostless snapshots stay hostless and invalid payloads throw without mutation", () => {
        const trait = new AresGarrisonOccupantTrait({ id: 3 });
        trait.restoreState({ version: 1 }, {});
        expect(traint_getBuildingId(trait)).toBeUndefined();

        const guarded = new AresGarrisonOccupantTrait({ id: 3 });
        expect(() => guarded.restoreState(
            { version: 1, buildingId: 4 },
            {},
        )).toThrow(/resolveBuildingById/i);
        expect(traint_getBuildingId(guarded)).toBe(3);
        expect(() => guarded.restoreState({ version: 1, buildingId: -1 }, {
            resolveBuildingById: () => ({}),
        })).toThrow(/buildingId/i);
        expect(traint_getBuildingId(guarded)).toBe(3);
    });

    function traint_getBuildingId(trait: AresGarrisonOccupantTrait): number | undefined {
        return trait.serializeState().buildingId;
    }
});
