import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { NotifyOwnerChange } from "@/game/gameobject/trait/interface/NotifyOwnerChange";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { NotifyUnspawn } from "@/game/gameobject/trait/interface/NotifyUnspawn";
import { LandType } from "@/game/type/LandType";
import { ObjectType } from "@/engine/type/ObjectType";
import { EventType } from "@/game/event/EventType";
import { wallTypes } from "@/game/map/wallTypes";
import { fnv32aStrings } from "@/util/math";

export const ARES_LASER_FENCE_STATE_VERSION = 1 as const;
export const ARES_LASER_FENCE_SWEEP_COOLDOWN_TICKS = 1;
export const ARES_LASER_FENCE_TOPOLOGY_COUNT = 16;

const fallbackLaserFenceRuntimes = new WeakMap<object, AresLaserFenceRuntime>();

export interface AresLaserFenceRules {
    laserFencePost: boolean;
    laserFence: boolean;
}

export interface AresLaserFencePostSnapshot {
    objectId: number;
    x: number;
    y: number;
    ownerIndex: number;
    active: boolean;
    connectionMask: number;
    connectedPostIds: number[];
}

export interface AresLaserFenceFenceSnapshot {
    objectId: number;
    x: number;
    y: number;
    ownerIndex: number;
    postIds: number[];
    connectionMask: number;
    active: boolean;
    direction: number;
    artName: string;
}

export interface AresLaserFenceSnapshot {
    version: typeof ARES_LASER_FENCE_STATE_VERSION;
    posts: AresLaserFencePostSnapshot[];
    fences: AresLaserFenceFenceSnapshot[];
    sweepCooldownTicks: number;
    activationGeneration: number;
}

export interface AresLaserFenceTraitState {
    version: typeof ARES_LASER_FENCE_STATE_VERSION;
    role: "post" | "fence";
    objectId: number;
    active: boolean;
    connectionMask: number;
    postIds: number[];
    sweepCooldownTicks: number;
}

interface IniLike {
    getBool?: (key: string, defaultValue?: boolean) => boolean;
    entries?: Map<string, string | string[]> | Record<string, string | string[]>;
}

function readIniBoolean(section: IniLike | undefined, key: string, defaultValue = false): boolean {
    if (!section) return defaultValue;
    if (typeof section.getBool === "function") {
        return section.getBool(key, defaultValue);
    }
    const entries = section.entries;
    const wanted = key.trim().toLocaleLowerCase("en-US");
    const visit = (value: string | string[] | undefined): string | undefined => {
        if (Array.isArray(value)) return value[0];
        return value;
    };
    if (entries instanceof Map) {
        for (const [entryKey, value] of entries) {
            if (entryKey.trim().toLocaleLowerCase("en-US") === wanted) {
                const text = visit(value)?.trim().toLocaleLowerCase("en-US");
                if (!text) return defaultValue;
                if (["yes", "true", "1", "on"].includes(text)) return true;
                if (["no", "false", "0", "off"].includes(text)) return false;
                return defaultValue;
            }
        }
    }
    else if (entries) {
        for (const [entryKey, value] of Object.entries(entries)) {
            if (entryKey.trim().toLocaleLowerCase("en-US") === wanted) {
                const text = visit(value)?.trim().toLocaleLowerCase("en-US");
                if (!text) return defaultValue;
                if (["yes", "true", "1", "on"].includes(text)) return true;
                if (["no", "false", "0", "off"].includes(text)) return false;
                return defaultValue;
            }
        }
    }
    return defaultValue;
}

export function parseAresLaserFenceRules(section: IniLike | undefined): AresLaserFenceRules {
    return {
        laserFencePost: readIniBoolean(section, "LaserFencePost", false),
        laserFence: readIniBoolean(section, "LaserFence", false),
    };
}

export const parseLaserFenceRules = parseAresLaserFenceRules;
export const parseAresLaserFencePost = (section: IniLike | undefined): boolean => readIniBoolean(section, "LaserFencePost", false);
export const parseAresLaserFence = (section: IniLike | undefined): boolean => readIniBoolean(section, "LaserFence", false);

export function parseAresWallTower(value: string | undefined): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    if (!normalized || normalized.toLocaleLowerCase("en-US") === "none") return undefined;
    return normalized;
}

function rulesOf(objectOrRules: any): any {
    return objectOrRules?.rules ?? objectOrRules;
}

export function isLaserFencePost(objectOrRules: any): boolean {
    const rules = rulesOf(objectOrRules);
    return rules?.laserFencePost === true || rules?.ares?.laserFencePost === true;
}

export function isLaserFenceArt(objectOrRules: any): boolean {
    const rules = rulesOf(objectOrRules);
    return rules?.laserFence === true || rules?.ares?.laserFence === true;
}

export const isAresLaserFencePost = isLaserFencePost;
export const isAresLaserFence = isLaserFenceArt;
export const isLaserFenceObject = isLaserFenceArt;

export function isLaserFencePowered(post: any): boolean {
    if (!post || !isLaserFencePost(post)) return false;
    if (post.empTrait?.isUnderEMP?.()) return false;
    if (typeof post.poweredTrait?.isPoweredOn === "function") {
        return post.poweredTrait.isPoweredOn() === true;
    }
    if (post.owner?.powerTrait?.isLowPower?.()) {
        return post.owner.powerTrait.isLowPower() === false;
    }
    if (post.laserFencePowered !== undefined) return post.laserFencePowered === true;
    return post.rules?.powered !== false;
}

export function isLaserFenceActive(object: any): boolean {
    if (!object || !isLaserFenceArt(object) || isLaserFencePost(object)) return false;
    if (typeof object.laserFenceActive === "boolean") return object.laserFenceActive;
    return object.laserFencePowered === true;
}

export const isAresLaserFenceActive = isLaserFenceActive;

export function isLaserFenceDamageInvariant(object: any): boolean {
    return isLaserFenceArt(object) && !isLaserFencePost(object);
}

export const isAresLaserFenceDamageInvariant = isLaserFenceDamageInvariant;

export function getLaserFenceConnectionMask(object: any): number {
    const value = Number(typeof object === "number" ? object : object?.laserFenceConnectionMask);
    return Number.isSafeInteger(value) && value >= 0 && value < ARES_LASER_FENCE_TOPOLOGY_COUNT
        ? value
        : 0;
}

export function getLaserFenceWallType(connectionMask: number): number {
    const normalized = Number(connectionMask);
    const mask = Number.isSafeInteger(normalized) && normalized >= 0 && normalized < ARES_LASER_FENCE_TOPOLOGY_COUNT
        ? normalized
        : 0;
    for (let index = 0; index < wallTypes.length; index++) {
        const candidate = wallTypes[index];
        if (candidate[0] === (mask & 1) &&
            candidate[1] === ((mask >> 1) & 1) &&
            candidate[2] === ((mask >> 2) & 1) &&
            candidate[3] === ((mask >> 3) & 1)) {
            return index;
        }
    }
    return 0;
}

export function getLaserFenceArtFrame(connectionMask: number, active: boolean, frameCount?: number): number {
    const topology = getLaserFenceWallType(connectionMask);
    if (!Number.isFinite(frameCount) || (frameCount as number) < ARES_LASER_FENCE_TOPOLOGY_COUNT) {
        return topology;
    }
    const count = Math.floor(frameCount as number);
    const stateGroupCount = Math.floor(count / (ARES_LASER_FENCE_TOPOLOGY_COUNT * 2));
    if (stateGroupCount <= 0) return topology;
    const group = active ? 0 : stateGroupCount;
    return Math.min(count - 1, group * ARES_LASER_FENCE_TOPOLOGY_COUNT + topology);
}

export function getLaserFenceDirection(connectionMask: number): number {
    const mask = getLaserFenceConnectionMask({ laserFenceConnectionMask: connectionMask });
    return (mask & 0b1010) !== 0 ? 90 : 0;
}

export const getLaserFenceRotation = getLaserFenceDirection;

function objectId(object: any): number | undefined {
    return Number.isSafeInteger(object?.id) && object.id >= 0 ? object.id : undefined;
}

function objectKey(object: any): string {
    const id = objectId(object);
    if (id !== undefined) return `id:${id}`;
    const tile = object?.tile;
    return `name:${String(object?.name ?? object?.rules?.name ?? "")}|tile:${tile?.rx ?? 0},${tile?.ry ?? 0}`;
}

function cellOf(object: any): { x: number; y: number } | undefined {
    const tile = object?.centerTile ?? object?.tile;
    if (!tile || !Number.isSafeInteger(tile.rx) || !Number.isSafeInteger(tile.ry)) return undefined;
    return { x: tile.rx, y: tile.ry };
}

function cellKey(cell: { x: number; y: number }): string {
    return `${cell.x},${cell.y}`;
}

function ownerIndex(object: any): number {
    return Number.isSafeInteger(object?.owner?.playerListIndex) && object.owner.playerListIndex >= 0
        ? object.owner.playerListIndex
        : -1;
}

function compareObjects(left: any, right: any): number {
    const leftId = objectId(left);
    const rightId = objectId(right);
    if (leftId !== undefined && rightId !== undefined && leftId !== rightId) return leftId - rightId;
    if (leftId !== undefined && rightId === undefined) return -1;
    if (leftId === undefined && rightId !== undefined) return 1;
    const leftCell = cellOf(left);
    const rightCell = cellOf(right);
    if (leftCell && rightCell && (leftCell.x !== rightCell.x || leftCell.y !== rightCell.y)) {
        return leftCell.x - rightCell.x || leftCell.y - rightCell.y;
    }
    return String(left?.name ?? left?.rules?.name ?? "").localeCompare(
        String(right?.name ?? right?.rules?.name ?? ""),
        "en-US",
    );
}

function liveObject(object: any): boolean {
    return !!object &&
        object.isDestroyed !== true &&
        object.isDisposed !== true &&
        object.laserFenceLifecycleRemoving !== true &&
        object.laserFenceRemoved !== true &&
        object.isSpawned !== false &&
        !object.limboData;
}

function allObjects(game: any): any[] {
    return game?.world?.getAllObjects?.() ?? game?.getAllObjects?.() ?? [];
}

function mapOf(game: any): any {
    return game?.map;
}

function getTile(game: any, x: number, y: number): any {
    return mapOf(game)?.tiles?.getByMapCoords?.(x, y);
}

function getObjectsOnTile(game: any, tile: any): any[] {
    if (!tile) return [];
    return mapOf(game)?.getObjectsOnTile?.(tile) ?? mapOf(game)?.tileOccupation?.getObjectsOnTile?.(tile) ?? [];
}

function postRange(post: any): number {
    const value = Number(post?.rules?.guardRange);
    return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

export function isAresConfiguredWallTower(gameOrRules: any, nameOrObject?: string | any): boolean {
    const name = typeof nameOrObject === "string"
        ? nameOrObject
        : nameOrObject?.name ?? nameOrObject?.rules?.name;
    const configured = parseAresWallTower(
        typeof gameOrRules === "string"
            ? gameOrRules
            : gameOrRules?.wallTower ?? gameOrRules?.general?.wallTower ?? gameOrRules?.rules?.general?.wallTower,
    );
    return !!configured && !!name && configured.toLocaleLowerCase("en-US") === String(name).trim().toLocaleLowerCase("en-US");
}

function isConnectionTerrainOverlay(object: any): boolean {
    return object?.isOverlay?.() === true &&
        (object.isTiberium?.() === true || object.rules?.land === LandType.Tiberium);
}

function suitableConnectionTile(game: any, tile: any, owner: any, posts: readonly any[]): boolean {
    if (!tile) return false;
    if (tile.rampType !== undefined && tile.rampType !== 0) return false;
    const landType = Number(tile.landType);
    if ([LandType.Water, LandType.Rock, LandType.Cliff, LandType.Wall].includes(landType)) {
        return false;
    }
    const landRules = game?.rules?.getLandRules?.(tile.landType);
    if (landRules?.isBuildable && !landRules.isBuildable() && landType !== LandType.Tiberium) return false;
    const objects = getObjectsOnTile(game, tile);
    if (landType === LandType.Tiberium && !objects.some(isConnectionTerrainOverlay)) return false;
    for (const object of objects) {
        if (isLaserFenceArt(object) || isLaserFencePost(object)) {
            if (object.owner && owner && object.owner !== owner) return false;
            continue;
        }
        if (object?.isSmudge?.()) continue;
        if (object?.isTerrain?.()) return false;
        if (isConnectionTerrainOverlay(object)) continue;
        if (object?.isUnit?.()) continue;
        if (posts.some(post => object === post)) continue;
        return false;
    }
    return true;
}

function clearConnectionTerrain(game: any, tile: any): void {
    for (const object of getObjectsOnTile(game, tile)) {
        if (isConnectionTerrainOverlay(object) && typeof game?.unspawnObject === "function") {
            game.unspawnObject(object);
        }
    }
    mapOf(game)?.tileOccupation?.refreshTile?.(tile);
}

interface AresLaserFenceEdge {
    key: string;
    a: any;
    b: any;
    x: number;
    y: number;
    dx: number;
    dy: number;
    cells: Array<{ x: number; y: number }>;
}

function edgeKey(a: any, b: any): string {
    return [objectKey(a), objectKey(b)].sort().join("|");
}

function makeEdge(a: any, b: any, direction: { x: number; y: number }, maxDistance: number): AresLaserFenceEdge | undefined {
    const first = cellOf(a);
    const second = cellOf(b);
    if (!first || !second) return undefined;
    const dx = Math.sign(second.x - first.x);
    const dy = Math.sign(second.y - first.y);
    if ((dx !== 0 && dy !== 0) || (dx === 0 && dy === 0)) return undefined;
    if (dx !== direction.x || dy !== direction.y) return undefined;
    const distance = dx !== 0 ? Math.abs(second.x - first.x) : Math.abs(second.y - first.y);
    if (distance <= 1 || distance > maxDistance) return undefined;
    const cells: Array<{ x: number; y: number }> = [];
    for (let step = 1; step < distance; step++) {
        cells.push({ x: first.x + dx * step, y: first.y + dy * step });
    }
    return { key: edgeKey(a, b), a, b, x: dx, y: dy, dx, dy, cells };
}

function buildEdges(game: any, posts: readonly any[]): AresLaserFenceEdge[] {
    const directions = [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
    ];
    const edges: AresLaserFenceEdge[] = [];
    const seen = new Set<string>();
    for (const post of posts) {
        const origin = cellOf(post);
        if (!origin) continue;
        for (const direction of directions) {
            const range = postRange(post);
            let best: { post: any; distance: number } | undefined;
            for (const candidate of posts) {
                if (candidate === post || candidate.owner !== post.owner) continue;
                const cell = cellOf(candidate);
                if (!cell) continue;
                const deltaX = cell.x - origin.x;
                const deltaY = cell.y - origin.y;
                if (deltaX * direction.x + deltaY * direction.y <= 0) continue;
                if (direction.x !== 0 && deltaY !== 0) continue;
                if (direction.y !== 0 && deltaX !== 0) continue;
                const distance = direction.x !== 0 ? Math.abs(deltaX) : Math.abs(deltaY);
                if (distance > range) continue;
                if (!best || distance < best.distance ||
                    (distance === best.distance && compareObjects(candidate, best.post) < 0)) {
                    best = { post: candidate, distance };
                }
            }
            if (!best) continue;
            const edge = makeEdge(post, best.post, direction, range);
            if (!edge) continue;
            let valid = true;
            for (const cell of edge.cells) {
                const tile = getTile(game, cell.x, cell.y);
                if (!suitableConnectionTile(game, tile, post.owner, posts)) {
                    valid = false;
                    break;
                }
                if (posts.some(other => {
                    const otherCell = cellOf(other);
                    return otherCell?.x === cell.x && otherCell?.y === cell.y;
                })) {
                    valid = false;
                    break;
                }
            }
            if (!valid || seen.has(edge.key)) continue;
            seen.add(edge.key);
            edges.push(edge);
        }
    }
    return edges.sort((left, right) => left.key.localeCompare(right.key, "en-US"));
}

function canonicalFenceName(game: any): string | undefined {
    const buildingRules = game?.rules?.buildingRules;
    const names: string[] = [];
    if (buildingRules instanceof Map) {
        for (const [name, value] of buildingRules) {
            if (value?.laserFence === true) names.push(String(name));
        }
    }
    else if (Array.isArray(buildingRules)) {
        for (const value of buildingRules) {
            if (value?.laserFence === true && value?.name) names.push(String(value.name));
        }
    }
    names.sort((left, right) => left.localeCompare(right, "en-US"));
    return names[0];
}

function fenceTypeFor(game: any, object: any): string {
    return String(object?.name ?? object?.rules?.name ?? canonicalFenceName(game) ?? "");
}

function isPostId(value: unknown, post: any): boolean {
    return value === objectId(post) || value === objectKey(post);
}

function statePostIds(object: any): any[] {
    const ids = isLaserFencePost(object)
        ? object?.laserFenceConnectedPostIds
        : object?.laserFencePostIds;
    return Array.isArray(ids) ? ids : [];
}

function numericIds(values: readonly any[]): number[] {
    return values
        .map(value => objectId(value) ?? (Number.isSafeInteger(value) && value >= 0 ? value : undefined))
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right);
}

function statePostMask(object: any): number {
    return getLaserFenceConnectionMask(object);
}

function stateActive(object: any): boolean {
    if (typeof object?.laserFenceActive === "boolean") return object.laserFenceActive;
    return object?.laserFencePowered === true;
}

function stateDirection(object: any): number {
    const value = Number(object?.laserFenceDirection);
    return Number.isFinite(value) ? value : getLaserFenceDirection(statePostMask(object));
}

function validateNonNegativeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`Invalid Ares laser fence state: ${label}`);
    }
    return value as number;
}

function validateMask(value: unknown, label: string): number {
    const mask = validateNonNegativeInteger(value, label);
    if (mask >= ARES_LASER_FENCE_TOPOLOGY_COUNT) {
        throw new Error(`Invalid Ares laser fence state: ${label}`);
    }
    return mask;
}

function validateIdList(value: unknown, label: string): number[] {
    if (!Array.isArray(value) || value.some(item => !Number.isSafeInteger(item) || item < 0)) {
        throw new Error(`Invalid Ares laser fence state: ${label}`);
    }
    return [...new Set(value as number[])].sort((left, right) => left - right);
}

export function validateAresLaserFenceSnapshot(value: unknown): AresLaserFenceSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid Ares laser fence state: expected an object");
    }
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== ARES_LASER_FENCE_STATE_VERSION) {
        throw new Error(`Unsupported Ares laser fence state version: ${String(candidate.version)}`);
    }
    if (!Array.isArray(candidate.posts) || !Array.isArray(candidate.fences)) {
        throw new Error("Invalid Ares laser fence state: topology arrays are required");
    }
    const postIds = new Set<number>();
    const posts = candidate.posts.map((entry: any) => {
        if (!entry || typeof entry !== "object") throw new Error("Invalid Ares laser fence post state");
        const id = validateNonNegativeInteger(entry.objectId, "post objectId");
        if (postIds.has(id)) throw new Error(`Duplicate Ares laser fence post ${id}`);
        postIds.add(id);
        if (!Number.isSafeInteger(entry.x) || !Number.isSafeInteger(entry.y)) throw new Error("Invalid Ares laser fence post coordinates");
        if (typeof entry.active !== "boolean") throw new Error("Invalid Ares laser fence post active state");
        return {
            objectId: id,
            x: entry.x,
            y: entry.y,
            ownerIndex: validateNonNegativeInteger(entry.ownerIndex, "post ownerIndex"),
            active: entry.active,
            connectionMask: validateMask(entry.connectionMask, "post connectionMask"),
            connectedPostIds: validateIdList(entry.connectedPostIds, "post connectedPostIds"),
        } satisfies AresLaserFencePostSnapshot;
    });
    const fenceIds = new Set<number>();
    const fences = candidate.fences.map((entry: any) => {
        if (!entry || typeof entry !== "object") throw new Error("Invalid Ares laser fence fence state");
        const id = validateNonNegativeInteger(entry.objectId, "fence objectId");
        if (fenceIds.has(id)) throw new Error(`Duplicate Ares laser fence fence ${id}`);
        fenceIds.add(id);
        if (!Number.isSafeInteger(entry.x) || !Number.isSafeInteger(entry.y)) throw new Error("Invalid Ares laser fence coordinates");
        const postIdsForFence = validateIdList(entry.postIds, "fence postIds");
        if (postIdsForFence.some(postId => !postIds.has(postId))) throw new Error("Ares laser fence endpoint is unresolved");
        if (typeof entry.active !== "boolean") throw new Error("Invalid Ares laser fence active state");
        if (typeof entry.artName !== "string") throw new Error("Invalid Ares laser fence art name");
        return {
            objectId: id,
            x: entry.x,
            y: entry.y,
            ownerIndex: validateNonNegativeInteger(entry.ownerIndex, "fence ownerIndex"),
            postIds: postIdsForFence,
            connectionMask: validateMask(entry.connectionMask, "fence connectionMask"),
            active: entry.active,
            direction: validateNonNegativeInteger(entry.direction, "fence direction"),
            artName: entry.artName,
        } satisfies AresLaserFenceFenceSnapshot;
    });
        const postObjectIds = new Set(posts.map(entry => entry.objectId));
        for (const post of posts) {
            if (post.connectedPostIds.some(id => !postObjectIds.has(id))) {
                throw new Error("Ares laser fence post connection is unresolved");
            }
        }
        return {
            version: ARES_LASER_FENCE_STATE_VERSION,
            posts,
            fences,
            sweepCooldownTicks: validateNonNegativeInteger(candidate.sweepCooldownTicks, "sweepCooldownTicks"),
        activationGeneration: validateNonNegativeInteger(candidate.activationGeneration, "activationGeneration"),
    };
}

export class AresLaserFenceRuntime {
    private game: any;
    private reconciling = false;
    private pending = false;
    private removing = new Set<any>();
    private postStates = new Map<any, { active: boolean; mask: number; connected: any[] }>();
    private fenceStates = new Map<any, { active: boolean; mask: number; postIds: any[] }>();
    private subscriptions: Array<() => void> = [];
    private cooldown = 0;
    private lastCooldownTick = -1;
    private generation = 0;

    attach(game: any): void {
        if (!game || this.game === game) return;
        this.detachSubscriptions();
        this.game = game;
        const subscribe = game.events?.subscribe?.bind(game.events);
        if (!subscribe) return;
        const eventTypes = [
            EventType.PowerChange,
            EventType.PowerLow,
            EventType.PowerRestore,
            EventType.ObjectOwnerChange,
            EventType.ObjectDestroy,
            EventType.ObjectUnspawn,
        ];
        for (const eventType of eventTypes) {
            const unsubscribe = subscribe(eventType, () => this.reconcile(game));
            if (typeof unsubscribe === "function") this.subscriptions.push(unsubscribe);
        }
    }

    private detachSubscriptions(): void {
        for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    }

    dispose(): void {
        this.detachSubscriptions();
        this.game = undefined;
        this.postStates.clear();
        this.fenceStates.clear();
        this.removing.clear();
        this.pending = false;
        this.reconciling = false;
        this.cooldown = 0;
        this.lastCooldownTick = -1;
        this.generation = 0;
    }

    register(object: any, game?: any): void {
        if (game) this.attach(game);
        object.laserFenceRemoved = false;
        if (isLaserFencePost(object)) {
            this.postStates.set(object, {
                active: stateActive(object),
                mask: statePostMask(object),
                connected: statePostIds(object),
            });
        }
        else if (isLaserFenceArt(object)) {
            this.fenceStates.set(object, {
                active: stateActive(object),
                mask: statePostMask(object),
                postIds: statePostIds(object),
            });
        }
        this.reconcile(this.game ?? game);
    }

    detach(object: any, game?: any, removeConnected = false): void {
        const post = isLaserFencePost(object);
        if (removeConnected && post) {
            object.laserFenceLifecycleRemoving = true;
            try {
                this.removeConnectedFences(object, game ?? this.game);
            }
            finally {
                object.laserFenceLifecycleRemoving = false;
            }
        }
        if (post) this.postStates.delete(object);
        if (isLaserFenceArt(object)) this.fenceStates.delete(object);
        this.clearObjectState(object);
        if (!removeConnected) this.reconcile(game ?? this.game);
    }

    reconcile(game: any = this.game, createMissing = true): void {
        if (!game) return;
        this.attach(game);
        if (this.reconciling) {
            this.pending = true;
            return;
        }
        this.reconciling = true;
        try {
            let passes = 0;
            do {
                this.pending = false;
                this.reconcilePass(game, createMissing);
                passes++;
            } while (this.pending && passes < 8);
            this.pending = false;
        }
        finally {
            this.reconciling = false;
        }
    }

    tick(game: any = this.game): void {
        if (!game) return;
        const tick = Number(game.currentTick);
        if (!Number.isSafeInteger(tick)) return;
        if (this.lastCooldownTick === tick) return;
        this.lastCooldownTick = tick;
        if (this.cooldown > 0) this.cooldown--;
    }

    update(game: any = this.game): void {
        this.tick(game);
        this.reconcile(game);
    }

    getHash(): number {
        const values: (string | number)[] = [
            "AresLaserFenceRuntime",
            this.cooldown,
            this.generation,
        ];
        const posts = allObjects(this.game).filter(isLaserFencePost).filter(liveObject).sort(compareObjects);
        for (const post of posts) {
            values.push(
                "post",
                objectId(post) ?? objectKey(post),
                cellOf(post)?.x ?? -1,
                cellOf(post)?.y ?? -1,
                ownerIndex(post),
                this.postStates.get(post)?.active ? 1 : 0,
                this.postStates.get(post)?.mask ?? statePostMask(post),
                ...numericIds(this.postStates.get(post)?.connected ?? statePostIds(post)),
            );
        }
        const fences = allObjects(this.game).filter(isLaserFenceArt).filter(liveObject).sort(compareObjects);
        for (const fence of fences) {
            const state = this.fenceStates.get(fence);
            values.push(
                "fence",
                objectId(fence) ?? objectKey(fence),
                cellOf(fence)?.x ?? -1,
                cellOf(fence)?.y ?? -1,
                ownerIndex(fence),
                state?.active ? 1 : 0,
                state?.mask ?? statePostMask(fence),
                ...(state?.postIds ?? statePostIds(fence)).map(value => objectId(value) ?? (Number.isSafeInteger(value) && value >= 0 ? value : String(value))).sort((a: any, b: any) => String(a).localeCompare(String(b), "en-US")),
                fenceTypeFor(this.game, fence),
            );
        }
        return fnv32aStrings(values);
    }

    captureState(): AresLaserFenceSnapshot {
        const posts = allObjects(this.game).filter(isLaserFencePost).filter(liveObject).sort(compareObjects);
        const fences = allObjects(this.game).filter(isLaserFenceArt).filter(liveObject).sort(compareObjects);
        return {
            version: ARES_LASER_FENCE_STATE_VERSION,
            posts: posts.map(post => ({
                objectId: objectId(post) ?? -1,
                x: cellOf(post)?.x ?? -1,
                y: cellOf(post)?.y ?? -1,
                ownerIndex: Math.max(0, ownerIndex(post)),
                active: this.postStates.get(post)?.active ?? stateActive(post),
                connectionMask: this.postStates.get(post)?.mask ?? statePostMask(post),
                connectedPostIds: numericIds(this.postStates.get(post)?.connected ?? statePostIds(post)),
            })).filter(entry => entry.objectId >= 0),
            fences: fences.map(fence => ({
                objectId: objectId(fence) ?? -1,
                x: cellOf(fence)?.x ?? -1,
                y: cellOf(fence)?.y ?? -1,
                ownerIndex: Math.max(0, ownerIndex(fence)),
                postIds: numericIds(this.fenceStates.get(fence)?.postIds ?? statePostIds(fence)),
                connectionMask: this.fenceStates.get(fence)?.mask ?? statePostMask(fence),
                active: this.fenceStates.get(fence)?.active ?? stateActive(fence),
                direction: stateDirection(fence),
                artName: fenceTypeFor(this.game, fence),
            })).filter(entry => entry.objectId >= 0),
            sweepCooldownTicks: this.cooldown,
            activationGeneration: this.generation,
        };
    }

    validateState(state: unknown, strict = false): AresLaserFenceSnapshot {
        const snapshot = validateAresLaserFenceSnapshot(state);
        if (!strict) return snapshot;
        const posts = allObjects(this.game).filter(isLaserFencePost).filter(liveObject);
        const fences = allObjects(this.game).filter(isLaserFenceArt).filter(liveObject);
        const postMap = new Map(posts.map(post => [objectId(post), post]));
        const fenceMap = new Map(fences.map(fence => [objectId(fence), fence]));
        for (const entry of snapshot.posts) {
            const post = postMap.get(entry.objectId);
            if (!post) throw new Error(`Ares laser fence post ${entry.objectId} is unresolved`);
            const cell = cellOf(post);
            if (cell && (cell.x !== entry.x || cell.y !== entry.y)) throw new Error(`Ares laser fence post ${entry.objectId} coordinates changed`);
        }
        for (const entry of snapshot.fences) {
            const fence = fenceMap.get(entry.objectId);
            if (!fence) throw new Error(`Ares laser fence ${entry.objectId} is unresolved`);
            const cell = cellOf(fence);
            if (cell && (cell.x !== entry.x || cell.y !== entry.y)) throw new Error(`Ares laser fence ${entry.objectId} coordinates changed`);
        }
        return snapshot;
    }

    restoreState(state: unknown, strict = false): void {
        const snapshot = this.validateState(state, strict);
        this.cooldown = snapshot.sweepCooldownTicks;
        this.generation = snapshot.activationGeneration;
        const posts = allObjects(this.game).filter(isLaserFencePost).filter(liveObject);
        const fences = allObjects(this.game).filter(isLaserFenceArt).filter(liveObject);
        const postMap = new Map(posts.map(post => [objectId(post), post]));
        const fenceMap = new Map(fences.map(fence => [objectId(fence), fence]));
        for (const entry of snapshot.posts) {
            const post = postMap.get(entry.objectId);
            if (!post) continue;
            post.laserFenceActive = entry.active;
            post.laserFencePowered = entry.active;
            post.laserFenceConnectionMask = entry.connectionMask;
            post.laserFenceConnectedPostIds = [...entry.connectedPostIds];
            this.postStates.set(post, { active: entry.active, mask: entry.connectionMask, connected: [...entry.connectedPostIds] });
        }
        for (const entry of snapshot.fences) {
            const fence = fenceMap.get(entry.objectId);
            if (!fence) continue;
            const endpoints = entry.postIds.map(id => postMap.get(id)).filter(Boolean) as any[];
            fence.laserFencePostIds = [...entry.postIds];
            fence.laserFencePosts = endpoints;
            fence.laserFenceConnectionMask = entry.connectionMask;
            fence.laserFenceDirection = entry.direction;
            fence.laserFenceActive = entry.active;
            fence.laserFencePowered = entry.active;
            this.fenceStates.set(fence, { active: entry.active, mask: entry.connectionMask, postIds: [...entry.postIds] });
        }
        this.reconcile(this.game, false);
    }

    captureObjectState(object: any): AresLaserFenceTraitState {
        const post = isLaserFencePost(object);
        const state = post ? this.postStates.get(object) : this.fenceStates.get(object);
        const references = post
            ? this.postStates.get(object)?.connected ?? statePostIds(object)
            : this.fenceStates.get(object)?.postIds ?? statePostIds(object);
        return {
            version: ARES_LASER_FENCE_STATE_VERSION,
            role: post ? "post" : "fence",
            objectId: objectId(object) ?? -1,
            active: state?.active ?? (post ? isLaserFencePowered(object) : stateActive(object)),
            connectionMask: state?.mask ?? statePostMask(object),
            postIds: numericIds(references),
            sweepCooldownTicks: this.cooldown,
        };
    }

    restoreObjectState(object: any, state: unknown, strict = false): void {
        if (!state || typeof state !== "object") throw new Error("Invalid Ares laser fence object state");
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== ARES_LASER_FENCE_STATE_VERSION) throw new Error("Unsupported Ares laser fence object state version");
        if (candidate.role !== (isLaserFencePost(object) ? "post" : "fence")) throw new Error("Ares laser fence object role changed");
        const mask = validateMask(candidate.connectionMask, "connectionMask");
        const postIds = validateIdList(candidate.postIds, "postIds");
        if (typeof candidate.active !== "boolean") throw new Error("Invalid Ares laser fence object active state");
        if (postIds.some(id => !allObjects(this.game).some(other => objectId(other) === id))) {
            if (strict) throw new Error("Ares laser fence object endpoint is unresolved");
        }
        object.laserFenceRemoved = false;
        object.laserFenceConnectionMask = mask;
        object.laserFenceActive = candidate.active;
        object.laserFencePowered = candidate.active;
        if (!isLaserFencePost(object)) {
            const endpoints = postIds
                .map(id => allObjects(this.game).find(other => objectId(other) === id))
                .filter(Boolean);
            object.laserFencePostIds = postIds;
            object.laserFencePostKeys = postIds.map(id => `id:${id}`);
            object.laserFencePosts = endpoints;
            object.laserFenceConnectedPosts = endpoints;
            this.fenceStates.set(object, { active: candidate.active, mask, postIds });
        }
        else {
            const connected = postIds
                .map(id => allObjects(this.game).find(other => objectId(other) === id))
                .filter(Boolean);
            object.laserFenceConnectedPostIds = postIds;
            object.laserFenceConnectedPosts = connected;
            this.postStates.set(object, { active: candidate.active, mask, connected });
        }
        this.cooldown = validateNonNegativeInteger(candidate.sweepCooldownTicks, "sweepCooldownTicks");
    }

    private reconcilePass(game: any, createMissing: boolean): void {
        const posts = allObjects(game).filter(isLaserFencePost).filter(liveObject).sort(compareObjects);
        const initialFences = allObjects(game).filter(isLaserFenceArt).filter(liveObject).sort(compareObjects);
        const edges = buildEdges(game, posts);
        const edgeByCell = new Map<string, AresLaserFenceEdge>();
        for (const edge of edges) {
            for (const cell of edge.cells) edgeByCell.set(cellKey(cell), edge);
        }
        const fenceByCell = new Map<string, any>();
        const stale = new Set<any>();
        const edgeIds = (edge: AresLaserFenceEdge): string[] => [objectKey(edge.a), objectKey(edge.b)].sort();
        const matchesEdge = (fence: any, edge: AresLaserFenceEdge): boolean => {
            const ids = statePostIds(fence).map(value => String(value));
            const expected = edgeIds(edge);
            const numeric = [objectId(edge.a), objectId(edge.b)]
                .filter((value): value is number => value !== undefined)
                .sort((left, right) => left - right);
            return (ids.length === expected.length && ids.every(id => expected.includes(id))) ||
                (numeric.length === expected.length && ids.length === numeric.length && numeric.every(id => ids.includes(String(id))));
        };
        for (const fence of initialFences) {
            const cell = cellOf(fence);
            const edge = cell ? edgeByCell.get(cellKey(cell)) : undefined;
            if (!edge) {
                if (fence.laserFenceAutoGenerated || statePostIds(fence).length > 0 || fence.laserFencePostKeys?.length) {
                    stale.add(fence);
                }
                else {
                    this.clearFenceAssociation(fence);
                }
                continue;
            }
            const key = cellKey(cell!);
            const current = fenceByCell.get(key);
            if (!current) {
                fenceByCell.set(key, fence);
                continue;
            }
            const currentMatches = matchesEdge(current, edge);
            const candidateMatches = matchesEdge(fence, edge);
            if ((current.laserFenceAutoGenerated && !fence.laserFenceAutoGenerated) ||
                (candidateMatches && !currentMatches) ||
                (candidateMatches === currentMatches && compareObjects(fence, current) < 0)) {
                fenceByCell.set(key, fence);
                stale.add(current);
            }
            else {
                stale.add(fence);
            }
        }
        for (const fence of stale) this.removeFenceArt(fence, game);
        if (createMissing) {
            for (const edge of edges) {
                for (const cell of edge.cells) {
                    const key = cellKey(cell);
                    if (fenceByCell.has(key)) continue;
                    const tile = getTile(game, cell.x, cell.y);
                    if (!tile || !suitableConnectionTile(game, tile, edge.a.owner, posts)) continue;
                    clearConnectionTerrain(game, tile);
                    const name = canonicalFenceName(game);
                    if (!name || typeof game.createObject !== "function" || typeof game.spawnObject !== "function") continue;
                    try {
                        const fence = game.createObject(ObjectType.Building, name);
                        if (!fence) continue;
                        fence.laserFenceAutoGenerated = true;
                        if (typeof game.changeObjectOwner === "function" && edge.a.owner) {
                            game.changeObjectOwner(fence, edge.a.owner);
                        }
                        game.spawnObject(fence, tile);
                        fenceByCell.set(key, fence);
                        this.pending = true;
                    }
                    catch {
                        continue;
                    }
                }
            }
        }
        const postConnections = new Map<any, { mask: number; connected: any[] }>();
        for (const post of posts) postConnections.set(post, { mask: 0, connected: [] });
        const reactivating: any[] = [];
        for (const edge of edges) {
            const mask = edge.dx !== 0 ? 0b1010 : 0b0101;
            const active = isLaserFencePowered(edge.a) && isLaserFencePowered(edge.b);
            const first = postConnections.get(edge.a)!;
            const second = postConnections.get(edge.b)!;
            if (edge.dx !== 0) {
                first.mask |= edge.dx > 0 ? 0b0010 : 0b1000;
                second.mask |= edge.dx > 0 ? 0b1000 : 0b0010;
            }
            else {
                first.mask |= edge.dy > 0 ? 0b0100 : 0b0001;
                second.mask |= edge.dy > 0 ? 0b0001 : 0b0100;
            }
            first.connected.push(edge.b);
            second.connected.push(edge.a);
            for (const cell of edge.cells) {
                const fence = fenceByCell.get(cellKey(cell));
                if (!fence) continue;
                const previous = this.fenceStates.get(fence);
                const wasActive = previous?.active ?? (typeof fence.laserFenceActive === "boolean" ? fence.laserFenceActive : undefined);
                this.assignFence(fence, edge, mask, active);
                if (active && wasActive === false) reactivating.push(fence);
            }
        }
        for (const post of posts) {
            const connection = postConnections.get(post)!;
            const active = isLaserFencePowered(post);
            post.laserFenceConnectionMask = connection.mask;
            post.laserFenceConnectedPostIds = connection.connected
                .map(value => objectId(value))
                .filter((value): value is number => value !== undefined)
                .sort((left, right) => left - right);
            post.laserFenceConnectedPosts = connection.connected.slice().sort(compareObjects);
            post.laserFenceActive = active;
            post.laserFencePowered = active;
            this.postStates.set(post, {
                active,
                mask: connection.mask,
                connected: connection.connected.slice().sort(compareObjects),
            });
        }
        const currentFences = allObjects(game).filter(isLaserFenceArt).filter(liveObject).sort(compareObjects);
        for (const fence of currentFences) {
            const cell = cellOf(fence);
            if (cell && fenceByCell.has(cellKey(cell))) {
                this.fenceStates.set(fence, {
                    active: stateActive(fence),
                    mask: statePostMask(fence),
                    postIds: statePostIds(fence),
                });
            }
            else if (!fence.laserFenceAutoGenerated) {
                this.clearFenceAssociation(fence);
            }
            this.refreshFenceTiles(fence, game);
        }
        if (reactivating.length) this.sweep(reactivating, game);
    }

    private assignFence(fence: any, edge: AresLaserFenceEdge, mask: number, active: boolean): void {
        const endpoints = [edge.a, edge.b].sort(compareObjects);
        const endpointIds = endpoints
            .map(value => objectId(value))
            .filter((value): value is number => value !== undefined)
            .sort((left, right) => left - right);
        const endpointKeys = endpoints.map(objectKey).sort();
        fence.laserFencePostIds = endpointIds.length === endpoints.length
            ? endpointIds
            : endpointKeys;
        fence.laserFencePostKeys = endpointKeys;
        fence.laserFencePosts = endpoints;
        fence.laserFenceConnectedPosts = endpoints;
        fence.laserFenceConnectionMask = mask;
        fence.laserFenceWallType = getLaserFenceWallType(mask);
        fence.laserFenceDirection = getLaserFenceDirection(mask);
        fence.laserFenceActive = active;
        fence.laserFencePowered = active;
        fence.laserFenceOwner = edge.a.owner;
        fence.laserFenceArtName = fenceTypeFor(this.game, fence);
        fence.laserFenceFrame = getLaserFenceArtFrame(mask, active, this.frameCount(fence));
        this.fenceStates.set(fence, { active, mask, postIds: [...fence.laserFencePostIds] });
    }

    private frameCount(object: any): number | undefined {
        const renderable = object?.renderable;
        return Number(renderable?.frameCount ?? renderable?.mainRenderable?.frameCount) || undefined;
    }

    private clearFenceAssociation(fence: any): void {
        fence.laserFencePostIds = [];
        fence.laserFencePostKeys = [];
        fence.laserFencePosts = [];
        fence.laserFenceConnectedPosts = [];
        fence.laserFenceConnectionMask = 0;
        fence.laserFenceWallType = 0;
        fence.laserFenceDirection = 0;
        fence.laserFenceFrame = 0;
        fence.laserFenceActive = false;
        fence.laserFencePowered = false;
        this.fenceStates.delete(fence);
    }

    private clearObjectState(object: any): void {
        if (isLaserFencePost(object)) {
            object.laserFenceConnectionMask = 0;
            object.laserFenceConnectedPostIds = [];
            object.laserFenceConnectedPosts = [];
            object.laserFenceActive = isLaserFencePowered(object);
            object.laserFencePowered = object.laserFenceActive;
        }
        else if (isLaserFenceArt(object)) {
            this.clearFenceAssociation(object);
        }
    }

    private refreshFenceTiles(fence: any, game: any): void {
        const tileOccupation = mapOf(game)?.tileOccupation;
        if (!tileOccupation?.refreshTile) return;
        for (const tile of getObjectsOnTile(game, cellOf(fence) ? getTile(game, cellOf(fence)!.x, cellOf(fence)!.y) : undefined)) {
            if (tile === fence) tileOccupation.refreshTile(tile, fence);
        }
    }

    private removeConnectedFences(post: any, game: any): void {
        const postIdentifier = objectKey(post);
        const fences = allObjects(game).filter(isLaserFenceArt).filter(liveObject).filter(fence =>
            statePostIds(fence).some(value => String(value) === postIdentifier || isPostId(value, post)),
        );
        for (const fence of fences) this.removeFenceArt(fence, game);
    }

    private removeFenceArt(fence: any, game: any): void {
        if (!fence || this.removing.has(fence)) return;
        this.removing.add(fence);
        fence.laserFenceRemoved = true;
        try {
            if (fence.isSpawned !== false && typeof game?.unspawnObject === "function") {
                game.unspawnObject(fence);
            }
            else if (fence.isDisposed !== true) {
                fence.dispose?.();
            }
        }
        finally {
            this.removing.delete(fence);
        }
    }

    private sweep(fences: readonly any[], game: any): void {
        const candidates = new Map<any, any>();
        for (const fence of fences.slice().sort(compareObjects)) {
            const tile = cellOf(fence);
            const actualTile = tile ? getTile(game, tile.x, tile.y) : undefined;
            for (const object of getObjectsOnTile(game, actualTile)) {
                if (object === fence || object === fence.laserFencePosts?.[0] || object === fence.laserFencePosts?.[1]) continue;
                if (!object?.isUnit?.() || object.isDestroyed || object.isDisposed || object.isCrashing) continue;
                if (object.rules?.ignoresLaserFence === true) continue;
                candidates.set(object, fence);
            }
        }
        const ordered = [...candidates.keys()].sort(compareObjects);
        const sweepGeneration = ++this.generation;
        for (const object of ordered) {
            if (object.laserFenceSweepGeneration === sweepGeneration) continue;
            object.laserFenceSweepGeneration = sweepGeneration;
            if (typeof game.destroyObject === "function") game.destroyObject(object, undefined, true);
        }
        for (const fence of fences) fence.laserFenceSweepGeneration = sweepGeneration;
        this.cooldown = ARES_LASER_FENCE_SWEEP_COOLDOWN_TICKS;
    }
}

export class AresLaserFenceTrait implements NotifySpawn, NotifyUnspawn, NotifyDestroy, NotifyOwnerChange, NotifyTick {
    private readonly gameObject: any;
    private runtime?: AresLaserFenceRuntime;

    constructor(gameObject: any) {
        this.gameObject = gameObject;
    }

    [NotifySpawn.onSpawn](gameObject: any, game: any): void {
        this.runtime = this.resolveRuntime(game);
        this.runtime.register(gameObject, game);
    }

    [NotifyTick.onTick](gameObject: any, game: any): void {
        if (!isLaserFencePost(gameObject)) return;
        this.runtime = this.resolveRuntime(game);
        this.runtime.tick(game);
        this.runtime.reconcile(game);
    }

    [NotifyOwnerChange.onChange](gameObject: any, _oldOwner: any, game: any): void {
        this.runtime = this.resolveRuntime(game);
        this.runtime.detach(gameObject, game, true);
        this.runtime.reconcile(game);
    }

    [NotifyDestroy.onDestroy](gameObject: any, game: any): void {
        this.runtime = this.resolveRuntime(game);
        this.runtime.detach(gameObject, game, true);
    }

    [NotifyUnspawn.onUnspawn](gameObject: any, game: any): void {
        this.runtime = this.resolveRuntime(game);
        this.runtime.detach(gameObject, game, true);
    }

    getHash(): number {
        const state = this.runtime?.captureObjectState(this.gameObject);
        return state
            ? fnv32aStrings([
                "AresLaserFenceTrait",
                state.role,
                state.objectId,
                state.active ? 1 : 0,
                state.connectionMask,
                ...state.postIds,
                state.sweepCooldownTicks,
            ])
            : 0;
    }

    serializeState(): AresLaserFenceTraitState {
        return this.runtime?.captureObjectState(this.gameObject) ?? {
            version: ARES_LASER_FENCE_STATE_VERSION,
            role: isLaserFencePost(this.gameObject) ? "post" : "fence",
            objectId: objectId(this.gameObject) ?? -1,
            active: stateActive(this.gameObject),
            connectionMask: statePostMask(this.gameObject),
            postIds: [],
            sweepCooldownTicks: 0,
        };
    }

    validateState(state: unknown): AresLaserFenceTraitState {
        if (!state || typeof state !== "object") throw new Error("Invalid Ares laser fence object state");
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== ARES_LASER_FENCE_STATE_VERSION) throw new Error("Unsupported Ares laser fence object state version");
        if (candidate.role !== (isLaserFencePost(this.gameObject) ? "post" : "fence")) throw new Error("Ares laser fence object role changed");
        if (typeof candidate.active !== "boolean") throw new Error("Invalid Ares laser fence object active state");
        validateMask(candidate.connectionMask, "connectionMask");
        validateIdList(candidate.postIds, "postIds");
        validateNonNegativeInteger(candidate.sweepCooldownTicks, "sweepCooldownTicks");
        return state as AresLaserFenceTraitState;
    }

    restoreState(state: unknown): void {
        this.validateState(state);
        this.runtime?.restoreObjectState(this.gameObject, state, false);
    }

    debugGetState(): AresLaserFenceTraitState {
        return this.serializeState();
    }

    dispose(): void {
        this.runtime = undefined;
    }

    private resolveRuntime(game: any): AresLaserFenceRuntime {
        if (game?.aresLaserFenceRuntime instanceof AresLaserFenceRuntime) {
            return game.aresLaserFenceRuntime;
        }
        this.runtime = getAresLaserFenceRuntime(game);
        return this.runtime;
    }
}

export function getAresLaserFenceRuntime(game: any): AresLaserFenceRuntime {
    if (game?.aresLaserFenceRuntime instanceof AresLaserFenceRuntime) return game.aresLaserFenceRuntime;
    if (game && typeof game === "object") {
        const existing = fallbackLaserFenceRuntimes.get(game);
        if (existing) return existing;
        const runtime = new AresLaserFenceRuntime();
        fallbackLaserFenceRuntimes.set(game, runtime);
        runtime.attach(game);
        return runtime;
    }
    const runtime = new AresLaserFenceRuntime();
    runtime.attach(game);
    return runtime;
}
