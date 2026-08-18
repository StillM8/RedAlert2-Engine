import { NotifyDestroy } from './interface/NotifyDestroy';
import { RadialTileFinder } from '@/game/map/tileFinder/RadialTileFinder';
import { NotifyDamage } from './interface/NotifyDamage';
import { fnv32a } from '@/util/math';
import { BuildingEvacuateEvent } from '@/game/event/BuildingEvacuateEvent';
import { ScatterTask } from '@/game/gameobject/task/ScatterTask';
import { ArmedTrait } from '@/game/gameobject/trait/ArmedTrait';
import { AttackTrait } from '@/game/gameobject/trait/AttackTrait';
import { Weapon } from '@/game/Weapon';
import { WeaponType } from '@/game/WeaponType';
export class GarrisonTrait {
    private building: Building;
    private evacThreshold: number;
    private maxOccupants: number;
    private units: Unit[] = [];
    constructor(building: Building, evacThreshold: number, maxOccupants: number) {
        this.building = building;
        this.evacThreshold = evacThreshold;
        this.maxOccupants = maxOccupants;
    }
    isOccupied(): boolean {
        return this.units.length > 0;
    }
    canBeOccupied(): boolean {
        return this.building.healthTrait.health > 100 * this.evacThreshold;
    }
    getOccupantCount(): number {
        return this.units.length;
    }
    /**
     * InitialPayload creates the infantry directly in limbo rather than
     * walking it through GarrisonBuildingTask.  This keeps normal manual
     * entry semantics untouched while still enforcing MaxNumberOccupants.
     */
    addInitialOccupant(unit: Unit, context: GameContext): boolean {
        if (this.units.length >= this.maxOccupants) return false;
        this.units.push(unit);
        if (this.building.rules.occupantsPowerBonus && this.building.rules.power > 0) {
            this.building.owner.powerTrait?.updateFrom(this.building, "update", context);
        }
        this.updateOccupantWeapons(context);
        return true;
    }
    /**
     * Urban combat: an occupied building fires the occupants' OccupyWeapon
     * (retail behavior — garrisonable civilian structures carry no weapons of
     * their own). The weapon rate already scales with the occupant count.
     */
    updateOccupantWeapons(game: any): void {
        const building: any = this.building;
        const occupier = this.units.find((unit: any) => unit.rules.occupyWeapon);
        if (occupier && !building.rules.occupantsPowerBonus) {
            if (!building.armedTrait) {
                building.armedTrait = new ArmedTrait(building, game.rules);
                building.addTrait(building.armedTrait);
            }
            if (!building.attackTrait) {
                building.attackTrait = new AttackTrait(game.map.tiles, game.map.tileOccupation);
                building.addTrait(building.attackTrait);
            }
            const isElite = false;
            const weaponName = (isElite && occupier.rules.eliteOccupyWeapon) || occupier.rules.occupyWeapon;
            if (building.armedTrait.primaryWeapon?.rules.name !== weaponName) {
                building.armedTrait.primaryWeapon = Weapon.factory(weaponName, WeaponType.Primary, building, game.rules);
                building.armedTrait.secondaryWeapon = undefined;
            }
            building.attackTrait.setDisabled(false);
        }
        else if (building.armedTrait && !building.rules.primary) {
            building.armedTrait.primaryWeapon = undefined;
            building.armedTrait.secondaryWeapon = undefined;
            building.attackTrait?.setDisabled(true);
            building.unitOrderTrait?.getTasks?.().forEach((task: any) => task.cancel?.());
        }
    }
    [NotifyDamage.onDamage](building: Building, context: GameContext): void {
        if (building.healthTrait.health <= 100 * this.evacThreshold) {
            this.evacuate(context);
        }
    }
    [NotifyDestroy.onDestroy](building: Building, context: GameContext, reason: any, isImmediate: boolean): void {
        if (isImmediate) {
            for (const unit of this.units) {
                context.destroyObject(unit, reason, true);
            }
            this.units = [];
        }
        else {
            this.evacuate(context);
        }
    }
    getHash(): number {
        return fnv32a(this.units.map(unit => unit.getHash()));
    }
    debugGetState(): {
        units: any[];
    } {
        return { units: this.units.map(unit => unit.debugGetState()) };
    }
    dispose(): void {
        this.building = undefined;
    }
    evacuate(context: GameContext, forceDestroy: boolean = false): void {
        const building = this.building;
        const units = this.units;
        if (units.length) {
            const speedTypeMap = new Map<string, Unit[]>();
            for (const unit of units) {
                speedTypeMap.set(unit.rules.speedType, (speedTypeMap.get(unit.rules.speedType) || []).concat(unit));
            }
            for (const [speedType, typeUnits] of speedTypeMap) {
                const finder = new RadialTileFinder(context.map.tiles, context.map.mapBounds, building.tile, building.art.foundation, 1, 1, (tile) => {
                    return context.map.terrain.getPassableSpeed(tile, speedType, true, false) > 0 &&
                        Math.abs(tile.z - building.tile.z) < 2 &&
                        !context.map.terrain.findObstacles({ tile, onBridge: undefined }, typeUnits[0]).length;
                });
                const exitTile = finder.getNextTile();
                for (const unit of typeUnits) {
                    const unitIndex = units.indexOf(unit);
                    if (exitTile) {
                        units.splice(unitIndex, 1);
                        context.unlimboObject(unit, exitTile);
                        unit.unitOrderTrait.addTask(new ScatterTask(context));
                    }
                    else if (!forceDestroy) {
                        context.destroyObject(unit, { player: unit.owner });
                        units.splice(unitIndex, 1);
                    }
                }
            }
            const oldOwner = building.owner;
            // Only captured civilian structures revert to neutral when
            // emptied; player-built garrisonables (Bio Reactor, bunkers)
            // stay owned.
            if (!units.length && !building.isDestroyed && building.rules.techLevel === -1) {
                const civilian = context.getCivilianPlayer();
                if (civilian) {
                    context.changeObjectOwner(building, civilian);
                }
            }
            if (!building.isDestroyed &&
                building.rules.occupantsPowerBonus &&
                building.rules.power > 0) {
                building.owner.powerTrait?.updateFrom(building, "update", context);
            }
            if (!building.isDestroyed) {
                this.updateOccupantWeapons(context);
            }
            context.events.dispatch(new BuildingEvacuateEvent(building, oldOwner));
        }
    }
}