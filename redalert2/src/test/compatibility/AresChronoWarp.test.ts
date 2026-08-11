import { describe, expect, test } from "bun:test";
import { ActivateSuperWeaponAction } from "@/game/action/ActivateSuperWeaponAction";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";
import { NotifyTick } from "@/game/trait/interface/NotifyTick";
import { SuperWeaponStatus } from "@/game/SuperWeapon";
import { SuperWeaponType } from "@/game/type/SuperWeaponType";

function tile(rx: number, ry: number): any {
    return { rx, ry, z: 0, onBridgeLandType: false };
}

function makeHarness() {
    const sourceTile = tile(4, 4);
    const destinationTile = tile(10, 10);
    let teleportedTo: any;
    const unit: any = {
        tile: sourceTile,
        isSpawned: true,
        isDisposed: false,
        isUnit: () => true,
        isBuilding: () => false,
        isInfantry: () => false,
        isAircraft: () => false,
        isVehicle: () => true,
        onBridge: false,
        tileElevation: 0,
        rules: {
            organic: false,
            teleporter: true,
            speedType: 0,
            movementZone: 0,
        },
        invulnerableTrait: { isActive: () => false },
        warpedOutTrait: {
            active: false,
            isActive() { return this.active; },
            setActive(active: boolean) { this.active = active; },
        },
        moveTrait: {
            teleportUnitToTile(destination: any) {
                teleportedTo = destination;
                unit.tile = destination;
            },
        },
    };

    const sourceRules: any = {
        index: 0,
        name: "ChronoSphereSpecial",
        type: SuperWeaponType.ChronoSphere,
        rechargeTime: 5,
        isPowered: false,
        ares: {},
    };
    const warpRules: any = {
        index: 1,
        name: "ChronoWarpSpecial",
        type: SuperWeaponType.ChronoWarp,
        typeId: "ChronoWarp",
        rechargeTime: 5,
        isPowered: false,
        ares: { extensionType: "ChronoWarp", typeId: "ChronoWarp" },
    };
    const makeWeapon = (rules: any) => ({
        name: rules.name,
        rules,
        status: SuperWeaponStatus.Ready,
        shotsFired: 0,
        resetTimer() {
            this.status = SuperWeaponStatus.Charging;
        },
    });
    const sourceWeapon: any = makeWeapon(sourceRules);
    const warpWeapon: any = makeWeapon(warpRules);
    // ChronoWarp is a PostClick dependent and Mental Omega does not provide
    // it through a building-owned superweapon slot.
    const weapons = [sourceWeapon];
    const owner: any = {
        id: "chrono-owner",
        isAi: false,
        credits: 1000,
        buildings: [],
        superWeaponsTrait: {
            getAll: () => weapons,
            get: (name: string) => weapons.find(weapon => weapon.name === name),
            getAresShotsFired: () => 0,
            recordAresSuperWeaponShot: () => undefined,
        },
    };
    const getTile = (rx: number, ry: number) =>
        rx === sourceTile.rx && ry === sourceTile.ry
            ? sourceTile
            : rx === destinationTile.rx && ry === destinationTile.ry
                ? destinationTile
                : tile(rx, ry);
    const game: any = {
        rules: {
            general: { chronoDelay: 0, padAircraft: [] },
            getSuperWeaponByIndex: (index: number) => index === sourceRules.index ? sourceRules : warpRules,
            superWeaponRules: new Map([
                [sourceRules.name, sourceRules],
                [warpRules.name, warpRules],
            ]),
        },
        map: {
            tiles: { getByMapCoords: getTile },
            getGroundObjectsOnTile: (selectedTile: any) => selectedTile === sourceTile ? [unit] : [],
            tileOccupation: { getBridgeOnTile: () => undefined },
            mapBounds: { isWithinBounds: () => true },
            terrain: { getPassableSpeed: () => 1 },
            getTileZone: () => 0,
        },
        getCombatants: () => [],
        getWorld: () => ({ getAllObjects: () => [unit] }),
        traits: {
            get: () => trait,
            filter: () => [],
        },
        events: { dispatch: () => undefined },
    };
    const trait = new SuperWeaponsTrait();

    return {
        destinationTile,
        game,
        owner,
        sourceRules,
        sourceTile,
        sourceWeapon,
        teleported: () => teleportedTo,
        trait,
        unit,
        warpRules,
        warpWeapon,
    };
}

describe("Ares ChronoWarp runtime", () => {
    test("uses a preceding ChronoSphere source when the dependent has no provider", () => {
        const harness = makeHarness();
        expect(harness.owner.superWeaponsTrait.getAll()).toHaveLength(1);

        // Native Ares separates the two activations. The first call records
        // the source and the actual action below supplies the destination.
        expect(harness.trait.activateSuperWeapon(
            harness.sourceRules.index,
            harness.owner,
            harness.game,
            harness.sourceTile,
        )).toBe(true);
        expect((harness.trait as any).chronoSphereSources.has(harness.owner)).toBe(true);

        const action = new ActivateSuperWeaponAction(harness.game);
        (action as any).player = harness.owner;
        (action as any).superWeaponType = harness.warpRules.index;
        (action as any).tile = {
            x: harness.destinationTile.rx,
            y: harness.destinationTile.ry,
        };
        action.process();
        expect((harness.trait as any).chronoSphereSources.has(harness.owner)).toBe(false);
        expect((harness.trait as any).effects).toHaveLength(1);

        (harness.trait as any)[NotifyTick.onTick](harness.game);

        expect(harness.teleported()).toBe(harness.destinationTile);
        expect(harness.unit.warpedOutTrait.isActive()).toBe(false);
        expect((harness.trait as any).chronoSphereSources.has(harness.owner)).toBe(false);
    });

    test("preserves the existing combined ChronoSphere two-click path", () => {
        const harness = makeHarness();

        expect(harness.trait.activateSuperWeapon(
            harness.sourceRules.index,
            harness.owner,
            harness.game,
            harness.sourceTile,
            harness.destinationTile,
        )).toBe(true);
        expect((harness.trait as any).chronoSphereSources.has(harness.owner)).toBe(false);

        (harness.trait as any)[NotifyTick.onTick](harness.game);

        expect(harness.teleported()).toBe(harness.destinationTile);
    });
});
