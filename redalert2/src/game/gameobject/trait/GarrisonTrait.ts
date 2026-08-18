import { NotifyDestroy } from './interface/NotifyDestroy';
import { RadialTileFinder } from '@/game/map/tileFinder/RadialTileFinder';
import { NotifyDamage } from './interface/NotifyDamage';
import { fnv32aStrings } from '@/util/math';
import { BuildingEvacuateEvent } from '@/game/event/BuildingEvacuateEvent';
import { ScatterTask } from '@/game/gameobject/task/ScatterTask';
import { ArmedTrait } from '@/game/gameobject/trait/ArmedTrait';
import { AttackTrait } from '@/game/gameobject/trait/AttackTrait';
import { Weapon } from '@/game/Weapon';
import { WeaponType } from '@/game/WeaponType';
import { canAresUrbanCombatInfantryOccupy } from '@/extensions/ares/AresUrbanCombatRuntime';
export class GarrisonTrait {
    private building: Building;
    private evacThreshold: number;
    private maxOccupants: number;
    private units: Unit[] = [];
    /** Owner that must receive a neutral/raidable bunker again once the
     * temporary occupants leave. This is explicit state instead of the old
     * TechLevel=-1 heuristic so player-owned Bunker.Raidable buildings work. */
    private trueOwner: any;
    private temporaryOccupation: boolean = false;
    constructor(building: Building, evacThreshold: number, maxOccupants: number) {
        this.building = building;
        this.evacThreshold = evacThreshold;
        this.maxOccupants = maxOccupants;
        this.trueOwner = (building as any).owner;
    }
    isOccupied(): boolean {
        return this.units.length > 0;
    }
    canBeOccupied(): boolean {
        return (this.building as any).healthTrait.health > 100 * this.evacThreshold;
    }
    getOccupantCount(): number {
        return this.units.length;
    }
    isTemporarilyOccupied(): boolean {
        return this.temporaryOccupation;
    }
    /** Conventional capture changes the building's true owner. Temporary
     * Bunker.Raidable ownership does not. */
    setTrueOwner(owner: any): void {
        if (!this.temporaryOccupation) {
            this.trueOwner = owner;
        }
    }
    /**
     * Single authoritative occupancy gate for both cursor/order validation and
     * the final enter task. This consumes Ares CanBeOccupiedBy and
     * Bunker.Raidable without changing non-Ares garrison behavior.
     */
    canAcceptOccupant(unit: any, context: any): boolean {
        const building: any = this.building;
        // Preserve retail YR: allied players may enter an empty allied urban
        // building, but one garrison may not mix infantry belonging to two
        // different owners.
        if (this.units.length && (this.units[0] as any).owner !== unit.owner) {
            return false;
        }
        const urban = building.rules.aresUrbanCombat ?? {
            bunkerRaidable: false,
            canBeOccupiedBy: [],
        };
        const battery = building.rules.occupantsPowerBonus > 0 && !unit.rules.slaved;
        return canAresUrbanCombatInfantryOccupy(
            urban,
            String(unit.rules?.name ?? unit.name ?? ''),
            {
                buildingCanBeOccupied: this.canBeOccupied(),
                infantryIsOccupier: !!unit.rules.occupier || battery,
                buildingIsFull: this.units.length >= this.maxOccupants,
                buildingIsEmpty: this.units.length === 0,
                sameOwner: context.areFriendly(unit, building),
                buildingIsNeutral: !!building.owner?.isNeutral,
                infantryIsHostile: !building.owner?.isNeutral && !context.areFriendly(unit, building),
                infantryIsMindControlled: !!unit.mindControllableTrait?.isActive?.() ||
                    !!unit.mindControllerTrait?.isActive?.(),
            },
        );
    }
    /**
     * Claim an empty neutral or Bunker.Raidable building for the entering
     * infantry while retaining the prior owner for Ares' automatic reversion.
     */
    beginTemporaryOccupation(newOwner: any, context: any): boolean {
        const building: any = this.building;
        if (this.units.length || building.owner === newOwner) return false;
        if (!this.temporaryOccupation) {
            this.trueOwner = building.owner;
            this.temporaryOccupation = true;
        }
        context.changeObjectOwner(building, newOwner);
        return true;
    }
    /**
     * Revert an empty temporarily claimed building. Exposed so occupant-death
     * paths (for example UC.PassThrough) can complete the same lifecycle even
     * though no explicit evacuation task ran.
     */
    restoreTemporaryOwnerIfEmpty(context: any): boolean {
        const building: any = this.building;
        if (this.units.length || !this.temporaryOccupation) return false;
        const previousOwner = building.owner;
        if (this.trueOwner && building.owner !== this.trueOwner) {
            context.changeObjectOwner(building, this.trueOwner);
        }
        this.temporaryOccupation = false;
        if (!building.isDestroyed) {
            if (building.rules.occupantsPowerBonus && building.rules.power > 0) {
                building.owner.powerTrait?.updateFrom(building, "update", context);
            }
            this.updateOccupantWeapons(context);
        }
        return previousOwner !== building.owner;
    }
    /**
     * InitialPayload creates the infantry directly in limbo rather than
     * walking it through GarrisonBuildingTask.  This keeps normal manual
     * entry semantics untouched while still enforcing MaxNumberOccupants.
     */
    addInitialOccupant(unit: Unit, context: GameContext): boolean {
        if (this.units.length >= this.maxOccupants) return false;
        this.units.push(unit);
        if ((this.building as any).rules.occupantsPowerBonus && (this.building as any).rules.power > 0) {
            (this.building as any).owner.powerTrait?.updateFrom(this.building, "update", context);
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
        if ((building as any).healthTrait.health <= 100 * this.evacThreshold) {
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
        // Temporary ownership is already present in the building's owner hash;
        // include the retained true owner identity so two peers cannot silently
        // disagree about who receives an emptied raidable bunker.
        const ownerIdentity = String(this.trueOwner?.id ?? this.trueOwner?.name ?? this.trueOwner?.country?.id ?? '');
        return fnv32aStrings([
            this.temporaryOccupation ? 1 : 0,
            ownerIdentity,
            ...this.units.map(unit => unit.getHash()),
        ]);
    }
    debugGetState(): {
        units: any[];
        temporaryOccupation: boolean;
        trueOwner?: string;
    } {
        return {
            units: this.units.map(unit => unit.debugGetState()),
            temporaryOccupation: this.temporaryOccupation,
            trueOwner: String(this.trueOwner?.id ?? this.trueOwner?.name ?? this.trueOwner?.country?.id ?? '') || undefined,
        };
    }
    dispose(): void {
        this.building = undefined as any;
        this.trueOwner = undefined;
    }
    evacuate(context: GameContext, forceDestroy: boolean = false): void {
        const building: any = this.building;
        const units = this.units;
        if (units.length) {
            const speedTypeMap = new Map<string, Unit[]>();
            for (const unit of units) {
                speedTypeMap.set((unit as any).rules.speedType, (speedTypeMap.get((unit as any).rules.speedType) || []).concat(unit));
            }
            for (const [speedType, typeUnits] of speedTypeMap) {
                const finder = new RadialTileFinder((context as any).map.tiles, (context as any).map.mapBounds, building.tile, building.art.foundation, 1, 1, (tile) => {
                    return (context as any).map.terrain.getPassableSpeed(tile, speedType, true, false) > 0 &&
                        Math.abs(tile.z - building.tile.z) < 2 &&
                        !(context as any).map.terrain.findObstacles({ tile, onBridge: undefined }, typeUnits[0]).length;
                });
                const exitTile = finder.getNextTile();
                for (const unit of typeUnits) {
                    const unitIndex = units.indexOf(unit);
                    if (exitTile) {
                        units.splice(unitIndex, 1);
                        (context as any).unlimboObject(unit, exitTile);
                        (unit as any).unitOrderTrait.addTask(new ScatterTask(context as any));
                    }
                    else if (!forceDestroy) {
                        (context as any).destroyObject(unit, { player: (unit as any).owner });
                        units.splice(unitIndex, 1);
                    }
                }
            }
            const oldOwner = building.owner;
            if (!units.length && !building.isDestroyed) {
                // Ares Bunker.Raidable and retail neutral urban buildings both
                // revert to the owner captured at temporary-entry time.
                this.restoreTemporaryOwnerIfEmpty(context);
            }
            if (!building.isDestroyed &&
                building.rules.occupantsPowerBonus &&
                building.rules.power > 0) {
                building.owner.powerTrait?.updateFrom(building, "update", context);
            }
            if (!building.isDestroyed) {
                this.updateOccupantWeapons(context);
            }
            (context as any).events.dispatch(new BuildingEvacuateEvent(building, oldOwner));
        }
    }
}