import { fnv32a } from '@/util/math';
import { NotifyDestroy } from './interface/NotifyDestroy';
import { NotifyCrash } from './interface/NotifyCrash';
import { ScatterTask } from '../task/ScatterTask';
import { ParadropTask } from '../task/ParadropTask';
import { LeaveTransportEvent } from '@/game/event/LeaveTransportEvent';
import { NotifyTick } from './interface/NotifyTick';
import { ZoneType } from '../unit/ZoneType';
import { GameObject } from '../GameObject';
import { World } from '@/game/World';
import {
    getAresPassengerCapacityCost,
    getAresPassengerRules,
    isAresPassengerTypeAllowed,
} from '@/extensions/ares/AresPassengers';
import {
    getAresSurvivorPassengerChance,
    shouldAresPassengerSurvive,
} from '@/extensions/ares/AresSurvivors';

export interface TransportTraitOptions {
    /** Whether ordinary player-issued boarding may target this hold. */
    manualEntry?: boolean;
    /** Whether ordinary player-issued evacuation/deploy may empty this hold. */
    manualUnload?: boolean;
}

export class TransportTrait implements NotifyDestroy, NotifyCrash {
    private obj: GameObject;
    public units: GameObject[] = [];
    private loadQueue: GameObject[] = [];
    private readonly manualEntryEnabled: boolean;
    private readonly manualUnloadEnabled: boolean;
    /** Explicit Ares airborne survivor handling runs at crash start so surviving
     * passengers can actually paradrop. Final destruction must not process the
     * same cargo a second time. */
    private crashPassengersResolved: boolean = false;
    constructor(obj: GameObject, options: TransportTraitOptions = {}) {
        this.obj = obj;
        this.manualEntryEnabled = options.manualEntry ?? true;
        this.manualUnloadEnabled = options.manualUnload ?? true;
    }
    unitFitsInside(unit: GameObject): boolean {
        const rules = getAresPassengerRules(this.obj.rules);
        const passengerTypeId = String(unit.rules?.name ?? unit.name ?? '');
        // Ares' Specific Passengers gate is independent from size/capacity.
        // SizeLimit is always respected even when Passengers.BySize=no.
        if (!isAresPassengerTypeAllowed(rules, passengerTypeId) ||
            unit.rules.size > this.obj.rules.sizeLimit) {
            return false;
        }
        return this.getPassengerCapacityCost(unit) <= this.getAvailableCapacity();
    }
    /** NoManualEnter only suppresses player-issued entry. Script/AI/Abductor
     * code may still manipulate the hold directly. Hidden Ares passenger holds
     * on non-transport Technos also opt out here. */
    allowsManualEntry(): boolean {
        return this.manualEntryEnabled && getAresPassengerRules(this.obj.rules)?.noManualEnter !== true;
    }
    /** NoManualUnload suppresses the player's deploy/evacuate order. Forced
     * evacuation on destruction and script-owned lifecycle paths remain valid. */
    allowsManualUnload(): boolean {
        return this.manualUnloadEnabled && getAresPassengerRules(this.obj.rules)?.noManualUnload !== true;
    }
    private getPassengerCapacityCost(unit: GameObject): number {
        return getAresPassengerCapacityCost(
            getAresPassengerRules(this.obj.rules),
            Number(unit.rules?.size ?? 0),
        );
    }
    getOccupiedCapacity(): number {
        return this.units.reduce((sum, unit) => sum + this.getPassengerCapacityCost(unit), 0);
    }
    getMaxCapacity(): number {
        return this.obj.rules.passengers;
    }
    getAvailableCapacity(): number {
        return this.getMaxCapacity() - this.getOccupiedCapacity();
    }
    addToLoadQueue(unit: GameObject): number {
        this.loadQueue.push(unit);
        return this.loadQueue.length - 1;
    }
    unitIsFirstInLoadQueue(unit: GameObject): boolean {
        return this.loadQueue[0] === unit;
    }
    removeFromLoadQueue(unit: GameObject): void {
        const index = this.loadQueue.indexOf(unit);
        if (index !== -1) {
            this.loadQueue.splice(index, 1);
        }
    }
    [NotifyTick.onTick](gameObject: GameObject, world: World): void {
        this.loadQueue = this.loadQueue.filter((unit) => !unit.isDestroyed && !unit.isCrashing);
    }
    [NotifyCrash.onCrash](gameObject: GameObject, world: World, context?: any): void {
        // Ares explicitly allows an authored passenger chance to let cargo
        // survive an airborne transport. Resolve it while the carrier is still
        // airborne so survivors use the ordinary ParadropTask. The special -1
        // value intentionally keeps the original YR transport-class behavior
        // and is left for final destruction.
        if (this.crashPassengersResolved || !this.units.length ||
            getAresSurvivorPassengerChance(gameObject) < 0) {
            return;
        }
        this.resolvePassengerDestruction(gameObject, world, context, true);
        this.crashPassengersResolved = true;
    }
    [NotifyDestroy.onDestroy](gameObject: GameObject, world: World, context?: any, forceDestroy?: boolean): void {
        if (this.crashPassengersResolved) {
            this.units = [];
            return;
        }
        const hasDeathWeapon = !!gameObject.armedTrait?.deathWeapon;
        const isParasite = context?.weapon?.warhead?.rules?.parasite;
        const explicitAresChance = getAresSurvivorPassengerChance(gameObject) >= 0;
        // Silent/forced destruction remains a hard cleanup path. Without an
        // authored Ares chance, retain the legacy death-weapon/air/parasite
        // behavior; explicit survivor settings are the modder's override.
        const hardKill = !!forceDestroy || (!explicitAresChance &&
            (hasDeathWeapon || gameObject.zone === ZoneType.Air || isParasite));
        if (hardKill) {
            for (const unit of this.units) {
                this.destroyPassenger(unit, gameObject, world, context, hasDeathWeapon);
            }
        }
        else {
            this.resolvePassengerDestruction(gameObject, world, context, false);
        }
        this.units = [];
    }
    private resolvePassengerDestruction(
        transport: GameObject,
        world: World,
        context: any,
        airborne: boolean,
    ): void {
        const passengers = [...this.units];
        let survivors = 0;
        for (const unit of passengers) {
            if (!shouldAresPassengerSurvive(transport, world)) {
                this.destroyPassenger(unit, transport, world, context, false);
                continue;
            }
            const spawn = this.findSurvivorSpawn(unit, transport, world);
            if (!spawn) {
                // Ares counts a passenger that won its chance roll but could not
                // find clear ground as killed by the transport's killer.
                this.destroyPassenger(unit, transport, world, context, false);
                continue;
            }
            unit.owner.addOwnedObject(unit);
            unit.position.tileElevation = airborne
                ? transport.position.tileElevation
                : spawn.onBridge?.tileElevation ?? 0;
            unit.onBridge = !airborne && !!spawn.onBridge;
            unit.zone = airborne
                ? ZoneType.Air
                : world.map.getTileZone(spawn.tile, !spawn.onBridge);
            world.unlimboObject(unit, spawn.tile);
            if (airborne) {
                unit.unitOrderTrait.addTask(new ParadropTask(world));
            }
            else {
                unit.unitOrderTrait.addTask(new ScatterTask(world));
            }
            survivors++;
        }
        if (survivors > 0) {
            world.events.dispatch(new LeaveTransportEvent(transport));
        }
        this.units = [];
    }
    private findSurvivorSpawn(unit: GameObject, transport: GameObject, world: World): { tile: any; onBridge?: any } | undefined {
        const map = world.map;
        // Stable ring order keeps lockstep peers identical without consuming
        // extra PRNG values beyond Ares' documented per-passenger chance roll.
        const offsets = [
            [0, -1], [1, -1], [1, 0], [1, 1],
            [0, 1], [-1, 1], [-1, 0], [-1, -1],
            [0, 0],
        ];
        for (const [dx, dy] of offsets) {
            const tile = map.tiles.getByMapCoords(transport.tile.rx + dx, transport.tile.ry + dy);
            if (!tile || !map.mapBounds.isWithinBounds(tile)) continue;
            const bridge = map.tileOccupation.getBridgeOnTile(tile);
            const layers = bridge ? [bridge, undefined] : [undefined];
            for (const onBridge of layers) {
                if (map.terrain.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), !!onBridge) <= 0) {
                    continue;
                }
                if (map.terrain.findObstacles?.({ tile, onBridge }, unit)?.length) {
                    continue;
                }
                return { tile, onBridge };
            }
        }
        return undefined;
    }
    private destroyPassenger(
        unit: GameObject,
        transport: GameObject,
        world: World,
        context: any,
        suppressDeathWeapon: boolean,
    ): void {
        if (suppressDeathWeapon && unit.armedTrait) {
            unit.armedTrait.deathWeapon = undefined;
        }
        unit.position.tileElevation = transport.position.tileElevation;
        unit.zone = transport.zone;
        unit.onBridge = transport.onBridge;
        unit.position.tile = transport.tile;
        world.destroyObject(unit, context, true);
    }
    getHash(): number {
        // The load queue is simulation state: two peers that disagree about
        // boarding order would resolve entry differently on the same tick.
        return fnv32a([
            ...this.units.map((unit) => unit.getHash()),
            ...this.loadQueue.map((unit) => unit.getHash()),
        ]);
    }
    debugGetState(): any[] {
        return this.units.map((unit) => unit.debugGetState());
    }
    dispose(): void {
        this.obj = undefined;
    }
}
