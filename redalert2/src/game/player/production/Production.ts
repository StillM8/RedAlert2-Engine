import { QueueType, ProductionQueue } from './ProductionQueue';
import { BuildCat, FactoryType } from '../../rules/TechnoRules';
import { ObjectType } from '@/engine/type/ObjectType';
import { EventDispatcher } from '@/util/event';
import { SideType } from '@/game/SideType';
import { evaluateAresPrerequisiteRules, isFactoryOwnerAllowed } from '@/extensions/ares/AresPrerequisites';
import type { SideId } from '@/extensions/ares/AresSides';
import { fnv32aStrings } from '@/util/math';
export class Production {
    private player: any;
    private maxTechLevel: number;
    private gameOpts: any;
    private rules: any;
    private allAvailableObjects: any[];
    private buildSpeedModifier: number;
    private queues: Map<QueueType, ProductionQueue>;
    private _onQueueUpdate: EventDispatcher<any>;
    private primaryFactories: Map<any, any>;
    private factoryCounts: Map<any, number>;
    private veteranTypes: Set<any>;
    private stolenTech: Set<number | SideId>;
    /** Stable country IDs whose complete factory plans were permanently captured. */
    private permanentFactoryOwnerPlans: Set<string>;
    private theater?: string;
    static factory(player: any, rules: any, gameOpts: any, availableObjects: any[], theater?: string): Production {
        const production = new Production(player, rules.mpDialogSettings.techLevel, gameOpts, rules, availableObjects, theater);
        const maxQueueSize = rules.general.maximumQueuedObjects + 1;
        production.addQueue(QueueType.Structures, new ProductionQueue(QueueType.Structures, 1, 1));
        production.addQueue(QueueType.Armory, new ProductionQueue(QueueType.Armory, 1, 1));
        production.addQueue(QueueType.Infantry, new ProductionQueue(QueueType.Infantry, maxQueueSize, maxQueueSize));
        production.addQueue(QueueType.Vehicles, new ProductionQueue(QueueType.Vehicles, maxQueueSize, maxQueueSize));
        production.addQueue(QueueType.Ships, new ProductionQueue(QueueType.Ships, maxQueueSize, maxQueueSize));
        production.addQueue(QueueType.Aircrafts, new ProductionQueue(QueueType.Aircrafts, 0, maxQueueSize));
        return production;
    }
    constructor(player: any, techLevel: number, gameOpts: any, rules: any, availableObjects: any[], theater?: string) {
        this.player = player;
        this.maxTechLevel = techLevel;
        this.gameOpts = gameOpts;
        this.rules = rules;
        this.allAvailableObjects = availableObjects;
        this.buildSpeedModifier = 1;
        this.queues = new Map();
        this._onQueueUpdate = new EventDispatcher();
        this.primaryFactories = new Map();
        this.factoryCounts = new Map();
        this.veteranTypes = new Set();
        this.stolenTech = new Set();
        this.permanentFactoryOwnerPlans = new Set();
        this.theater = theater;
    }
    get onQueueUpdate() {
        return this._onQueueUpdate.asEvent();
    }
    addQueue(type: QueueType, queue: ProductionQueue) {
        this.queues.set(type, queue);
        queue.onUpdate.subscribe(() => this._onQueueUpdate.dispatch(this, queue));
    }
    getQueue(type: QueueType): ProductionQueue {
        const queue = this.queues.get(type);
        if (!queue) {
            throw new Error("No queue found with type " + QueueType[type]);
        }
        return queue;
    }
    getAllQueues(): ProductionQueue[] {
        return [...this.queues.values()];
    }
    getQueueTypeForObject(object: any): QueueType {
        if (object.type === ObjectType.Building) {
            return object.buildCat === BuildCat.Combat
                ? QueueType.Armory
                : QueueType.Structures;
        }
        if (object.type === ObjectType.Infantry) {
            return QueueType.Infantry;
        }
        if (object.type === ObjectType.Vehicle) {
            return object.naval ? QueueType.Ships : QueueType.Vehicles;
        }
        if (object.type === ObjectType.Aircraft) {
            return QueueType.Aircrafts;
        }
        throw new Error("Unsupported object type " + ObjectType[object.type]);
    }
    getQueueForObject(object: any): ProductionQueue {
        return this.getQueue(this.getQueueTypeForObject(object));
    }
    getQueueTypeForFactory(type: FactoryType): QueueType {
        if (type === FactoryType.InfantryType)
            return QueueType.Infantry;
        if (type === FactoryType.UnitType)
            return QueueType.Vehicles;
        if (type === FactoryType.AircraftType)
            return QueueType.Aircrafts;
        if (type === FactoryType.NavalUnitType)
            return QueueType.Ships;
        throw new Error("Unsupported factory type " + FactoryType[type]);
    }
    getFactoryTypeForQueueType(type: QueueType): FactoryType {
        if (type === QueueType.Structures || type === QueueType.Armory) {
            return FactoryType.BuildingType;
        }
        if (type === QueueType.Infantry)
            return FactoryType.InfantryType;
        if (type === QueueType.Vehicles)
            return FactoryType.UnitType;
        if (type === QueueType.Aircrafts)
            return FactoryType.AircraftType;
        if (type === QueueType.Ships)
            return FactoryType.NavalUnitType;
        throw new Error("Unsupported queue type " + QueueType[type]);
    }
    getQueueForFactory(type: FactoryType): ProductionQueue {
        return this.getQueue(this.getQueueTypeForFactory(type));
    }
    isAvailableForProduction(object: any): boolean {
        return (object.isAvailableTo(this.player.country) &&
            object.techLevel !== -1 &&
            object.techLevel <= this.maxTechLevel &&
            !(object.buildLimit === 0 && !this.player.isAi) &&
            !(object.superWeapon &&
                this.rules.getSuperWeapon(object.superWeapon).disableableFromShell &&
                !this.gameOpts.superWeapons) &&
            this.hasFactoryFor(object) &&
            this.meetsPrerequisites(object) &&
            this.meetsStolenTech(object));
    }
    getAvailableObjects(): any[] {
        return this.allAvailableObjects.filter(obj => this.isAvailableForProduction(obj));
    }
    hasFactoryFor(object: any): boolean {
        const objectOwners = object.owner ?? [];
        const factoryOwners = object.factoryOwners ?? [];
        const factoryOwnersForbidden = object.factoryOwnersForbidden ?? [];
        if (objectOwners.length || factoryOwners.length || factoryOwnersForbidden.length) {
            const factoryType = this.getFactoryTypeFor(object);
            const ownedBuildings = Array.from(this.player.buildings);
            const canUseObjectOwner = (ownerId: string | undefined): boolean =>
                objectOwners.length === 0 || (!!ownerId && objectOwners.some((objectOwner: string) =>
                    ownerId.trim().toLocaleLowerCase("en-US") === objectOwner.trim().toLocaleLowerCase("en-US")));
            const factoryOwnerId = (building: any): string | undefined =>
                building.initialFactoryOwnerId ?? building.owner?.country?.id ?? building.owner?.country?.name;
            const hasFactory = ownedBuildings.some((building: any) => {
                const ownerId = factoryOwnerId(building);
                return building.factoryTrait?.type === factoryType &&
                    (factoryType !== FactoryType.UnitType || building.rules.naval === object.naval) &&
                    (objectOwners.length === 0 ||
                        !!(building.rules.owner ?? []).find((owner: string) =>
                            objectOwners.some((objectOwner: string) => owner.toLowerCase() === objectOwner.toLowerCase()))) &&
                    isFactoryOwnerAllowed(ownerId, factoryOwners, factoryOwnersForbidden);
            });
            if (hasFactory) return true;

            // Ares allows a BuildingType with HasAllPlans to satisfy the
            // FactoryOwners requirement for every factory type while it is
            // held. Permanent plans are retained separately after capture.
            const allPlanOwners = new Set<string>(this.permanentFactoryOwnerPlans ?? []);
            ownedBuildings
                .filter((building: any) => building.rules.factoryOwnersHasAllPlans)
                .map(factoryOwnerId)
                .filter((ownerId): ownerId is string => !!ownerId)
                .forEach((ownerId) => allPlanOwners.add(ownerId));
            return [...allPlanOwners].some((ownerId) =>
                canUseObjectOwner(ownerId) &&
                isFactoryOwnerAllowed(ownerId, factoryOwners, factoryOwnersForbidden));
        }
        return true;
    }
    meetsStolenTech(object: any): boolean {
        // stolenTech stores raw AIBasePlanningSide indices from the infiltrated
        // battle lab (AgentTrait): 0/1 coincide with SideType.GDI/Nod, but YR's
        // third side (YATECH) is index 2 — NOT SideType.Yuri. Without the third
        // check, YR's Psi Commando (PTROOP, RequiresStolenThirdTech=yes) leaks
        // into every barracks at tech 9.
        const THIRD_SIDE_TECH = 2;
        return (!object.requiresStolenAlliedTech || this.hasStolenTech(SideType.GDI)) &&
            (!object.requiresStolenSovietTech || this.hasStolenTech(SideType.Nod)) &&
            (!object.requiresStolenThirdTech || this.hasStolenTech(THIRD_SIDE_TECH));
    }
    getFactoryTypeFor(object: any): FactoryType {
        if (object.type === ObjectType.Building)
            return FactoryType.BuildingType;
        if (object.type === ObjectType.Infantry)
            return FactoryType.InfantryType;
        if (object.type === ObjectType.Aircraft)
            return FactoryType.AircraftType;
        return object.naval ? FactoryType.NavalUnitType : FactoryType.UnitType;
    }
    meetsPrerequisites(object: any): boolean {
        const ownedObjects = typeof this.player.getOwnedObjects === "function"
            ? this.player.getOwnedObjects()
            : Array.from(this.player.buildings);
        const alternativeLists = object.prerequisiteLists ?? [object.prerequisite ?? []];
        return evaluateAresPrerequisiteRules({
            alternativeLists,
            negative: object.negativePrerequisite ?? [],
            requiredTheaters: object.requiredTheaters ?? [],
            stolenTechs: object.stolenTechs ?? [],
            factoryOwners: object.factoryOwners ?? [],
            factoryOwnersForbidden: object.factoryOwnersForbidden ?? [],
        }, {
            ownedObjectNames: ownedObjects.map((owned: any) => owned.name),
            genericGroups: this.rules.general.genericPrerequisites,
            genericAlternates: this.rules.general.genericPrerequisiteAlternates,
            stolenTechs: this.stolenTech,
            theater: this.theater,
        });
    }
    getPrimaryFactory(type: FactoryType): any {
        return this.primaryFactories.get(type);
    }
    setPrimaryFactory(building: any) {
        if (building.rules.factory) {
            this.primaryFactories.set(building.rules.factory, building);
        }
    }
    isPrimaryFactory(building: any): boolean {
        return this.getPrimaryFactory(building.rules.factory) === building;
    }
    incrementFactoryCount(type: FactoryType) {
        this.factoryCounts.set(type, (this.factoryCounts.get(type) ?? 0) + 1);
    }
    decrementFactoryCount(type: FactoryType) {
        if (!this.factoryCounts.get(type)) {
            throw new Error(`Can't decrement factory count ${FactoryType[type]}. Already 0`);
        }
        this.factoryCounts.set(type, this.factoryCounts.get(type)! - 1);
    }
    getFactoryCount(type: FactoryType): number {
        return this.factoryCounts.get(type) ?? 0;
    }
    crownPrimaryFactoryHeir(type: FactoryType) {
        const heir = Array.from(this.player.buildings).find((building: any) => building.rules.factory === type);
        if (heir) {
            this.primaryFactories.set(type, heir);
        }
        else {
            this.primaryFactories.delete(type);
        }
    }
    hasAnyFactory(): boolean {
        return this.primaryFactories.size > 0;
    }
    addVeteranType(type: any) {
        this.veteranTypes.add(type);
    }
    hasVeteranType(type: any): boolean {
        return this.veteranTypes.has(type);
    }
    private hasStolenTech(value: number | SideId): boolean {
        if (typeof value === "number") {
            return this.stolenTech.has(value) || this.stolenTech.has(String(value));
        }
        const normalized = value.trim().toLocaleLowerCase("en-US");
        return [...this.stolenTech].some((entry) =>
            typeof entry === "string" && entry.trim().toLocaleLowerCase("en-US") === normalized,
        );
    }
    addStolenTech(type: number | SideId) {
        this.stolenTech.add(type);
    }
    addPermanentFactoryOwnerPlans(countryId: string | undefined): void {
        if (countryId?.trim()) {
            this.permanentFactoryOwnerPlans.add(countryId.trim());
        }
    }
    /**
     * Hashes extension-owned production state that changes the effective
     * rules available to this player. Queue state is intentionally not added
     * here because it is represented by the existing action/replay flow.
     */
    getHash(): number {
        const stolenTech = [...(this.stolenTech ?? [])]
            .map(value => `${typeof value === "number" ? "number" : "side"}:${value}`)
            .sort();
        const permanentFactoryOwnerPlans = [...(this.permanentFactoryOwnerPlans ?? [])].sort();
        return fnv32aStrings([
            "production-extension-state",
            "stolen-tech",
            ...stolenTech,
            "permanent-factory-owner-plans",
            ...permanentFactoryOwnerPlans,
        ]);
    }
    debugGetState(): {
        stolenTechs: Array<number | SideId>;
        permanentFactoryOwnerPlans: string[];
    } {
        const stolenTechs = [...(this.stolenTech ?? [])].sort((a, b) =>
            `${typeof a}:${a}`.localeCompare(`${typeof b}:${b}`));
        return {
            stolenTechs,
            permanentFactoryOwnerPlans: [...(this.permanentFactoryOwnerPlans ?? [])].sort(),
        };
    }
    dispose() {
        this.queues.clear();
        this.stolenTech.clear();
        this.permanentFactoryOwnerPlans.clear();
        this.player = undefined;
    }
}
