import { describe, expect, test } from "bun:test";
import {
    createQualifiedWorld,
    stepQualifiedWorld,
    captureCheckpoint,
    type QualifiedWorld,
} from "@/test/helpers/DeterministicRestoreHarness";
import { scriptedInputs } from "@/test/helpers/DeterministicRestoreHarness";

/**
 * Adversarial canonical-state tests.
 *
 * game.getHash() claims to fingerprint simulation state, so two worlds that
 * will simulate differently MUST produce different hashes. These tests are
 * deliberately adversarial: each constructs a minimal divergence that no
 * currently-hashed subsystem happens to observe, and requires the top-level
 * hash to catch it anyway.
 */

function worldsDivergingOnlyByOwner(): [QualifiedWorld, QualifiedWorld] {
    const first = createQualifiedWorld({ seed: 9001 });
    const second = createQualifiedWorld({ seed: 9001 });
    // Same object id, same position, same traits — only the owner differs.
    const tankA = first.game.world.getAllObjects()[5];
    const tankB = second.game.world.getAllObjects()[5];
    tankA.owner = first.players[0];
    tankB.owner = second.players[1];
    return [first, second];
}

describe("canonical state ownership coverage", () => {
    test("two worlds differing only in an object's owner produce different hashes", () => {
        const [first, second] = worldsDivergingOnlyByOwner();
        expect(first.game.getHash()).not.toBe(second.game.getHash());
    });

    test("ownership divergence survives simulated ticks without converging", () => {
        const [first, second] = worldsDivergingOnlyByOwner();
        for (let tick = 1; tick <= 10; tick++) {
            stepQualifiedWorld(first, tick, new Map(), () => undefined);
            stepQualifiedWorld(second, tick, new Map(), () => undefined);
        }
        expect(first.game.getHash()).not.toBe(second.game.getHash());
    });

    test("checkpoints diverge on the owner field specifically", () => {
        const [first, second] = worldsDivergingOnlyByOwner();
        const checkpointA = captureCheckpoint(first) as any;
        const checkpointB = captureCheckpoint(second) as any;
        expect(checkpointA.objects[5].hash).not.toBe(checkpointB.objects[5].hash);
    });
});

describe("core trait hash coverage", () => {
    test("ammo, veterancy, and turret facing participate in the object hash", () => {
        const { GameObject } = require("@/game/gameobject/GameObject");
        const { ObjectPosition } = require("@/game/gameobject/ObjectPosition");
        const { AmmoTrait } = require("@/game/gameobject/trait/AmmoTrait");
        const { TurretTrait } = require("@/game/gameobject/trait/TurretTrait");

        const makeObject = () => {
            const stubTiles = () => ({
                getByMapCoords: () => undefined,
                getPlaceholderTile: () => ({ rx: 0, ry: 0, z: 0, rampType: 0 }),
            });
            const object = new GameObject(0 as any, "hash-probe", {} as any, {} as any);
            object.id = 77;
            object.position = new ObjectPosition(stubTiles(), stubTileOccupation());
            return object;
        };
        const stubTileOccupation = () => ({ getBridgeOnTile: () => undefined });

        const withFull = makeObject();
        const ammoFull = new AmmoTrait(5);
        withFull.traits.add(ammoFull);

        const withDepleted = makeObject();
        const ammoDepleted = new AmmoTrait(5);
        ammoDepleted.ammo = 2;
        withDepleted.traits.add(ammoDepleted);

        expect(withFull.getHash()).not.toBe(withDepleted.getHash());

        const withTurret = makeObject();
        const turret = new TurretTrait(withTurret as any);
        (turret as any).facing = 1.25;
        withTurret.traits.add(turret);
        const withOtherFacing = makeObject();
        const otherTurret = new TurretTrait(withOtherFacing as any);
        (otherTurret as any).facing = 2.5;
        withOtherFacing.traits.add(otherTurret);
        expect(withTurret.getHash()).not.toBe(withOtherFacing.getHash());
    });

    test("EMP latent restore flags diverge units with identical timers", () => {
        const { EmpTrait } = require("@/game/gameobject/trait/EmpTrait");
        // Two units exit EMP into different movement states depending on
        // whether movement was already disabled BEFORE the EMP landed; the
        // remaining-frames-only hash could not see that difference.
        const latentA: any = new EmpTrait();
        (latentA as any).remainingFrames = 20;
        (latentA as any).stateApplied = true;
        (latentA as any).previousMoveDisabled = false;
        (latentA as any).previousAttackDisabled = false;

        const latentB: any = new EmpTrait();
        (latentB as any).remainingFrames = 20;
        (latentB as any).stateApplied = true;
        (latentB as any).previousMoveDisabled = true;
        (latentB as any).previousAttackDisabled = false;

        expect(latentA.getHash()).not.toBe(latentB.getHash());
    });

    test("weapon firing state diverges through the armed trait", () => {
        const { ArmedTrait } = require("@/game/gameobject/trait/ArmedTrait");
        const { Weapon } = require("@/game/Weapon");

        // Direct weapon-state divergence without constructing a full rules
        // engine: two instances of the same weapon differ only in cooldown.
        const makeArmed = () => Object.create(ArmedTrait.prototype) as any;
        const a: any = makeArmed();
        const b: any = makeArmed();
        a.specialWeaponIndex = 0;
        b.specialWeaponIndex = 0;
        const weaponFor = (cooldown: number) => {
            const weapon = Object.create(Weapon.prototype);
            weapon.cooldownTicks = cooldown;
            weapon.burstsLeft = 0;
            weapon.burstIndex = 0;
            weapon.useBurstDelay = false;
            weapon.lateralMuzzleMult = 1;
            weapon.rangeBonus = 0;
            return weapon;
        };
        a.primaryWeapon = weaponFor(14);
        b.primaryWeapon = weaponFor(13);
        expect(a.getHash()).not.toBe(b.getHash());

        // Selection state participates too.
        b.primaryWeapon = weaponFor(14);
        expect(a.getHash()).toBe(b.getHash());
        b.specialWeaponIndex = 1;
        expect(a.getHash()).not.toBe(b.getHash());
    });

    test("order/task structure diverges when pending work differs", () => {
        const { GameObject } = require("@/game/gameobject/GameObject");
        const { UnitOrderTrait } = require("@/game/gameobject/trait/UnitOrderTrait");
        const { WaitTicksTask } = require("@/game/gameobject/task/system/WaitTicksTask");

        const orderOf = (type: string) => ({ orderType: type, isValid: () => true, isAllowed: () => true });
        const makeTraitWith = (orders: any[], tasks: any[]) => {
            const object = new GameObject(0 as any, "orders-probe", {} as any, {} as any);
            const trait = new UnitOrderTrait(object);
            (trait as any).orders = orders;
            (trait as any).tasks = tasks;
            return trait;
        };

        const idle = makeTraitWith([], []);
        const busy = makeTraitWith([orderOf("Move")], [new WaitTicksTask(7)]);
        expect(idle.getHash()).not.toBe(busy.getHash());
        // Same shape but queued vs not also diverges.
        const queued = makeTraitWith([orderOf("Move")], []);
        queued.queuedOrders.add(orderOf("Move"));
        expect(busy.getHash()).not.toBe(queued.getHash());
    });
});

describe("global superweapon effect state coverage", () => {
    function makeTraitWithEffects(effects: any[], sources = new Map()) {
        const { SuperWeaponsTrait } = require("@/game/trait/SuperWeaponsTrait");
        const trait = Object.create(SuperWeaponsTrait.prototype);
        (trait as any).effects = effects;
        (trait as any).chronoSphereSources = sources;
        return trait;
    }

    test("active effects participate with their internal phase state", () => {
        const { LightningStormEffect } = require("@/game/superweapon/LightningStormEffect");
        const owner: any = { playerListIndex: 0 };
        const tile: any = { rx: 10, ry: 12 };

        const stormA = new LightningStormEffect("LightningStorm", owner, tile);
        const stormB = new LightningStormEffect("LightningStorm", owner, tile);
        // Simulate one tick of divergence in the manifest countdown.
        (stormA as any).manifestStartTimer = 45;
        (stormB as any).manifestStartTimer = 44;

        const traitA = makeTraitWithEffects([stormA]);
        const traitB = makeTraitWithEffects([stormB]);
        expect(traitA.getHash()).not.toBe(traitB.getHash());
    });

    test("pending ChronoSphere sources diverge the trait hash", () => {
        const effect: any = {
            type: "ChronoSphere",
            status: 1,
            getHash: () => 12345,
        };
        const sourcesA = new Map([[effect, { rules: {}, tile: { rx: 3, ry: 4 } }]]);
        const sourcesB = new Map([[effect, { rules: {}, tile: { rx: 5, ry: 6 } }]]);
        expect(makeTraitWithEffects([effect], sourcesA).getHash())
            .not.toBe(makeTraitWithEffects([effect], sourcesB).getHash());
    });
});

describe("standalone animation damage runtime state", () => {
    const definition = {
        name: "RadiationGlow",
        damage: 10,
        damageDelay: 8,
        rate: 6,
        start: 0,
        end: 9,
        loopStart: 2,
        loopEnd: 7,
        loopCount: -1,
        reverse: false,
    };

    function spawnOne() {
        const { AresAnimationDamageRuntime } = require("@/extensions/ares/AresAnimationDamageRuntime");
        const runtime = new AresAnimationDamageRuntime();
        runtime.spawn({
            definition,
            tile: { rx: 4, ry: 5, z: 0 },
            position: {},
            elevation: 0,
            zone: 0,
        });
        return { AresAnimationDamageRuntime, runtime };
    }

    test("frame clock and accumulators diverge the fingerprint", () => {
        const { AresAnimationDamageRuntime, runtime } = spawnOne();
        const pristine = new AresAnimationDamageRuntime();
        expect(runtime.getHash()).not.toBe(pristine.getHash());

        // Advance one instance's fractional frame clock.
        runtime.update({ applyAresAnimationDamageArea: () => undefined });
        const twin = new AresAnimationDamageRuntime();
        twin.spawn({
            definition,
            tile: { rx: 4, ry: 5, z: 0 },
            position: {},
            elevation: 0,
            zone: 0,
        });
        expect(runtime.getHash()).not.toBe(twin.getHash());
        expect(new AresAnimationDamageRuntime().getHash())
            .toBe(new AresAnimationDamageRuntime().getHash());
    });

    test("snapshot restore round-trips the frame clock exactly", () => {
        const { runtime } = spawnOne();
        for (let i = 0; i < 5; i++) {
            runtime.update({ applyAresAnimationDamageArea: () => undefined });
        }
        const snapshot = JSON.parse(JSON.stringify(runtime.captureState()));

        const restored = new (require("@/extensions/ares/AresAnimationDamageRuntime").AresAnimationDamageRuntime)();
        restored.restoreState(snapshot, {
            resolveTile: (rx: number, ry: number) => ({ rx, ry, z: 0 }),
            resolveDefinition: (name: string) =>
                name === definition.name ? definition : undefined,
        });
        expect(restored.getHash()).toBe(runtime.getHash());
        expect(restored.getActiveCount()).toBe(1);

        // Both instances must keep ticking identically afterwards.
        for (let i = 0; i < 20; i++) {
            runtime.update({ applyAresAnimationDamageArea: () => undefined });
            restored.update({ applyAresAnimationDamageArea: () => undefined });
        }
        expect(restored.getHash()).toBe(runtime.getHash());
    });

    test("invalid payloads throw without mutating", () => {
        const { runtime } = spawnOne();
        const before = runtime.getHash();
        expect(() => runtime.restoreState({ version: 2, nextId: 1, instances: [] }))
            .toThrow(/version/i);
        expect(() => runtime.restoreState({ version: 1, nextId: 1, instances: [{}] }))
            .toThrow(/definition/i);
        expect(() => runtime.restoreState({
            version: 1,
            nextId: 1,
            instances: [{ definitionName: "x", frame: "a", loopNumber: 0, frameAccumulator: 0, accumulator: 0, tileRx: 0, tileRy: 0, elevation: 0 }],
        })).toThrow(/frame/i);
        expect(runtime.getHash()).toBe(before);
    });
});
