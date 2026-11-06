import { Color } from '@/util/Color';
import { ObjectType } from '@/engine/type/ObjectType';
import { Traits } from '@/game/Traits';
import { fnv32aStrings } from '@/util/math';
import { Country } from '@/game/Country';
import type { Production } from '@/game/player/production/Production';
interface PlayerOwnedObject {
    id: string;
    name: string;
    type: ObjectType;
    owner: Player;
    buildLimit: number;
    rules?: any;
    limboData?: any;
    isDestroyed?: boolean;
    isDisposed?: boolean;
    aresVehicleHijackerTrait?: any;
}

export interface PlayerBuildLimitState {
    version: 1;
    limitedUnitsBuiltByFamily: Record<string, number>;
}
export class Player {
    private _credits: number = 0;
    public readonly name: string;
    /**
     * Canonical identity: index in the deterministic PlayerList order,
     * assigned by PlayerList.addPlayer. -1 while unregistered. This is the
     * only safe cross-snapshot/hashing foreign key for a player; display
     * names are not unique.
     */
    public playerListIndex: number = -1;
    public readonly country?: Country;
    public readonly startLocation: any;
    public startLocationPoint?: { x: number; y: number };
    public houseName?: string;
    public houseIndex?: number;
    public mapHouse?: any;
    public techLevel?: number;
    public productionEnabled: boolean = true;
    public aiTriggersEnabled: boolean = true;
    public readonly color: Color;
    public isAi: boolean = false;
    public defeated: boolean = false;
    public resigned: boolean = false;
    public dropped: boolean = false;
    private objectsByType: Map<ObjectType, Set<PlayerOwnedObject>> = new Map();
    private objectsById: Map<string, PlayerOwnedObject> = new Map();
    public readonly traits: Traits = new Traits();
    public score: number = 0;
    private limitedUnitsBuiltByName: Map<string, number> = new Map();
    private buildLimitFamilyResolver?: (value: any) => string[];
    private unitsBuiltByType: Map<ObjectType, number> = new Map();
    private unitsKilledByType: Map<ObjectType, number> = new Map();
    private unitsLostByType: Map<ObjectType, number> = new Map();
    public buildingsCaptured: number = 0;
    public cratesPickedUp: number = 0;
    public cheerCooldownTicks: number = 0;
    public readonly isObserver: boolean;
    public readonly isNeutral: boolean;
    public aiDifficulty?: any;
    public customBotId?: string;
    /** Ares Firestorm handler state; kept on the owner for deterministic wall queries. */
    public aresFirestormActive: boolean = false;
    public powerTrait?: any;
    public radarTrait?: any;
    public superWeaponsTrait?: any;
    public sharedDetectDisguiseTrait?: any;
    public production?: Production;
    get credits(): number {
        return this._credits;
    }
    set credits(value: number) {
        if (value < 0) {
            throw new RangeError("Can't set credits to a negative value");
        }
        this._credits = value;
    }
    constructor(name: string, country?: Country, startLocation?: any, color: Color = new Color(255, 0, 0), forceCombatant: boolean = false) {
        this.name = name;
        this.country = country;
        this.startLocation = startLocation;
        this.color = color;
        this.isObserver = !country;
        this.isNeutral = !!country && !country.isPlayable() && !forceCombatant;
    }
    getOrCreateObjectsForType(type: ObjectType): Set<PlayerOwnedObject> {
        let objects = this.objectsByType.get(type);
        if (!objects) {
            objects = new Set();
            this.objectsByType.set(type, objects);
        }
        return objects;
    }
    addOwnedObject(object: PlayerOwnedObject): void {
        const objects = this.getOrCreateObjectsForType(object.type);
        objects.add(object);
        object.owner = this;
        this.objectsById.set(object.id, object);
    }
    removeOwnedObject(object: PlayerOwnedObject): void {
        const objects = this.objectsByType.get(object.type);
        if (!objects || !objects.has(object)) {
            throw new Error(`GameObject ${object.name} does not belong to player ${this.name}`);
        }
        objects.delete(object);
        this.objectsById.delete(object.id);
    }
    getOwnedObjectById(id: string): PlayerOwnedObject | undefined {
        return this.objectsById.get(id);
    }
    getOwnedObjectsByType(type: ObjectType, includeLimbo: boolean = false): PlayerOwnedObject[] {
        let objects = [...(this.objectsByType.get(type) || new Set())];
        if (!includeLimbo) {
            objects = objects.filter(obj => !obj.limboData);
        }
        return objects;
    }
    getOwnedObjects(includeLimbo: boolean = false): PlayerOwnedObject[] {
        let objects: PlayerOwnedObject[] = [];
        [...this.objectsByType.values()].forEach(set => {
            set.forEach(obj => objects.push(obj));
        });
        if (!includeLimbo) {
            objects = objects.filter(obj => !obj.limboData);
        }
        return objects;
    }
    removeAllOwnedObjects(): void {
        this.objectsByType.forEach(set => set.clear());
        this.objectsById.clear();
    }
    get buildings(): Set<PlayerOwnedObject> {
        return this.getOrCreateObjectsForType(ObjectType.Building);
    }
    setBuildLimitFamilyResolver(resolver: (value: any) => string[]): void {
        this.buildLimitFamilyResolver = resolver;
    }
    getBuildLimitFamily(objectOrName: any): string[] {
        const name = typeof objectOrName === "string"
            ? objectOrName
            : objectOrName?.name ?? objectOrName?.rules?.name;
        if (!name) return [];
        const family = this.buildLimitFamilyResolver?.(objectOrName) ?? [name];
        return [...new Set(family
            .filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
            .map(entry => entry.trim().toLocaleLowerCase("en-US")))]
            .sort();
    }
    private getBuildLimitFamilyKey(objectOrName: any): string {
        return this.getBuildLimitFamily(objectOrName).join("|") ||
            String(objectOrName).trim().toLocaleLowerCase("en-US");
    }
    getBuildLimitCount(objectOrName: any): number {
        const family = new Set(this.getBuildLimitFamily(objectOrName));
        if (!family.size) return 0;
        const owned = typeof this.getOwnedObjects === "function"
            ? this.getOwnedObjects(true)
            : [];
        const counted = new Set<any>();
        let count = 0;
        for (const object of owned) {
            const name = String(object?.name ?? object?.rules?.name ?? "").toLocaleLowerCase("en-US");
            if (family.has(name) && !object?.isDestroyed && !object?.isDisposed) {
                counted.add(object);
                count++;
            }
        }
        for (const object of owned) {
            const hijacker = object?.aresVehicleHijackerTrait?.getHijacker?.();
            const name = String(hijacker?.name ?? hijacker?.rules?.name ?? "").toLocaleLowerCase("en-US");
            if (hijacker && !counted.has(hijacker) && family.has(name) &&
                !hijacker.isDestroyed && !hijacker.isDisposed) {
                counted.add(hijacker);
                count++;
            }
        }
        return count;
    }
    captureBuildLimitState(): PlayerBuildLimitState {
        return {
            version: 1,
            limitedUnitsBuiltByFamily: Object.fromEntries(
                [...this.limitedUnitsBuiltByName.entries()].sort(([a], [b]) => a.localeCompare(b)),
            ),
        };
    }
    validateBuildLimitState(state: unknown): PlayerBuildLimitState {
        if (!state || typeof state !== "object") {
            throw new Error("Invalid player BuildLimit state");
        }
        const candidate = state as Partial<PlayerBuildLimitState>;
        if (candidate.version !== 1 || !candidate.limitedUnitsBuiltByFamily ||
            typeof candidate.limitedUnitsBuiltByFamily !== "object" || Array.isArray(candidate.limitedUnitsBuiltByFamily)) {
            throw new Error("Invalid player BuildLimit state");
        }
        const normalized: Record<string, number> = {};
        for (const [family, count] of Object.entries(candidate.limitedUnitsBuiltByFamily)) {
            if (!family || !Number.isSafeInteger(count) || (count as number) < 0) {
                throw new Error("Invalid player BuildLimit history");
            }
            normalized[family] = count as number;
        }
        return { version: 1, limitedUnitsBuiltByFamily: normalized };
    }
    restoreBuildLimitState(state: unknown): void {
        const validated = this.validateBuildLimitState(state);
        this.limitedUnitsBuiltByName.clear();
        for (const [family, count] of Object.entries(validated.limitedUnitsBuiltByFamily)) {
            this.limitedUnitsBuiltByName.set(family, count);
        }
    }
    addUnitsBuilt(object: PlayerOwnedObject, count: number): void {
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new RangeError("Units-built count must be a non-negative integer");
        }
        this.unitsBuiltByType.set(object.type, (this.unitsBuiltByType.get(object.type) ?? 0) + count);
        const buildLimit = object.buildLimit ?? object.rules?.buildLimit;
        if (typeof buildLimit === "number" && buildLimit < 0) {
            const family = this.getBuildLimitFamilyKey(object);
            this.limitedUnitsBuiltByName.set(family, (this.limitedUnitsBuiltByName.get(family) ?? 0) + count);
        }
    }
    getUnitsBuilt(type?: ObjectType): number {
        if (type !== undefined) {
            return this.unitsBuiltByType.get(type) ?? 0;
        }
        return [...this.unitsBuiltByType.values()].reduce((sum, count) => sum + count, 0);
    }
    getLimitedUnitsBuilt(name: string): number {
        return this.limitedUnitsBuiltByName.get(this.getBuildLimitFamilyKey(name)) ?? 0;
    }
    addUnitsKilled(type: ObjectType, count: number): void {
        this.unitsKilledByType.set(type, (this.unitsKilledByType.get(type) ?? 0) + count);
    }
    getUnitsKilled(type?: ObjectType): number {
        if (type !== undefined) {
            return this.unitsKilledByType.get(type) ?? 0;
        }
        return [...this.unitsKilledByType.values()].reduce((sum, count) => sum + count, 0);
    }
    addUnitsLost(type: ObjectType, count: number): void {
        this.unitsLostByType.set(type, (this.unitsLostByType.get(type) ?? 0) + count);
    }
    getUnitsLost(type?: ObjectType): number {
        if (type !== undefined) {
            return this.unitsLostByType.get(type) ?? 0;
        }
        return [...this.unitsLostByType.values()].reduce((sum, count) => sum + count, 0);
    }
    restoreUnitsBuiltState(type: number, count: number): void {
        if (!Number.isSafeInteger(type) || !Number.isSafeInteger(count) || count < 0) {
            throw new Error("Invalid units-built state");
        }
        if (count === 0) {
            this.unitsBuiltByType.delete(type as ObjectType);
        }
        else {
            this.unitsBuiltByType.set(type as ObjectType, count);
        }
    }
    restoreUnitsKilledState(type: number, count: number): void {
        if (!Number.isSafeInteger(type) || !Number.isSafeInteger(count) || count < 0) {
            throw new Error("Invalid units-killed state");
        }
        if (count === 0) {
            this.unitsKilledByType.delete(type as ObjectType);
        }
        else {
            this.unitsKilledByType.set(type as ObjectType, count);
        }
    }
    restoreUnitsLostState(type: number, count: number): void {
        if (!Number.isSafeInteger(type) || !Number.isSafeInteger(count) || count < 0) {
            throw new Error("Invalid units-lost state");
        }
        if (count === 0) {
            this.unitsLostByType.delete(type as ObjectType);
        }
        else {
            this.unitsLostByType.set(type as ObjectType, count);
        }
    }
    isCombatant(): boolean {
        return !this.isNeutral && !this.isObserver && !this.defeated;
    }
    canProduceVeteran(object: PlayerOwnedObject): boolean {
        if (!this.production || !this.country) {
            throw new Error("Non-combatants can't produce units");
        }
        const queueType = this.production.getQueueTypeForObject(object);
        const factoryType = this.production.getFactoryTypeForQueueType(queueType);
        return (this.production.hasVeteranType(factoryType) ||
            this.country.hasVeteranUnit(object.type, object.name));
    }
    getHash(): number {
        const negativeBuildLimitHistory: (string | number)[] = [
            "negative-build-limit-history",
            this.limitedUnitsBuiltByName.size,
        ];
        for (const [name, count] of [...this.limitedUnitsBuiltByName.entries()]
            .sort(([a], [b]) => a.localeCompare(b))) {
            negativeBuildLimitHistory.push(name, count);
        }
        return fnv32aStrings([
            "player",
            "player-list-index",
            this.playerListIndex,
            this.credits,
            this.country?.id ?? "",
            this.country?.sideId ?? "",
            // Defeat flips isCombatant(), which gates Warhead fear logic,
            // repair-order targeting, and asset redistribution; score breaks
            // the redistribution tie-break. Both change future simulation.
            this.defeated ? 1 : 0,
            this.score,
            this.aresFirestormActive ? 1 : 0,
            ...negativeBuildLimitHistory,
            this.production?.getHash?.() ?? 0,
            // Superweapon readiness/charge timers change future simulation
            // (a ready SW can fire this tick) so they are canonical state.
            this.superWeaponsTrait?.getHash?.() ?? 0,
            ...this.traits.getAll().map(trait => trait.getHash?.() ?? 0),
        ]);
    }
    debugGetState(): Record<string, any> {
        return {
            name: this.name,
            credits: this.credits,
            countryId: this.country?.id,
            sideId: this.country?.sideId,
            aresFirestormActive: this.aresFirestormActive,
            buildLimitState: this.captureBuildLimitState(),
            production: this.production?.debugGetState?.(),
            traits: this.traits.getAll().reduce((acc, trait) => {
                const state = trait.debugGetState?.();
                if (state !== undefined) {
                    acc[trait.constructor.name] = state;
                }
                return acc;
            }, {} as Record<string, any>)
        };
    }
    dispose(): void {
        this.traits.dispose();
        this.production?.dispose();
        this.limitedUnitsBuiltByName.clear();
        this.buildLimitFamilyResolver = undefined;
    }
}
