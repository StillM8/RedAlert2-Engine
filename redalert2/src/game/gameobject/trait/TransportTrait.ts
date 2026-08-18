import { fnv32a } from '@/util/math';
import { NotifyDestroy } from './interface/NotifyDestroy';
import { ScatterTask } from '../task/ScatterTask';
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
export class TransportTrait {
    private obj: GameObject;
    public units: GameObject[] = [];
    private loadQueue: GameObject[] = [];
    constructor(obj: GameObject) {
        this.obj = obj;
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
    [NotifyDestroy.onDestroy](gameObject: GameObject, world: World, context?: any, forceDestroy?: boolean): void {
        const hasDeathWeapon = !!gameObject.armedTrait?.deathWeapon;
        const isParasite = context?.weapon?.warhead.rules.parasite;
        if (forceDestroy || hasDeathWeapon || gameObject.zone === ZoneType.Air || isParasite) {
            for (const unit of this.units) {
                if (hasDeathWeapon && unit.armedTrait) {
                    unit.armedTrait.deathWeapon = undefined;
                }
                unit.position.tileElevation = gameObject.position.tileElevation;
                unit.zone = gameObject.zone;
                unit.onBridge = gameObject.onBridge;
                unit.position.tile = gameObject.tile;
                world.destroyObject(unit, context, true);
            }
        }
        else {
            this.spawnSurvivors(world);
        }
        this.units = [];
    }
    private spawnSurvivors(world: World): void {
        const transport = this.obj;
        if (this.units.length) {
            for (const unit of this.units) {
                if (world.map.terrain.getPassableSpeed(transport.tile, unit.rules.speedType, unit.isInfantry(), transport.onBridge) > 0) {
                    unit.owner.addOwnedObject(unit);
                    unit.position.tileElevation = transport.onBridge
                        ? world.map.tileOccupation.getBridgeOnTile(transport.tile).tileElevation
                        : 0;
                    unit.onBridge = transport.onBridge;
                    unit.zone = world.map.getTileZone(transport.tile, !transport.onBridge);
                    world.unlimboObject(unit, transport.tile);
                    unit.unitOrderTrait.addTask(new ScatterTask(world));
                }
                else {
                    unit.position.tileElevation = transport.position.tileElevation;
                    unit.zone = transport.zone;
                    unit.onBridge = transport.onBridge;
                    unit.position.tile = transport.tile;
                    world.destroyObject(unit, { player: unit.owner });
                }
            }
            world.events.dispatch(new LeaveTransportEvent(transport));
        }
    }
    getHash(): number {
        return fnv32a(this.units.map((unit) => unit.getHash()));
    }
    debugGetState(): any[] {
        return this.units.map((unit) => unit.debugGetState());
    }
    dispose(): void {
        this.obj = undefined;
    }
}