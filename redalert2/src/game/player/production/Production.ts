import {
    QueueType,
    ProductionQueue,
    type ProductionQueueState,
    type ProductionQueueRestoreContext,
    type QueueRestorePlan,
} from './ProductionQueue';
import { BuildCat, FactoryType } from '../../rules/TechnoRules';
import { ObjectType } from '@/engine/type/ObjectType';
import { EventDispatcher } from '@/util/event';
import { SideType } from '@/game/SideType';
import { evaluateAresPrerequisiteRules, isFactoryOwnerAllowed } from '@/extensions/ares/AresPrerequisites';
import type { SideId } from '@/extensions/ares/AresSides';
import { fnv32aStrings } from '@/util/math';
import { isAresEmpOperational } from '@/extensions/ares/AresEMP';
import {
    restoreAresProductionExtensionState,
    serializeAresProductionExtensionState,
    type AresProductionExtensionState,
} from '@/extensions/ares/AresProductionState';

export const PRODUCTION_STATE_VERSION = 2 as const;

export interface ProductionState {
    readonly version: typeof PRODUCTION_STATE_VERSION;
    readonly extension: AresProductionExtensionState;
    /** Mutable power/production modifier consumed by the next queue tick. */
    readonly buildSpeedModifier: number;
    /** Historical factory unlocks granted by infiltration. */
    readonly veteranFactoryTypes: readonly FactoryType[];
    readonly queues: readonly ProductionQueueState[];
}

export interface ProductionRestoreContext extends ProductionQueueRestoreContext {}
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
    private veteranTypes: Set<FactoryType>;
    private stolenTech: Set<number | SideId>;
    /** Stable country IDs whose complete factory plans were permanently captured. */
    private permanentFactoryOwnerPlans: Set<string>;
    /** TechnoType names unlocked by reverse-engineering. */
    private reverseEngineeredPlans: Set<string>;
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
        this.reverseEngineeredPlans = new Set();
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
        const reverseEngineered = this.hasReverseEngineeredPlan(object);
        return ((reverseEngineered || object.isAvailableTo(this.player.country)) &&
            (reverseEngineered || (object.techLevel !== -1 && object.techLevel <= this.maxTechLevel)) &&
            !(object.buildLimit === 0 && !this.player.isAi) &&
            !(object.superWeapon &&
                this.rules.getSuperWeapon(object.superWeapon).disableableFromShell &&
                !this.gameOpts.superWeapons) &&
            this.hasFactoryFor(object) &&
            (reverseEngineered ? this.meetsReverseEngineeredPrerequisites(object) : this.meetsPrerequisites(object)) &&
            (reverseEngineered || this.meetsStolenTech(object)));
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
    /**
     * A reverse-engineered plan keeps only the restrictions documented by
     * Ares: negative prerequisites and required theaters. Positive
     * prerequisites, house/tech-level gates, and stolen-tech requirements are
     * deliberately bypassed; factory/naval checks remain in hasFactoryFor().
     */
    meetsReverseEngineeredPrerequisites(object: any): boolean {
        const ownedObjects = typeof this.player.getOwnedObjects === "function"
            ? this.player.getOwnedObjects()
            : Array.from(this.player.buildings);
        return evaluateAresPrerequisiteRules({
            alternativeLists: [[]],
            negative: object.negativePrerequisite ?? [],
            requiredTheaters: object.requiredTheaters ?? [],
            stolenTechs: [],
            factoryOwners: [],
            factoryOwnersForbidden: [],
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
    /**
     * Ares pauses queue progress when all factories serving that queue are
     * EMP-disabled. The count-only fallback preserves headless tests that
     * register factories without materializing Building objects.
     */
    hasOperationalFactory(type: FactoryType): boolean {
        const buildings = [...(this.player.buildings ?? [])]
            .filter((building: any) => building.factoryTrait?.type === type || building.rules?.factory === type);
        if (!buildings.length) {
            return this.getFactoryCount(type) > 0;
        }
        return buildings.some((building: any) => isAresEmpOperational(building));
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
    addVeteranType(type: FactoryType) {
        if (!isFactoryType(type)) {
            throw new RangeError(`Invalid veteran factory type ${String(type)}`);
        }
        this.veteranTypes.add(type);
    }
    hasVeteranType(type: FactoryType): boolean {
        return this.veteranTypes?.has(type) ?? false;
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
    addReverseEngineeredPlan(typeName: string): void {
        const normalized = typeName.trim();
        if (normalized) {
            this.reverseEngineeredPlans.add(normalized);
        }
    }
    hasReverseEngineeredPlan(objectOrName: any): boolean {
        const name = typeof objectOrName === "string" ? objectOrName : objectOrName?.name;
        if (!name) {
            return false;
        }
        const normalized = name.trim().toLocaleLowerCase("en-US");
        return [...(this.reverseEngineeredPlans ?? [])].some((plan) =>
            plan.trim().toLocaleLowerCase("en-US") === normalized);
    }
    clearReverseEngineeredPlans(): void {
        this.reverseEngineeredPlans.clear();
    }
    getReverseEngineeredPlans(): string[] {
        return [...this.reverseEngineeredPlans];
    }
    addPermanentFactoryOwnerPlans(countryId: string | undefined): void {
        if (countryId?.trim()) {
            this.permanentFactoryOwnerPlans.add(countryId.trim());
        }
    }
    /**
     * Returns the Ares-owned portion of production state in a versioned form.
     * Antares serializes gathered factory plans with house state; keeping this
     * boundary on Production lets the future full-game snapshot codec restore
     * it without serializing live building objects or registry instances.
     */
    serializeState(): AresProductionExtensionState {
        return serializeAresProductionExtensionState({
            stolenTech: this.stolenTech ?? [],
            permanentFactoryOwnerPlans: this.permanentFactoryOwnerPlans ?? [],
            reverseEngineeredPlans: this.reverseEngineeredPlans ?? [],
        });
    }

    /** Complete canonical production state, including ordered queue progress. */
    captureState(): ProductionState {
        return {
            version: PRODUCTION_STATE_VERSION,
            extension: this.serializeState(),
            buildSpeedModifier: this.buildSpeedModifier,
            veteranFactoryTypes: this.getVeteranFactoryTypes(),
            queues: this.getAllQueues()
                .slice()
                .sort((a, b) => a.type - b.type)
                .map(queue => queue.captureState()),
        };
    }

    /**
     * Transactional full production restore. Every queue and extension set is
     * prepared before any live queue or Ares collection is changed.
     */
    restoreDeterministicState(state: unknown, context: ProductionRestoreContext = {}): void {
        if (typeof state !== "object" || state === null) {
            throw new Error("Invalid production state: expected an object");
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== PRODUCTION_STATE_VERSION) {
            throw new Error(`Unsupported production state version: ${String(candidate.version)}`);
        }
        if (!Array.isArray(candidate.queues)) {
            throw new Error("Invalid production state: queues must be an array");
        }
        if (typeof candidate.buildSpeedModifier !== "number" ||
            !Number.isFinite(candidate.buildSpeedModifier) || candidate.buildSpeedModifier < 0) {
            throw new Error("Invalid production state: buildSpeedModifier");
        }
        const veteranFactoryTypes = normalizeVeteranFactoryTypes(candidate.veteranFactoryTypes);

        const extensionTarget = {
            stolenTech: new Set<number | SideId>(),
            permanentFactoryOwnerPlans: new Set<string>(),
            reverseEngineeredPlans: new Set<string>(),
        };
        restoreAresProductionExtensionState(extensionTarget, candidate.extension);

        const queueByType = new Map<QueueType, ProductionQueue>();
        for (const queue of this.getAllQueues()) queueByType.set(queue.type, queue);
        const plans: Array<{ queue: ProductionQueue; plan: QueueRestorePlan }> = [];
        const seenTypes = new Set<QueueType>();
        for (const rawQueue of candidate.queues) {
            if (typeof rawQueue !== "object" || rawQueue === null) {
                throw new Error("Invalid production state: queue must be an object");
            }
            const type = (rawQueue as { type?: unknown }).type;
            if (!Number.isSafeInteger(type) || !queueByType.has(type as QueueType)) {
                throw new Error(`Invalid production state: unknown queue type ${String(type)}`);
            }
            if (seenTypes.has(type as QueueType)) {
                throw new Error(`Invalid production state: duplicate queue type ${type}`);
            }
            seenTypes.add(type as QueueType);
            const queue = queueByType.get(type as QueueType)!;
            const plan = queue.prepareRestoreState(rawQueue, {
                ...context,
                resolveRules: context.resolveRules ?? ((name) => this.resolveRulesForQueue(type as QueueType, name)),
            });
            plans.push({ queue, plan });
        }
        if (seenTypes.size !== queueByType.size) {
            throw new Error("Invalid production state: queue set is incomplete");
        }

        // Commit point: all extension and queue state is now validated and
        // all authored rules have been resolved (in strict mode).
        for (const { queue, plan } of plans) queue.applyRestorePlan(plan);
        this.buildSpeedModifier = candidate.buildSpeedModifier as number;
        this.veteranTypes.clear();
        for (const type of veteranFactoryTypes) this.veteranTypes.add(type);
        this.replaceExtensionState(extensionTarget);
        for (const { queue } of plans) queue.notifyUpdated();
    }
    restoreState(state: unknown): void {
        if (!this.stolenTech) {
            this.stolenTech = new Set();
        }
        if (!this.permanentFactoryOwnerPlans) {
            this.permanentFactoryOwnerPlans = new Set();
        }
        if (!this.reverseEngineeredPlans) {
            this.reverseEngineeredPlans = new Set();
        }
        restoreAresProductionExtensionState({
            stolenTech: this.stolenTech,
            permanentFactoryOwnerPlans: this.permanentFactoryOwnerPlans,
            reverseEngineeredPlans: this.reverseEngineeredPlans,
        }, state);
    }
    /** Hashes all future-affecting production state in stable queue order. */
    getHash(): number {
        const state = this.serializeState();
        const veteranFactoryTypes = this.getVeteranFactoryTypes();
        const stolenTech = state.stolenTechs
            .map(value => `${typeof value === "number" ? "number" : "side"}:${value}`);
        const hashParts: (string | number)[] = [
            "production-extension-state",
            "stolen-tech",
            ...stolenTech,
            "permanent-factory-owner-plans",
            ...state.permanentFactoryOwnerPlans,
            "reverse-engineered-plans",
            ...state.reverseEngineeredPlans,
            "build-speed-modifier",
            this.buildSpeedModifier,
            "veteran-factory-types",
            veteranFactoryTypes.length,
            ...veteranFactoryTypes,
            "queues",
        ];
        // Some extension-only callers construct a prototype-shaped Production
        // with just the Ares sets; keep that narrow compatibility boundary
        // hashable while real productions always carry their queue map.
        for (const queue of (this.queues ? this.getAllQueues() : []).slice().sort((a, b) => a.type - b.type)) {
            hashParts.push(queue.getHash());
        }
        return fnv32aStrings(hashParts);
    }
    debugGetState(): {
        stolenTechs: Array<number | SideId>;
        permanentFactoryOwnerPlans: string[];
        reverseEngineeredPlans: string[];
    } {
        const state = this.serializeState();
        return {
            stolenTechs: [...state.stolenTechs],
            permanentFactoryOwnerPlans: [...state.permanentFactoryOwnerPlans],
            reverseEngineeredPlans: [...state.reverseEngineeredPlans],
        };
    }
    dispose() {
        this.queues.clear();
        this.stolenTech.clear();
        this.permanentFactoryOwnerPlans.clear();
        this.reverseEngineeredPlans.clear();
        this.player = undefined;
    }

    private replaceExtensionState(state: {
        stolenTech: Set<number | SideId>;
        permanentFactoryOwnerPlans: Set<string>;
        reverseEngineeredPlans: Set<string>;
    }): void {
        this.stolenTech.clear();
        for (const value of state.stolenTech) this.stolenTech.add(value);
        this.permanentFactoryOwnerPlans.clear();
        for (const value of state.permanentFactoryOwnerPlans) this.permanentFactoryOwnerPlans.add(value);
        this.reverseEngineeredPlans.clear();
        for (const value of state.reverseEngineeredPlans) this.reverseEngineeredPlans.add(value);
    }

    private getVeteranFactoryTypes(): FactoryType[] {
        return [...(this.veteranTypes ?? [])]
            .map((type) => {
                if (!isFactoryType(type)) {
                    throw new Error(`Invalid veteran factory type ${String(type)}`);
                }
                return type;
            })
            .sort((a, b) => a - b);
    }

    private resolveRulesForQueue(type: QueueType, name: string): unknown {
        const objectType = type === QueueType.Structures || type === QueueType.Armory
            ? ObjectType.Building
            : type === QueueType.Infantry
                ? ObjectType.Infantry
                : type === QueueType.Vehicles || type === QueueType.Ships
                    ? ObjectType.Vehicle
                    : ObjectType.Aircraft;
        try {
            return this.rules?.getObject?.(name, objectType);
        }
        catch {
            const rulesMap = objectType === ObjectType.Building
                ? this.rules?.buildingRules
                : objectType === ObjectType.Infantry
                    ? this.rules?.infantryRules
                    : objectType === ObjectType.Vehicle
                        ? this.rules?.vehicleRules
                        : this.rules?.aircraftRules;
            return rulesMap?.get?.(name);
        }
    }
}

function isFactoryType(value: unknown): value is FactoryType {
    return Number.isSafeInteger(value) &&
        (value as number) >= FactoryType.None &&
        (value as number) <= FactoryType.AircraftType;
}

function normalizeVeteranFactoryTypes(value: unknown): FactoryType[] {
    if (!Array.isArray(value)) {
        throw new Error("Invalid production state: veteranFactoryTypes must be an array");
    }
    const types = value.map((entry, index) => {
        if (!isFactoryType(entry)) {
            throw new Error(`Invalid production state: veteranFactoryTypes[${index}]`);
        }
        return entry;
    });
    if (new Set(types).size !== types.length) {
        throw new Error("Invalid production state: duplicate veteran factory type");
    }
    return types.sort((a, b) => a - b);
}
