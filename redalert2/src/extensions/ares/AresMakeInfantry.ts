import { ObjectType } from "@/engine/type/ObjectType";
import { Coords } from "@/game/Coords";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { EventType } from "@/game/event/EventType";
import { getDeathAnim } from "@/game/gameobject/infantry/sequenceMap";
import { InfDeathType } from "@/game/gameobject/infantry/InfDeathType";
import { getZoneType, ZoneType } from "@/game/gameobject/unit/ZoneType";
import { MovementZone } from "@/game/type/MovementZone";
import { isLaserFenceActive, isLaserFenceArt, isLaserFencePost } from "@/extensions/ares/AresLaserFences";
import { fnv32aStrings } from "@/util/math";

export enum MakeInfantryOwner {
    Invoker = "invoker",
    Killer = "killer",
    Victim = "victim",
    Neutral = "neutral",
    Random = "random",
}

export type MakeInfantryOwnerKind = MakeInfantryOwner;

export interface MakeInfantryAnimationSection {
    getNumber(key: string, defaultValue?: number): number;
    getString(key: string, defaultValue?: string): string | undefined;
    getBool?(key: string, defaultValue?: boolean): boolean;
}

export interface MakeInfantryAnimationDefinition {
    name: string;
    makeInfantry: number;
    makeInfantryOwner: MakeInfantryOwner;
    next?: string;
    rate: number;
    start: number;
    end: number;
    loopStart: number;
    loopEnd: number;
    loopCount: number;
    reverse: boolean;
}

export interface MakeInfantryAnimationChain {
    initialName: string;
    names: string[];
    terminalName: string;
    terminal?: MakeInfantryAnimationDefinition;
    makeInfantry: number;
    makeInfantryOwner: MakeInfantryOwner;
    valid: boolean;
    cycle: boolean;
}

function integer(value: number, fallback: number): number {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function numberOr(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function nextAnimationName(value: unknown): string | undefined {
    const next = typeof value === "string" ? value.trim() : "";
    return next && !["none", "<none>", "0"].includes(next.toLocaleLowerCase("en-US"))
        ? next
        : undefined;
}

function authoredBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === "boolean") return value;
    if (value === 1) return true;
    if (typeof value === "string") {
        const normalized = value.trim().toLocaleLowerCase("en-US");
        if (["yes", "true", "1", "on"].includes(normalized)) return true;
        if (["no", "false", "0", "off"].includes(normalized)) return false;
    }
    return fallback;
}

export function parseMakeInfantryOwner(value: unknown): MakeInfantryOwner {
    const normalized = String(value ?? "").trim().toLocaleLowerCase("en-US");
    switch (normalized) {
        case "killer":
            return MakeInfantryOwner.Killer;
        case "victim":
            return MakeInfantryOwner.Victim;
        case "neutral":
            return MakeInfantryOwner.Neutral;
        case "random":
            return MakeInfantryOwner.Random;
        case "invoker":
        default:
            return MakeInfantryOwner.Invoker;
    }
}

export function parseMakeInfantryAnimation(
    name: string,
    section: MakeInfantryAnimationSection | undefined,
): MakeInfantryAnimationDefinition {
    const start = Math.max(0, integer(section?.getNumber("Start", 0) ?? 0, 0));
    const authoredEnd = integer(section?.getNumber("End", start) ?? start, start);
    const end = Math.max(start, authoredEnd);
    const loopStart = Math.max(start, integer(section?.getNumber("LoopStart", start) ?? start, start));
    const authoredLoopEnd = integer(
        section?.getNumber("LoopEnd", end + 1) ?? end + 1,
        end + 1,
    ) - 1;
    const loopEnd = Math.max(loopStart, authoredLoopEnd);
    const next = nextAnimationName(section?.getString("Next", ""));
    const reverse = section?.getBool
        ? section.getBool("Reverse", false)
        : authoredBoolean(section?.getString("Reverse", ""), false);
    return {
        name,
        makeInfantry: integer(section?.getNumber("MakeInfantry", -1) ?? -1, -1),
        makeInfantryOwner: parseMakeInfantryOwner(section?.getString("MakeInfantryOwner", "")),
        ...(next ? { next } : {}),
        rate: Math.max(0, numberOr(section?.getNumber("Rate", 60 * 15), 60 * 15) / 60),
        start,
        end,
        loopStart,
        loopEnd,
        loopCount: integer(section?.getNumber("LoopCount", 1) ?? 1, 1),
        reverse,
    };
}

function definitionFromObject(value: any, name: string): MakeInfantryAnimationDefinition | undefined {
    if (!value) return undefined;
    if (typeof value.getNumber === "function" || typeof value.getString === "function") {
        return parseMakeInfantryAnimation(name, value);
    }
    const section = typeof value.art?.getNumber === "function" || typeof value.art?.getString === "function"
        ? parseMakeInfantryAnimation(name, value.art)
        : undefined;
    const start = integer(value.start ?? section?.start ?? 0, 0);
    const end = Math.max(start, integer(value.end ?? section?.end ?? start, start));
    const loopStart = Math.max(start, integer(value.loopStart ?? section?.loopStart ?? start, start));
    const loopEnd = Math.max(loopStart, integer(value.loopEnd ?? section?.loopEnd ?? end, end));
    const next = nextAnimationName(
        typeof value.next === "string"
            ? value.next
            : typeof value.nextAnimation === "string"
                ? value.nextAnimation
                : section?.next,
    );
    return {
        name,
        makeInfantry: integer(value.makeInfantry ?? value.makeInfantryIndex ?? section?.makeInfantry ?? -1, -1),
        makeInfantryOwner: parseMakeInfantryOwner(value.makeInfantryOwner ?? section?.makeInfantryOwner),
        ...(next ? { next } : {}),
        rate: Math.max(0, numberOr(value.rate ?? section?.rate, 15)),
        start,
        end,
        loopStart,
        loopEnd,
        loopCount: integer(value.loopCount ?? section?.loopCount ?? 1, 1),
        reverse: authoredBoolean(value.reverse, section?.reverse ?? false),
    };
}

export type MakeInfantryAnimationResolver = (
    name: string,
) => MakeInfantryAnimationDefinition | { [key: string]: any } | undefined;

export function resolveMakeInfantryAnimationChain(
    initialName: string,
    resolveAnimation: MakeInfantryAnimationResolver,
): MakeInfantryAnimationChain {
    const names: string[] = [];
    const seen = new Set<string>();
    const initial = String(initialName ?? "").trim();
    let initialDefinition: MakeInfantryAnimationDefinition | undefined;
    let lastDefinition: MakeInfantryAnimationDefinition | undefined;
    let current = initial;
    let cycle = false;
    while (current) {
        if (seen.has(current)) {
            cycle = true;
            break;
        }
        seen.add(current);
        const resolved = definitionFromObject(resolveAnimation(current), current);
        if (!resolved) {
            break;
        }
        names.push(current);
        lastDefinition = resolved;
        if (names.length === 1) initialDefinition = resolved;
        if (!resolved.next) {
            const terminal = resolved;
            return {
                initialName: initial,
                names,
                terminalName: current,
                terminal,
                makeInfantry: terminal.makeInfantry,
                makeInfantryOwner: names.length === 1
                    ? terminal.makeInfantryOwner
                    : initialDefinition?.makeInfantryOwner ?? MakeInfantryOwner.Invoker,
                valid: true,
                cycle: false,
            };
        }
        current = resolved.next;
    }
    const terminalName = names.length ? names[names.length - 1] : initial;
    const terminal = lastDefinition;
    return {
        initialName: initial,
        names,
        terminalName,
        terminal,
        makeInfantry: terminal?.makeInfantry ?? -1,
        makeInfantryOwner: initialDefinition?.makeInfantryOwner ?? MakeInfantryOwner.Invoker,
        valid: !cycle && names.length > 0 && !!terminal && !terminal.next,
        cycle,
    };
}

export const getMakeInfantryAnimationChain = resolveMakeInfantryAnimationChain;

export type MakeInfantryOwnerContextKind = "infDeathAnim" | "deathAnims" | "trigger";

export interface MakeInfantryOwnerContext {
    kind: MakeInfantryOwnerContextKind | string;
    invoker?: any;
    killer?: any;
    victim?: any;
        triggerOwner?: any;
    neutral?: any;
    players?: readonly any[];
    getAllPlayers?: () => readonly any[];
    randomInt?: (min: number, max: number) => number;
}

function playerReference(value: any): any {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "object") return value;
    if (value.player !== undefined && value.player !== null) return value.player;
    if (value.owner !== undefined && value.owner !== null && typeof value.owner === "object") {
        return value.owner;
    }
    return value;
}

function normalizedKind(value: unknown): MakeInfantryOwnerContextKind {
    const kind = String(value ?? "").replace(/[^a-z]/gi, "").toLocaleLowerCase("en-US");
    if (kind === "deathanims" || kind === "deathanim") return "deathAnims";
    if (kind === "trigger" || kind === "triggeraction" || kind === "playanimat") return "trigger";
    return "infDeathAnim";
}

function isNeutralPlayer(player: any): boolean {
    return player?.isNeutral === true || player?.neutral === true;
}

function contextPlayers(context: MakeInfantryOwnerContext): any[] {
    const players = context.players ?? context.getAllPlayers?.() ?? [];
    return players.filter((player) => player !== undefined && player !== null);
}

function contextNeutral(context: MakeInfantryOwnerContext, players: any[]): any {
    return playerReference(context.neutral) ??
        players.find((player) => isNeutralPlayer(player)) ??
        players.find((player) => player?.isCivilian === true);
}

export function selectMakeInfantryOwner(
    selector: MakeInfantryOwner | string,
    context: MakeInfantryOwnerContext,
): any {
    const kind = normalizedKind(context.kind);
    const owner = parseMakeInfantryOwner(selector);
    const players = contextPlayers(context);
    const triggerOwner = playerReference(context.triggerOwner);
    const killer = playerReference(context.killer);
    const victim = playerReference(context.victim);
    const invoker = playerReference(context.invoker);
    if (owner === MakeInfantryOwner.Neutral) {
        return contextNeutral(context, players);
    }
    if (owner === MakeInfantryOwner.Random) {
        if (!players.length) return undefined;
        const selected = context.randomInt
            ? context.randomInt(0, players.length - 1)
            : 0;
        return players[Math.max(0, Math.min(players.length - 1, integer(selected, 0)))];
    }
    if (kind === "trigger") {
        return triggerOwner ?? invoker ?? killer ?? victim;
    }
    if (owner === MakeInfantryOwner.Invoker) {
        return kind === "deathAnims" ? victim : killer;
    }
    if (owner === MakeInfantryOwner.Killer) {
        return killer;
    }
    return victim;
}

export const resolveMakeInfantryOwner = selectMakeInfantryOwner;

export const MAKE_INFANTRY_RUNTIME_STATE_VERSION = 2 as const;

export interface AresMakeInfantryPendingState {
    readonly id: number;
    readonly chain: string[];
    readonly chainIndex: number;
    readonly frame: number;
    readonly loopNumber: number;
    readonly frameAccumulator: number;
    readonly productIndex: number;
    readonly productName?: string;
    readonly tileRx: number;
    readonly tileRy: number;
    readonly tileZ: number;
    readonly onBridge: boolean;
    readonly context: string;
    readonly ownerPlayerIndex?: number;
    readonly ownerName?: string;
    readonly killerPlayerIndex?: number;
    readonly killerObjectId?: number;
    readonly victimObjectId?: number;
    readonly sourcePlayerIndex?: number;
    readonly victimDestroyedByService: boolean;
    readonly startedAtTick: number;
}

export interface AresMakeInfantryRuntimeState {
    readonly version: typeof MAKE_INFANTRY_RUNTIME_STATE_VERSION;
    readonly nextId: number;
    readonly pending: AresMakeInfantryPendingState[];
}

export interface AresMakeInfantryRestoreContext {
    strict?: boolean;
    resolveAnimation?(name: string): MakeInfantryAnimationDefinition | undefined;
    resolveProduct?(index: number, name?: string): any;
    resolveTile?(rx: number, ry: number): any;
    resolvePlayerByIndex?(index: number): any;
    resolvePlayerByName?(name: string): any;
    resolveObjectById?(id: number): any;
}

export interface AresMakeInfantryRuntimeHost {
    isOwnerValid?(owner: any, pending: AresMakeInfantryPendingState): boolean;
    isKillerValid?(killer: any, pending: AresMakeInfantryPendingState): boolean;
    isKillerObjectValid?(killerObject: any, pending: AresMakeInfantryPendingState): boolean;
    isSourceOwnerValid?(sourcePlayer: any, pending: AresMakeInfantryPendingState): boolean;
    isVictimValid?(victim: any, pending: AresMakeInfantryPendingState): boolean;
    isSpawnTileAvailable?(tile: any, product: any, pending: AresMakeInfantryPendingState): boolean;
    createProduct?(product: any, owner: any, tile: any, pending: AresMakeInfantryPendingState): any;
    discardPreparedProduct?(product: any, pending: AresMakeInfantryPendingState): void;
    spawnPreparedProduct?(product: any, tile: any, pending: AresMakeInfantryPendingState): void;
    killVictim?(victim: any, pending: AresMakeInfantryPendingState): boolean | void;
    startAnimation?(pending: AresMakeInfantryPendingState): void;
    cancelAnimation?(pending: AresMakeInfantryPendingState): void;
    discardAnimation?(pending: AresMakeInfantryPendingState): void;
    spawnProduct?(product: any, owner: any, tile: any, pending: AresMakeInfantryPendingState): void;
}

export interface AresMakeInfantrySpawnRequest {
    definitions: MakeInfantryAnimationDefinition[];
    tile: any;
    productIndex: number;
    productName?: string;
    product?: any;
        onBridge?: boolean;
    owner: any;
    killer?: any;
    killerObject?: any;
    victim?: any;
    sourcePlayer?: any;
    context: string;
    startedAtTick?: number;
    victimDestroyedByService?: boolean;
}

interface RuntimeInstance {
    id: number;
    definitions: MakeInfantryAnimationDefinition[];
    chainIndex: number;
    frame: number;
    loopNumber: number;
    frameAccumulator: number;
    productIndex: number;
    productName?: string;
    tile: any;
    onBridge: boolean;
    context: string;
    owner?: any;
    killer?: any;
    killerObject?: any;
    victim?: any;
    sourcePlayer?: any;
    product?: any;
    victimDestroyedByService: boolean;
    startedAtTick: number;
    getPlayerIndex?: (player: any) => number | undefined;
}

function isIdentity(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function optionalIdentity(value: unknown, label: string): number | undefined {
    if (value === undefined) return undefined;
    if (!isIdentity(value)) throw new Error(`Invalid Ares MakeInfantry state: ${label}`);
    return value;
}

function optionalName(value: unknown, label: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new Error(`Invalid Ares MakeInfantry state: ${label}`);
    return value;
}

function tileValues(tile: any): { rx: number; ry: number; z: number } {
    return {
        rx: integer(tile?.rx ?? -1, -1),
        ry: integer(tile?.ry ?? -1, -1),
        z: numberOr(tile?.z, 0),
    };
}

function defaultOwnerValid(owner: any): boolean {
    return owner !== undefined && owner !== null &&
        owner.defeated !== true && owner.resigned !== true && owner.dropped !== true;
}

function defaultObjectValid(value: any): boolean {
    return value === undefined || value === null ||
        (value.isDestroyed !== true && value.isDisposed !== true &&
            value.defeated !== true && value.resigned !== true && value.dropped !== true);
}

function bridgeOnTile(map: any, tile: any): any {
    return map?.tileOccupation?.getBridgeOnTile?.(tile) ?? map?.getBridgeOnTile?.(tile);
}

function objectsOnTile(map: any, tile: any): any[] {
    return map?.tileOccupation?.getObjectsOnTile?.(tile) ?? map?.getObjectsOnTile?.(tile) ?? [];
}

function isAirPlacementUnit(unit: any): boolean {
    return unit?.isAircraft === true ||
        (typeof unit?.isAircraft === "function" && unit.isAircraft() === true) ||
        unit?.rules?.movementZone === MovementZone.Fly ||
        unit?.zone === ZoneType.Air;
}

function placeMakeInfantryUnit(
    unit: any,
    tile: any,
    map: any,
    onBridge: boolean,
    defaultFlightLevel: any = 0,
): void {
    if (!unit || !tile) return;
    const bridge = onBridge ? bridgeOnTile(map, tile) : undefined;
    const air = isAirPlacementUnit(unit);
    unit.onBridge = onBridge;
    if (unit.position) {
        unit.position.tileElevation = air
            ? unit.rules?.flightLevel ?? defaultFlightLevel ?? 0
            : onBridge ? bridge?.tileElevation ?? 0 : 0;
    }
    const landType = onBridge
        ? tile.onBridgeLandType ?? bridge?.rules?.land
        : tile.landType;
    unit.zone = air ? ZoneType.Air : getZoneType(landType);
}

function makeInfantryUnitIsInfantry(unit: any): boolean {
    if (typeof unit?.isInfantry === "function") return unit.isInfantry() === true;
    if (typeof unit?.isInfantry === "boolean") return unit.isInfantry;
    if (unit?.type !== undefined || unit?.rules?.type !== undefined) {
        return unit.type === ObjectType.Infantry || unit.rules?.type === ObjectType.Infantry;
    }
    return true;
}

function makeInfantryUnitSpeedType(unit: any): any {
    return unit?.rules?.speedType ?? unit?.speedType;
}

function makeInfantryObstacleObject(value: any): any {
    return value?.obj ?? value;
}

function makeInfantryObstacleBlocks(value: any, ignoredObject: any): boolean {
    const object = makeInfantryObstacleObject(value);
    if (!object || object === ignoredObject || object.isDestroyed || object.isDisposed) return false;
    if (isLaserFenceArt(object) && !isLaserFencePost(object)) return isLaserFenceActive(object);
    return object.rules?.gate !== true;
}

function makeInfantryObstacleUnit(unit: any, isInfantry: boolean, onBridge: boolean, speedType: any): any {
    if (typeof unit?.isInfantry === "function" && unit.position?.desiredSubCell !== undefined) return unit;
    return {
        ...(unit ?? {}),
        rules: unit?.rules ?? { speedType },
        isInfantry: () => isInfantry,
        position: unit?.position ?? { desiredSubCell: 0 },
        onBridge,
    };
}

function validateMakeInfantryPlacement(
    tile: any,
    map: any,
    unit: any,
    ignoredObject: any,
    onBridge: boolean,
): boolean {
    if (!tile || !map) return false;
    const terrain = map.terrain;
    const objects = objectsOnTile(map, tile);
    if (objects.some((object: any) =>
         object && !object.isDestroyed && !object.isDisposed &&
         isLaserFenceArt(object) && !isLaserFencePost(object) && isLaserFenceActive(object))) {
         return false;
     }
    const isInfantry = makeInfantryUnitIsInfantry(unit);
    const speedType = makeInfantryUnitSpeedType(unit);
    if (terrain?.getPassableSpeed && speedType !== undefined) {
        const speed = ignoredObject
            ? terrain.getPassableSpeed(tile, speedType, isInfantry, onBridge, [ignoredObject])
            : terrain.getPassableSpeed(tile, speedType, isInfantry, onBridge);
        if (speed <= 0) return false;
    }
    if (terrain?.findObstacles) {
        const bridge = onBridge ? bridgeOnTile(map, tile) ?? { tileElevation: 0 } : undefined;
        const obstacleUnit = makeInfantryObstacleUnit(unit, isInfantry, onBridge, speedType);
        const obstacles = terrain.findObstacles({ tile, onBridge: bridge }, obstacleUnit);
        if (Array.isArray(obstacles) && obstacles.some((obstacle: any) => makeInfantryObstacleBlocks(obstacle, ignoredObject))) {
            return false;
        }
        return true;
    }
    return !objects.some((object: any) => {
         if (!object || object === ignoredObject || object.isDestroyed || object.isDisposed) return false;
         if (isLaserFenceArt(object) && !isLaserFencePost(object)) return isLaserFenceActive(object);
         if (object.rules?.gate === true || object.isSmudge?.()) return false;
         if (object.isTerrain?.()) return !isInfantry;
         if (object.isOverlay?.()) {
             const bridge = object.isBridge === true ||
                 (typeof object.isBridge === "function" && object.isBridge() === true);
             const tiberium = object.isTiberium === true ||
                 (typeof object.isTiberium === "function" && object.isTiberium() === true);
             const placeholder = object.isBridgePlaceholder === true ||
                 (typeof object.isBridgePlaceholder === "function" && object.isBridgePlaceholder() === true);
             return !(bridge || tiberium || placeholder);
         }
         if (object.isUnit?.() && (object.onBridge === true) !== onBridge) return false;
         return true;
     });
}

function stateOf(instance: RuntimeInstance, getPlayerIndex?: (player: any) => number | undefined): AresMakeInfantryPendingState {
    const coords = tileValues(instance.tile);
    const ownerIndex = instance.owner === undefined || instance.owner === null
        ? undefined
        : getPlayerIndex?.(instance.owner);
    const killerIndex = instance.killer === undefined || instance.killer === null
        ? undefined
        : getPlayerIndex?.(instance.killer);
    const sourceIndex = instance.sourcePlayer === undefined || instance.sourcePlayer === null
        ? undefined
        : getPlayerIndex?.(instance.sourcePlayer);
    const ownerFallback = instance.owner === undefined || instance.owner === null
        ? undefined
        : getPlayerIndex
            ? "unresolved"
            : String(instance.owner.name ?? instance.owner.id ?? "");
    return {
        id: instance.id,
        chain: instance.definitions.map((definition) => definition.name),
        chainIndex: instance.chainIndex,
        frame: instance.frame,
        loopNumber: instance.loopNumber,
        frameAccumulator: instance.frameAccumulator,
        productIndex: instance.productIndex,
        ...(instance.productName !== undefined ? { productName: instance.productName } : {}),
        tileRx: coords.rx,
        tileRy: coords.ry,
        tileZ: coords.z,
        onBridge: instance.onBridge,
        context: instance.context,
        ...(isIdentity(ownerIndex)
            ? { ownerPlayerIndex: ownerIndex }
            : ownerFallback !== undefined
                ? { ownerName: ownerFallback }
                : {}),
        ...(isIdentity(killerIndex) ? { killerPlayerIndex: killerIndex } : {}),
        ...(isIdentity(instance.killerObject?.id) ? { killerObjectId: instance.killerObject.id } : {}),
        ...(isIdentity(instance.victim?.id) ? { victimObjectId: instance.victim.id } : {}),
        ...(isIdentity(sourceIndex) ? { sourcePlayerIndex: sourceIndex } : {}),
        victimDestroyedByService: instance.victimDestroyedByService,
        startedAtTick: instance.startedAtTick,
    };
}

export class AresMakeInfantryRuntime {
    private nextId = 1;
    private readonly instances = new Map<number, RuntimeInstance>();
    private readonly getPlayerIndex?: (player: any) => number | undefined;

    constructor(options: { getPlayerIndex?(player: any): number | undefined } = {}) {
        this.getPlayerIndex = options.getPlayerIndex;
    }

    spawn(request: AresMakeInfantrySpawnRequest, host: AresMakeInfantryRuntimeHost = {}): AresMakeInfantryPendingState | undefined {
        if (!request.definitions?.length || request.definitions.some((definition) => !definition)) return undefined;
        const terminal = request.definitions[request.definitions.length - 1];
        if (terminal.makeInfantry !== request.productIndex || request.productIndex < 0) return undefined;
        if (request.owner === undefined || request.owner === null || !defaultOwnerValid(request.owner)) return undefined;
        const victimInvalid = request.victim !== undefined && request.victim !== null &&
            (request.victim.isDestroyed === true || request.victim.isDisposed === true ||
                request.victim.isSpawned === false);
        if (victimInvalid) return undefined;
        const first = request.definitions[0];
        const instance: RuntimeInstance = {
            id: this.nextId++,
            definitions: request.definitions.slice(),
            chainIndex: 0,
            frame: first.reverse ? first.end : first.start,
            loopNumber: 0,
            frameAccumulator: 0,
            productIndex: request.productIndex,
            ...(request.productName !== undefined ? { productName: request.productName } : {}),
            tile: request.tile,
            onBridge: request.onBridge === true || (request.onBridge === undefined && request.victim?.onBridge === true),
            context: String(request.context ?? ""),
            owner: request.owner,
            killer: request.killer,
            killerObject: request.killerObject ?? (request.killer?.id !== undefined ? request.killer : undefined),
            victim: request.victim,
            sourcePlayer: request.sourcePlayer,
            product: request.product,
            victimDestroyedByService: request.victimDestroyedByService ?? !!host.killVictim,
            startedAtTick: Math.max(0, integer(request.startedAtTick ?? 0, 0)),
            getPlayerIndex: this.getPlayerIndex,
        };
        this.instances.set(instance.id, instance);
        if (request.victim !== undefined && request.victim !== null) {
            if (host.killVictim) {
                try {
                    const result = host.killVictim(request.victim, stateOf(instance, this.getPlayerIndex));
                    if (result === false) instance.victimDestroyedByService = request.victimDestroyedByService ?? false;
                }
                catch (error) {
                    this.instances.delete(instance.id);
                    throw error;
                }
            }
            if (!this.instances.has(instance.id)) return undefined;
        }
        host.startAnimation?.(stateOf(instance, this.getPlayerIndex));
        return stateOf(instance, this.getPlayerIndex);
    }

    update(host: AresMakeInfantryRuntimeHost = {}): void {
        for (const instance of [...this.instances.values()].sort((a, b) => a.id - b.id)) {
            if (!this.instances.has(instance.id)) continue;
            const pending = stateOf(instance, this.getPlayerIndex);
            const ownerValid = host.isOwnerValid
                ? host.isOwnerValid(instance.owner, pending)
                : defaultOwnerValid(instance.owner);
            const killerValid = host.isKillerValid
                ? host.isKillerValid(instance.killer, pending)
                : defaultObjectValid(instance.killer);
            const killerObjectValid = host.isKillerObjectValid
                ? host.isKillerObjectValid(instance.killerObject, pending)
                : defaultObjectValid(instance.killerObject);
            const sourceOwnerValid = host.isSourceOwnerValid
                ? host.isSourceOwnerValid(instance.sourcePlayer, pending)
                : instance.sourcePlayer === undefined || instance.sourcePlayer === null || defaultOwnerValid(instance.sourcePlayer);
            const victimValid = host.isVictimValid
                ? host.isVictimValid(instance.victim, pending)
                : instance.victim === undefined || instance.victim === null
                    ? true
                    : instance.victimDestroyedByService
                        ? true
                        : defaultObjectValid(instance.victim) && instance.victim.isSpawned !== false;
            if (!ownerValid || !killerValid || !killerObjectValid || !sourceOwnerValid || !victimValid) {
                this.cancel(instance.id, host);
                continue;
            }
            const definition = instance.definitions[instance.chainIndex];
            const rate = Math.max(0, definition.rate) / 15;
            instance.frameAccumulator += rate;
            const framesToAdvance = Math.floor(instance.frameAccumulator);
            instance.frameAccumulator -= framesToAdvance;
            let finished = false;
            for (let frame = 0; frame < framesToAdvance; frame++) {
                const result = this.advanceFrame(instance);
                if (result === "next") continue;
                if (instance.chainIndex < instance.definitions.length - 1) {
                    instance.chainIndex++;
                    const next = instance.definitions[instance.chainIndex];
                    instance.frame = next.reverse ? next.end : next.start;
                    instance.loopNumber = 0;
                    instance.frameAccumulator = 0;
                    continue;
                }
                finished = true;
                break;
            }
            if (!finished) continue;
            const finalState = stateOf(instance, this.getPlayerIndex);
            const hasPreparedProduct = typeof host.createProduct === "function";
            const preparedProduct = hasPreparedProduct
                ? host.createProduct(instance.product, instance.owner, instance.tile, finalState)
                : undefined;
            const productForValidation = hasPreparedProduct ? preparedProduct : instance.product;
            const available = !hasPreparedProduct || preparedProduct !== undefined
                ? host.isSpawnTileAvailable
                    ? host.isSpawnTileAvailable(instance.tile, productForValidation, finalState)
                    : true
                : false;
            if (!available) {
                if (hasPreparedProduct && preparedProduct !== undefined) {
                    host.discardPreparedProduct?.(preparedProduct, finalState);
                }
                this.discard(instance.id, host);
                continue;
            }
            this.instances.delete(instance.id);
            if (hasPreparedProduct) {
                if (host.spawnPreparedProduct) {
                    host.spawnPreparedProduct(preparedProduct, instance.tile, finalState);
                }
                else {
                    host.spawnProduct?.(preparedProduct, instance.owner, instance.tile, finalState);
                }
            }
            else {
                host.spawnProduct?.(instance.product, instance.owner, instance.tile, finalState);
            }
            host.cancelAnimation?.(finalState);
        }
    }

    cancel(id: number, host: AresMakeInfantryRuntimeHost = {}): boolean {
        const instance = this.instances.get(id);
        if (!instance) return false;
        this.instances.delete(id);
        host.cancelAnimation?.(stateOf(instance, this.getPlayerIndex));
        return true;
    }

    discard(id: number, host: AresMakeInfantryRuntimeHost = {}): boolean {
        const instance = this.instances.get(id);
        if (!instance) return false;
        this.instances.delete(id);
        const state = stateOf(instance, this.getPlayerIndex);
        host.discardAnimation?.(state);
        host.cancelAnimation?.(state);
        return true;
    }

    cancelForOwner(owner: any, host: AresMakeInfantryRuntimeHost = {}): number {
        let count = 0;
        for (const instance of [...this.instances.values()]) {
            if (instance.owner === owner || instance.killer === owner || instance.killerObject?.owner === owner || instance.sourcePlayer === owner) {
                if (this.cancel(instance.id, host)) count++;
            }
        }
        return count;
    }

    cancelForObject(object: any, host: AresMakeInfantryRuntimeHost = {}): number {
        let count = 0;
        for (const instance of [...this.instances.values()]) {
            if (instance.victim === object || instance.killer === object || instance.killerObject === object) {
                if (this.cancel(instance.id, host)) count++;
            }
        }
        return count;
    }

    handleObjectDestroyed(object: any, host: AresMakeInfantryRuntimeHost = {}): number {
        let count = 0;
        for (const instance of [...this.instances.values()]) {
            const victimInvalid = instance.victim === object && !instance.victimDestroyedByService;
            const killerInvalid = instance.killer === object || instance.killerObject === object;
            if ((victimInvalid || killerInvalid) && this.cancel(instance.id, host)) count++;
        }
        return count;
    }

    getPendingCount(): number {
        return this.instances.size;
    }

    getPending(id: number): AresMakeInfantryPendingState | undefined {
        const instance = this.instances.get(id);
        return instance ? stateOf(instance, this.getPlayerIndex) : undefined;
    }

    getPendingStates(): AresMakeInfantryPendingState[] {
        return [...this.instances.values()]
            .sort((a, b) => a.id - b.id)
            .map((instance) => stateOf(instance, this.getPlayerIndex));
    }

    getHash(): number {
        const parts: (string | number)[] = ["AresMakeInfantryRuntime", this.nextId];
        for (const state of this.getPendingStates()) {
            parts.push(
                state.id,
                state.chain.join(","),
                state.chainIndex,
                state.frame,
                state.loopNumber,
                state.frameAccumulator,
                state.productIndex,
                state.productName ?? "",
                state.tileRx,
                state.tileRy,
                state.tileZ,
                state.onBridge ? 1 : 0,
                state.context,
                state.ownerPlayerIndex ?? -1,
                state.ownerName ?? "",
                state.killerPlayerIndex ?? -1,
                state.killerObjectId ?? -1,
                state.victimObjectId ?? -1,
                state.sourcePlayerIndex ?? -1,
                state.victimDestroyedByService ? 1 : 0,
                state.startedAtTick,
            );
        }
        return fnv32aStrings(parts);
    }

    captureState(): AresMakeInfantryRuntimeState {
        return {
            version: MAKE_INFANTRY_RUNTIME_STATE_VERSION,
            nextId: this.nextId,
            pending: this.getPendingStates(),
        };
    }

    validateState(state: unknown, context: AresMakeInfantryRestoreContext = {}): void {
        this.prepareRestoreState(state, context);
    }

    restoreState(state: unknown, context: AresMakeInfantryRestoreContext = {}): void {
        const prepared = this.prepareRestoreState(state, context);
        this.instances.clear();
        for (const instance of prepared.instances) this.instances.set(instance.id, instance);
        this.nextId = prepared.nextId;
    }

    clear(host: AresMakeInfantryRuntimeHost = {}): void {
        for (const id of [...this.instances.keys()]) this.cancel(id, host);
    }

    private advanceFrame(instance: RuntimeInstance): "next" | "complete" {
        const definition = instance.definitions[instance.chainIndex];
        const step = definition.reverse ? -1 : 1;
        const target = definition.reverse
            ? instance.loopNumber === 0 ? definition.start : definition.loopStart
            : instance.loopNumber === 0 ? definition.end : definition.loopEnd;
        const next = instance.frame + step;
        if (definition.reverse ? next > target : next < target) {
            instance.frame = next;
            return "next";
        }
        if (definition.loopCount === -1 || instance.loopNumber < definition.loopCount - 1) {
            instance.loopNumber++;
            instance.frame = definition.reverse ? definition.loopEnd : definition.loopStart;
            return "next";
        }
        instance.frame = target;
        return "complete";
    }

    private prepareRestoreState(
        state: unknown,
        context: AresMakeInfantryRestoreContext,
    ): { nextId: number; instances: RuntimeInstance[] } {
        if (!state || typeof state !== "object") {
            throw new Error("Invalid Ares MakeInfantry runtime state: expected an object");
        }
        const candidate = state as Record<string, any>;
        if (candidate.version !== MAKE_INFANTRY_RUNTIME_STATE_VERSION) {
            throw new Error(`Unsupported Ares MakeInfantry runtime state version: ${String(candidate.version)}`);
        }
        if (!Number.isSafeInteger(candidate.nextId) || candidate.nextId < 1) {
            throw new Error("Invalid Ares MakeInfantry runtime state: nextId");
        }
        if (!Array.isArray(candidate.pending)) {
            throw new Error("Invalid Ares MakeInfantry runtime state: pending must be an array");
        }
        const seen = new Set<number>();
        const instances: RuntimeInstance[] = [];
        for (const raw of candidate.pending) {
            if (!raw || typeof raw !== "object") {
                throw new Error("Invalid Ares MakeInfantry runtime state: pending entry");
            }
            if (!isIdentity(raw.id) || raw.id < 1 || raw.id >= candidate.nextId) {
                throw new Error("Invalid Ares MakeInfantry runtime state: pending id");
            }
            if (seen.has(raw.id)) {
                throw new Error(`Invalid Ares MakeInfantry runtime state: duplicate pending id ${raw.id}`);
            }
            seen.add(raw.id);
            if (!Array.isArray(raw.chain) || !raw.chain.length || raw.chain.some((name: unknown) => typeof name !== "string" || !name)) {
                throw new Error("Invalid Ares MakeInfantry runtime state: chain");
            }
            if (!Number.isSafeInteger(raw.chainIndex) || raw.chainIndex < 0 || raw.chainIndex >= raw.chain.length) {
                throw new Error("Invalid Ares MakeInfantry runtime state: chainIndex");
            }
            if (!Number.isSafeInteger(raw.frame) || raw.frame < 0 ||
                !Number.isSafeInteger(raw.loopNumber) || raw.loopNumber < 0 ||
                typeof raw.frameAccumulator !== "number" || !Number.isFinite(raw.frameAccumulator) || raw.frameAccumulator < 0) {
                throw new Error("Invalid Ares MakeInfantry runtime state: animation state");
            }
            if (!Number.isSafeInteger(raw.productIndex) || raw.productIndex < 0) {
                throw new Error("Invalid Ares MakeInfantry runtime state: productIndex");
            }
             if (!Number.isSafeInteger(raw.tileRx) || !Number.isSafeInteger(raw.tileRy) ||
                 typeof raw.tileZ !== "number" || !Number.isFinite(raw.tileZ)) {
                 throw new Error("Invalid Ares MakeInfantry runtime state: tile");
             }
             if (typeof raw.context !== "string") {
                 throw new Error("Invalid Ares MakeInfantry runtime state: context");
             }
             if (typeof raw.onBridge !== "boolean") {
                 throw new Error("Invalid Ares MakeInfantry runtime state: onBridge");
             }
             const productName = optionalName(raw.productName, "productName");
            if (typeof raw.victimDestroyedByService !== "boolean" ||
                !Number.isSafeInteger(raw.startedAtTick) || raw.startedAtTick < 0) {
                throw new Error("Invalid Ares MakeInfantry runtime state: lifecycle state");
            }
            const ownerIndex = optionalIdentity(raw.ownerPlayerIndex, "ownerPlayerIndex");
            const ownerName = optionalName(raw.ownerName, "ownerName");
            const killerIndex = optionalIdentity(raw.killerPlayerIndex, "killerPlayerIndex");
            const killerId = optionalIdentity(raw.killerObjectId, "killerObjectId");
            const victimId = optionalIdentity(raw.victimObjectId, "victimObjectId");
            const sourceIndex = optionalIdentity(raw.sourcePlayerIndex, "sourcePlayerIndex");
            const definitions: MakeInfantryAnimationDefinition[] = [];
            let terminalResolved = true;
            for (const [index, name] of (raw.chain as string[]).entries()) {
                const resolved = context.resolveAnimation?.(name);
                if (context.strict && !resolved) {
                    throw new Error(`Cannot restore Ares MakeInfantry animation ${name}: unresolved`);
                }
                if (!resolved && index === raw.chain.length - 1) {
                    terminalResolved = false;
                    const fallback = parseMakeInfantryAnimation(name, undefined);
                    fallback.makeInfantry = raw.productIndex;
                    definitions.push(fallback);
                }
                else {
                    definitions.push(resolved ?? parseMakeInfantryAnimation(name, undefined));
                }
            }
            if (terminalResolved && definitions[definitions.length - 1].makeInfantry !== raw.productIndex) {
                throw new Error("Invalid Ares MakeInfantry runtime state: terminal product mismatch");
            }
            const owner = ownerIndex === undefined
                ? ownerName === undefined ? undefined : context.resolvePlayerByName?.(ownerName)
                : context.resolvePlayerByIndex?.(ownerIndex);
            const sourcePlayer = sourceIndex === undefined ? undefined : context.resolvePlayerByIndex?.(sourceIndex);
            const killerPlayer = killerIndex === undefined ? undefined : context.resolvePlayerByIndex?.(killerIndex);
            const killerObject = killerId === undefined ? undefined : context.resolveObjectById?.(killerId);
            const killer = killerPlayer ?? playerReference(killerObject);
            const victim = victimId === undefined ? undefined : context.resolveObjectById?.(victimId);
            const resolvedTile = context.resolveTile?.(raw.tileRx, raw.tileRy);
            const tile = resolvedTile ?? { rx: raw.tileRx, ry: raw.tileRy, z: raw.tileZ };
            const product = context.resolveProduct?.(raw.productIndex, productName);
            if (context.strict) {
                if (ownerIndex !== undefined && !owner) throw new Error(`Cannot restore Ares MakeInfantry owner ${ownerIndex}: unresolved`);
                if (ownerName !== undefined && !owner) throw new Error(`Cannot restore Ares MakeInfantry owner ${ownerName}: unresolved`);
                if (killerIndex !== undefined && !killerPlayer) throw new Error(`Cannot restore Ares MakeInfantry killer ${killerIndex}: unresolved`);
                if (killerId !== undefined && !killerObject) throw new Error(`Cannot restore Ares MakeInfantry killer object ${killerId}: unresolved`);
                if (sourceIndex !== undefined && !sourcePlayer) throw new Error(`Cannot restore Ares MakeInfantry source ${sourceIndex}: unresolved`);
                if (victimId !== undefined && !victim && !raw.victimDestroyedByService) throw new Error(`Cannot restore Ares MakeInfantry victim ${victimId}: unresolved`);
                if (raw.tileRx < 0 || raw.tileRy < 0 || !resolvedTile) {
                    throw new Error(`Cannot restore Ares MakeInfantry tile ${raw.tileRx},${raw.tileRy}: unresolved`);
                }
                if (context.resolveProduct && !product) throw new Error(`Cannot restore Ares MakeInfantry product ${raw.productIndex}: unresolved`);
            }
            instances.push({
                id: raw.id,
              definitions,
                chainIndex: raw.chainIndex,
                frame: raw.frame,
                loopNumber: raw.loopNumber,
                frameAccumulator: raw.frameAccumulator,
                productIndex: raw.productIndex,
               productName,
                 tile,
                 onBridge: raw.onBridge,
                 context: raw.context,
              owner,
                killer,
                killerObject,
                victim,
                sourcePlayer,
              product,
                victimDestroyedByService: raw.victimDestroyedByService,
                startedAtTick: raw.startedAtTick,
                getPlayerIndex: this.getPlayerIndex,
        });
        }
        return { nextId: candidate.nextId, instances };
    }
}

export interface AresMakeInfantryServiceOptions {
    getPlayerIndex?(player: any): number | undefined;
    resolveAnimation?(name: string): MakeInfantryAnimationDefinition | undefined;
    resolveProduct?(index: number, name?: string): any;
    isSpawnTileAvailable?(tile: any, product: any, pending: AresMakeInfantryPendingState): boolean;
}

export class AresMakeInfantryService {
    readonly runtime: AresMakeInfantryRuntime;
    private readonly game: any;
    private readonly options: AresMakeInfantryServiceOptions;
    private readonly subscriptions: any[] = [];

    constructor(game: any, options: AresMakeInfantryServiceOptions = {}) {
        this.game = game;
        this.options = options;
        this.runtime = new AresMakeInfantryRuntime({
            getPlayerIndex: options.getPlayerIndex ?? ((player: any) => {
                const players = game?.playerList?.getAll?.() ?? [];
                const index = players.indexOf(player);
                return index === -1 ? undefined : index;
            }),
        });
        const cancelForOwnerEvent = (event: any) => {
            if (event?.target) this.runtime.cancelForOwner(event.target, this.runtimeHost());
        };
        for (const eventType of [EventType.PlayerDefeated, EventType.PlayerResigned, EventType.PlayerDropped]) {
            const subscription = game?.events?.subscribe?.(eventType, cancelForOwnerEvent);
            if (subscription) this.subscriptions.push(subscription);
        }
        const destroyed = game?.events?.subscribe?.(EventType.ObjectDestroy, (event: any) => {
            if (event?.target) this.runtime.handleObjectDestroyed(event.target, this.runtimeHost());
        });
        if (destroyed) this.subscriptions.push(destroyed);
    }

    getHash(): number {
        return this.runtime.getHash();
    }

    captureState(): AresMakeInfantryRuntimeState {
        return this.runtime.captureState();
    }

    validateState(state: unknown, context: AresMakeInfantryRestoreContext = {}): void {
        this.runtime.validateState(state, this.restoreContext(context));
    }

    restoreState(state: unknown, context: AresMakeInfantryRestoreContext = {}): void {
        this.runtime.restoreState(state, this.restoreContext(context));
    }

    handleTriggerAnimation(event: any): boolean {
        if (!event || event.mutationId !== undefined) return false;
        const chain = this.resolveChain(event.name);
        if (!chain?.valid || chain.makeInfantry < 0) return false;
        const triggerOwner = event.triggerOwner;
        if (triggerOwner === undefined || triggerOwner === null) return false;
        const owner = selectMakeInfantryOwner(chain.makeInfantryOwner, {
            kind: "trigger",
            triggerOwner,
            invoker: triggerOwner,
            killer: triggerOwner,
            victim: triggerOwner,
            getAllPlayers: () => this.game?.getAllPlayers?.() ?? this.game?.playerList?.getAll?.() ?? [],
            randomInt: (min, max) => this.game?.generateRandomInt?.(min, max) ?? min,
        });
        if (!owner) return false;
        const pending = this.startMutation({
            animationName: event.name,
            tile: event.tile,
            owner,
            context: "trigger",
             triggerOwner,
             sourcePlayer: triggerOwner,
             onBridge: false,
             dispatchVisual: false,
            startedAtTick: this.game?.currentTick,
        });
        if (!pending) return false;
        event.mutationId = pending.id;
        event.mutationOwner = owner;
        event.mutationContext = "trigger";
        event.useUnitPalette = true;
        event.animationChain = chain.names;
        return true;
    }

    startInfDeathAnimation(
        victim: any,
        animationName: string,
        killer?: any,
        sourcePlayer?: any,
        sourceObject?: any,
    ): AresMakeInfantryPendingState | undefined {
        const killerPlayer = playerReference(killer?.player ?? killer?.owner ?? killer) ?? playerReference(sourcePlayer);
        return this.startMutation({
            animationName,
            tile: victim?.tile,
            victim,
            killer: killerPlayer,
            sourcePlayer: playerReference(sourcePlayer) ?? killerPlayer,
             sourceObject,
             onBridge: victim?.onBridge === true,
             context: "infDeathAnim",
             ownerContext: {
                kind: "infDeathAnim",
                invoker: playerReference(sourcePlayer) ?? killerPlayer,
                killer: killerPlayer,
                victim: victim?.owner,
            },
            startedAtTick: this.game?.currentTick,
        });
    }

    startDeathAnims(
        victim: any,
        animationName: string,
        killer?: any,
        sourcePlayer?: any,
        sourceObject?: any,
    ): AresMakeInfantryPendingState | undefined {
        const killerPlayer = playerReference(killer?.player ?? killer?.owner ?? killer) ?? playerReference(sourcePlayer);
        return this.startMutation({
            animationName,
            tile: victim?.tile,
            victim,
            killer: killerPlayer,
            sourcePlayer: playerReference(sourcePlayer) ?? killerPlayer,
             sourceObject,
             onBridge: victim?.onBridge === true,
             context: "deathAnims",
             ownerContext: {
                kind: "deathAnims",
                invoker: victim?.owner,
                killer: killerPlayer,
                victim: victim?.owner,
            },
            startedAtTick: this.game?.currentTick,
        });
    }

    startFromObjectDeath(victim: any, killer?: any): AresMakeInfantryPendingState | undefined {
        if (!victim || victim.aresMakeInfantryServiceHandling) return undefined;
        if (victim.isDestroyed || victim.isDisposed || victim.isSpawned === false || !victim.isInfantry?.()) return undefined;
        const warhead = killer?.warhead ?? killer?.weapon?.warhead;
        const explicit = warhead?.rules?.infDeathAnim ?? killer?.infDeathAnim;
        if (explicit) {
            return this.startInfDeathAnimation(victim, explicit, killer?.obj ?? killer, killer?.player, killer?.obj);
        }
        const deathAnims = victim.rules?.deathAnims;
        const deathType = integer(victim.infDeathType ?? InfDeathType.None, InfDeathType.None);
        const deathAnimation = this.deathAnimationFromList(deathAnims, deathType);
        if (deathAnimation) {
            return this.startDeathAnims(victim, deathAnimation, killer?.obj ?? killer, killer?.player, killer?.obj);
        }
        if (deathType === InfDeathType.Virus || deathType === InfDeathType.Mutate || deathType === InfDeathType.Brute) {
            const animation = getDeathAnim({
                audioVisual: this.game?.rules?.audioVisual ?? {},
                animationNames: [],
            }, deathType);
            if (animation) {
                return this.startInfDeathAnimation(victim, animation, killer?.obj ?? killer, killer?.player, killer?.obj);
            }
        }
        return undefined;
    }

    update(): void {
        this.runtime.update(this.runtimeHost());
    }

    cancelForOwner(owner: any): number {
        return this.runtime.cancelForOwner(owner, this.runtimeHost());
    }

    cancelForObject(object: any): number {
        return this.runtime.cancelForObject(object, this.runtimeHost());
    }

    dispose(): void {
        for (const subscription of this.subscriptions) {
            if (typeof subscription === "function") subscription();
            else subscription?.dispose?.();
        }
        this.subscriptions.length = 0;
        this.runtime.clear(this.runtimeHost());
    }

    private startMutation(request: {
        animationName: string;
        tile: any;
        victim?: any;
        owner?: any;
        killer?: any;
        sourcePlayer?: any;
        sourceObject?: any;
        triggerOwner?: any;
        onBridge?: boolean;
        context: string;
        ownerContext?: MakeInfantryOwnerContext;
        dispatchVisual?: boolean;
        startedAtTick?: number;
    }): AresMakeInfantryPendingState | undefined {
        const chain = this.resolveChain(request.animationName);
        if (!chain?.valid || chain.makeInfantry < 0) return undefined;
        const product = this.resolveProduct(chain.makeInfantry);
        if (product === undefined || product === null) return undefined;
        const productName = product?.name ?? this.game?.rules?.general?.animToInfantry?.[chain.makeInfantry];
        const owner = request.owner ?? selectMakeInfantryOwner(chain.makeInfantryOwner, {
            ...(request.ownerContext ?? { kind: request.context }),
            getAllPlayers: () => this.game?.getAllPlayers?.() ?? this.game?.playerList?.getAll?.() ?? [],
            randomInt: (min, max) => this.game?.generateRandomInt?.(min, max) ?? min,
        });
        if (!owner || (request.victim && !this.isEligibleVictim(request.victim))) return undefined;
        const onBridge = request.onBridge === true ||
            (request.onBridge === undefined && (request.context === "trigger" ? false : request.victim?.onBridge === true));
        const definitions = chain.names.map((name) => this.resolveDefinition(name)).filter(Boolean) as MakeInfantryAnimationDefinition[];
        if (definitions.length !== chain.names.length) return undefined;
        const host = this.runtimeHost(request.killer, request.sourcePlayer, request.sourceObject);
        const pending = this.runtime.spawn({
             definitions,
            tile: request.tile,
            productIndex: chain.makeInfantry,
             productName,
             product,
            onBridge,
            owner,
            killer: request.killer,
            killerObject: request.sourceObject,
            victim: request.victim,
            sourcePlayer: request.sourcePlayer,
            context: request.context,
            startedAtTick: request.startedAtTick,
        }, {
            ...host,
            startAnimation: (state) => {
                if (request.dispatchVisual !== false) this.dispatchAnimation(request, state, owner, chain);
            },
            killVictim: host.killVictim,
        });
        if (request.victim && !pending?.victimDestroyedByService) {
            if (pending) this.runtime.cancel(pending.id, host);
            return undefined;
        }
        return pending;
    }

    private resolveChain(name: string): MakeInfantryAnimationChain | undefined {
        if (!name) return undefined;
        return resolveMakeInfantryAnimationChain(name, (animationName) => this.resolveDefinition(animationName));
    }

    private resolveDefinition(name: string): MakeInfantryAnimationDefinition | undefined {
        try {
            const value = this.options.resolveAnimation
                ? this.options.resolveAnimation(name)
                : this.game?.art?.getAnimation?.(name);
            return value ? definitionFromObject(value, name) : undefined;
        } catch {
            return undefined;
        }
    }

    private resolveProduct(index: number, name?: string): any {
        if (this.options.resolveProduct) return this.options.resolveProduct(index, name);
        const list = this.game?.rules?.general?.animToInfantry ?? [];
        const productName = name ?? list[index];
        if (!productName) return undefined;
        try {
            return this.game?.rules?.getObject?.(productName, ObjectType.Infantry);
        } catch {
            return undefined;
        }
    }

    private runtimeHost(killer?: any, sourcePlayer?: any, sourceObject?: any): AresMakeInfantryRuntimeHost {
        return {
            isOwnerValid: (owner) => defaultOwnerValid(owner),
            isKillerValid: (value) => value === undefined || value === null ||
                (defaultObjectValid(value) && defaultOwnerValid(playerReference(value))),
            isKillerObjectValid: (value) => defaultObjectValid(value),
            isSourceOwnerValid: (sourcePlayer) => sourcePlayer === undefined || sourcePlayer === null || defaultOwnerValid(sourcePlayer),
            isVictimValid: (victim, pending) => {
                if (victim === undefined || victim === null) return true;
                if (pending.victimDestroyedByService) {
                    return true;
                }
                return defaultObjectValid(victim) && victim.isSpawned !== false;
            },
             isSpawnTileAvailable: (tile, product, pending) => this.options.isSpawnTileAvailable?.(tile, product, pending) ??
                 this.isSpawnTileAvailable(tile, product, pending),
             createProduct: (product, owner, tile, pending) => {
                 if (!product || !owner || !tile) return undefined;
                 const unit = this.game?.createUnitForPlayer?.(product, owner);
                 if (unit) placeMakeInfantryUnit(
                     unit,
                     tile,
                     this.game?.map,
                     pending.onBridge,
                     this.game?.rules?.general?.flightLevel,
                 );
                 return unit;
             },
             discardPreparedProduct: (unit) => this.discardPreparedUnit(unit),
             spawnPreparedProduct: (unit, tile) => {
                 if (unit && tile) this.game?.spawnObject?.(unit, tile);
             },
             killVictim: (victim) => {
                victim.aresMakeInfantryServiceHandling = true;
                victim.aresMakeInfantryAnimationHandled = true;
                try {
                    this.game?.destroyObject?.(victim, {
                        player: playerReference(sourcePlayer) ?? playerReference(killer),
                        obj: sourceObject,
                    }, true);
                } finally {
                    delete victim.aresMakeInfantryServiceHandling;
                }
                return victim.isDestroyed === true || victim.isDisposed === true;
             },
             spawnProduct: (product, owner, tile, pending) => {
                 if (!product || !owner || !tile) return;
                 const unit = this.game?.createUnitForPlayer?.(product, owner);
                 if (!unit) return;
                 placeMakeInfantryUnit(
                     unit,
                     tile,
                     this.game?.map,
                     pending.onBridge,
                     this.game?.rules?.general?.flightLevel,
                 );
                 this.game?.spawnObject?.(unit, tile);
             },
         };
    }

    private discardPreparedUnit(unit: any): void {
        if (!unit || unit.isDisposed === true) return;
        if (unit.isSpawned === true) {
            this.game?.unspawnObject?.(unit);
            return;
        }
        try {
            unit.owner?.removeOwnedObject?.(unit);
        }
        catch {
        }
        unit.dispose?.();
    }

    private isEligibleVictim(victim: any): boolean {
        if (!victim || victim.isDestroyed || victim.isDisposed || victim.isSpawned === false || !victim.isInfantry?.()) return false;
        if (victim.rules?.missileSpawn) return false;
        return true;
    }

     private isSpawnTileAvailable(tile: any, unit: any, pending: AresMakeInfantryPendingState): boolean {
         const onBridge = typeof unit?.onBridge === "boolean" ? unit.onBridge : pending.onBridge;
         return isMakeInfantrySpawnTileAvailable(tile, this.game?.map, unit, undefined, onBridge);
     }

    private dispatchAnimation(
        request: {
            animationName: string;
            tile: any;
            victim?: any;
            sourcePlayer?: any;
         sourceObject?: any;
        context: string;
        },
        pending: AresMakeInfantryPendingState,
        owner: any,
        chain: MakeInfantryAnimationChain,
    ): void {
        const tile = request.tile;
        if (request.victim) {
            request.victim.aresMakeInfantryAnimationHandled = true;
        }
        const position = request.victim?.position?.worldPosition?.clone?.() ??
            request.victim?.position?.worldPosition ??
            (tile ? Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z ?? 0) : undefined);
        const event = new TriggerAnimEvent(
            request.animationName,
            tile,
            position,
            request.sourcePlayer,
            request.sourceObject,
            owner,
            true,
            pending.id,
            request.context,
            chain.names,
        );
        this.game?.events?.dispatch?.(event);
    }

    private deathAnimationFromList(value: any, deathType: number): string | undefined {
        if (Array.isArray(value)) return value[deathType] ?? (value.length === 1 ? value[0] : undefined);
        if (typeof value === "string") return value;
        if (value && typeof value === "object") {
            const direct = value[deathType] ?? value[String(deathType)];
            if (typeof direct === "string") return direct;
            const values = Object.values(value).filter((entry): entry is string => typeof entry === "string");
            return values.length === 1 ? values[0] : undefined;
        }
        return undefined;
    }

    private restoreContext(context: AresMakeInfantryRestoreContext): AresMakeInfantryRestoreContext {
        return {
            ...context,
            resolveAnimation: context.resolveAnimation ?? ((name) => this.resolveDefinition(name)),
            resolveProduct: context.resolveProduct ?? ((index, name) => this.resolveProduct(index, name)),
            resolveTile: context.resolveTile ?? ((rx, ry) => this.game?.map?.tiles?.getByMapCoords?.(rx, ry)),
            resolvePlayerByIndex: context.resolvePlayerByIndex ?? ((index) => this.game?.playerList?.getAll?.()?.[index]),
            resolvePlayerByName: context.resolvePlayerByName ?? ((name) => this.game?.getPlayerByName?.(name)),
            resolveObjectById: context.resolveObjectById ?? ((id) => this.game?.getObjectById?.(id)),
        };
    }
}

export function isMakeInfantrySpawnTileAvailable(
    tile: any,
    map: any,
    unit?: any,
    ignoredObjectOrOnBridge?: any,
    onBridge?: boolean,
): boolean {
    let ignoredObject = ignoredObjectOrOnBridge;
    let placementOnBridge = onBridge === true;
     if (typeof ignoredObjectOrOnBridge === "boolean") {
         placementOnBridge = ignoredObjectOrOnBridge;
         ignoredObject = undefined;
     }
     else if (onBridge === undefined) {
         placementOnBridge = unit?.onBridge === true;
     }
    return validateMakeInfantryPlacement(
        tile,
        map,
        unit,
        ignoredObject,
        placementOnBridge,
    );
}

export const MakeInfantryRuntime = AresMakeInfantryRuntime;
export const MakeInfantryService = AresMakeInfantryService;
