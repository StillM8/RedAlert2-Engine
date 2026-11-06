import { PrngState } from "@/game/Prng";
import { getObjectTraitFactory, getRuntimeAttachKey } from "@/game/state/ObjectTraitFactoryRegistry";

export const WORLD_STATE_SNAPSHOT_VERSION = 1 as const;

export interface WorldTraitState {
    key: string;
    state: unknown;
}

/**
 * A trait the object factory does not build, so restore must re-attach it from
 * a registered factory before applying its state.
 */
export interface WorldAttachedTraitState {
    key: string;
    context: unknown;
    state: unknown;
}

export interface WorldObjectState {
    id: number;
    type: number;
    name: string;
    ownerIndex: number | null;
    spawned: boolean;
    limbo?: {
        selected: boolean;
        controlGroup?: number;
        inTransport: boolean;
    };
    position?: {
        rx: number;
        ry: number;
        subCell: number;
        tileElevation: number;
        worldY: number;
    };
    core: Record<string, unknown>;
    traits: WorldTraitState[];
    attachedTraits?: WorldAttachedTraitState[];
}

export interface WorldPlayerState {
    index: number;
    credits: number;
    score: number;
    defeated: boolean;
    resigned: boolean;
    dropped: boolean;
    aresFirestormActive: boolean;
    productionEnabled: boolean;
    aiTriggersEnabled: boolean;
    cheerCooldownTicks: number;
    buildLimitState?: unknown;
    unitsBuilt: Record<string, number>;
    unitsKilled: Record<string, number>;
    unitsLost: Record<string, number>;
    traits: WorldTraitState[];
}

export interface WorldAllianceState {
    first: number;
    second: number;
    status: number;
}

export interface WorldSelectionState {
    selected: number[];
    groups: [number, number[]][];
}

export interface WorldTraitOwnerState {
    key: string;
    state: unknown;
}

export interface WorldStateSnapshot {
    version: typeof WORLD_STATE_SNAPSHOT_VERSION;
    tick: number;
    currentTime: number;
    nextObjectId: number;
    status: number;
    prng: PrngState;
    players: WorldPlayerState[];
    objects: WorldObjectState[];
    limboObjects: WorldObjectState[];
    alliances: WorldAllianceState[];
    alliancesFixed: boolean;
    selection?: WorldSelectionState;
    teamState?: unknown;
    secretLabState?: unknown;
    traits: WorldTraitOwnerState[];
}

export interface WorldStateRestoreOptions {
    strict?: boolean;
    resolveObjectById?: (id: number) => any;
    resolvePlayerByIndex?: (index: number) => any;
    createObject?: (type: number, name: string) => any;
    spawnObject?: (object: any, tile: any) => void;
    unspawnObject?: (object: any) => void;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function assertSafeId(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`Invalid world state ${label}`);
    }
    return value as number;
}

function assertBoolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") {
        throw new Error(`Invalid world state ${label}`);
    }
    return value;
}

function assertString(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new Error(`Invalid world state ${label}`);
    }
    return value;
}

function playerIndex(player: any): number | null {
    return Number.isSafeInteger(player?.playerListIndex) && player.playerListIndex >= 0
        ? player.playerListIndex
        : null;
}

function objectKey(trait: any): string {
    const explicit = trait?.deterministicStateKey ?? trait?.stateKey;
    if (typeof explicit === "string" && explicit.length) {
        return explicit;
    }
    const name = trait?.constructor?.name;
    return typeof name === "string" && name.length ? name : "anonymous-trait";
}

function captureTraitState(trait: any): WorldTraitState | undefined {
    const method = typeof trait?.captureState === "function"
        ? "captureState"
        : typeof trait?.serializeState === "function"
            ? "serializeState"
            : undefined;
    if (!method) {
        return undefined;
    }
    return { key: objectKey(trait), state: trait[method]() };
}

function captureObjectCore(object: any): Record<string, unknown> {
    const core: Record<string, unknown> = {
        isCrashing: object?.isCrashing === true,
        isDestroyed: object?.isDestroyed === true,
        isDisposed: object?.isDisposed === true,
        isSpawned: object?.isSpawned === true,
        deathType: object?.deathType,
    };
    const fields = [
        "direction",
        "zone",
        "onBridge",
        "isFiring",
        "isPanicked",
        "guardMode",
        "purchaseValue",
        "infDeathType",
        "spinVelocity",
        "turretNo",
        "isSinker",
        "pitch",
        "yaw",
        "roll",
        "overlayId",
        "value",
        "radarInvisible",
    ];
    for (const field of fields) {
        if (object && Object.prototype.hasOwnProperty.call(object, field)) {
            const value = object[field];
            if (value === undefined || typeof value === "function") {
                continue;
            }
            if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
                core[field] = value;
            }
        }
    }
    if (object?.isInfantry?.()) {
        core.stance = object.stance;
    }
    if (object?.healthTrait && typeof object.healthTrait.getHitPoints === "function") {
        core.healthHitPoints = object.healthTrait.getHitPoints();
    }
    if (object?.veteranTrait && typeof object.veteranTrait.captureState === "function") {
        core.veteranState = object.veteranTrait.captureState();
    }
    if (object?.ammoTrait && typeof object.ammoTrait.captureState === "function") {
        core.ammoState = object.ammoTrait.captureState();
    }
    if (object?.poweredTrait && typeof object.poweredTrait.isPoweredOn === "function") {
        core.poweredOn = object.poweredTrait.isPoweredOn(false);
    }
    return core;
}

function captureObject(object: any, game: any, spawned: boolean): WorldObjectState {
    const id = assertSafeId(object?.id, "object id");
    const type = assertSafeId(object?.type, `object ${id} type`);
    const name = assertString(object?.name, `object ${id} name`);
    const owner = playerIndex(object?.owner);
    const objectTraits = object?.traits?.getAll?.() ?? [];
    const attachedTraits = objectTraits
        .filter((trait: any) => getRuntimeAttachKey(trait) !== undefined)
        .map((trait: any): WorldAttachedTraitState => {
            const captured = captureTraitState(trait);
            if (!captured) {
                throw new Error(`Runtime-attached trait on object ${id} is not snapshot-capable`);
            }
            const context = typeof trait.captureContext === "function" ? trait.captureContext() : {};
            return { key: getRuntimeAttachKey(trait)!, context, state: captured.state };
        });
    const record: WorldObjectState = {
        id,
        type,
        name,
        ownerIndex: owner,
        spawned,
        core: captureObjectCore(object),
        traits: objectTraits
            .filter((trait: any) => getRuntimeAttachKey(trait) === undefined)
            .map(captureTraitState)
            .filter((entry: WorldTraitState | undefined): entry is WorldTraitState => !!entry),
        ...(attachedTraits.length ? { attachedTraits } : {}),
    };
    if (spawned && object?.position) {
        const tile = object.position.tile;
        if (!tile || !Number.isSafeInteger(tile.rx) || !Number.isSafeInteger(tile.ry)) {
            throw new Error(`Invalid world state object ${id} position`);
        }
        record.position = {
            rx: tile.rx,
            ry: tile.ry,
            subCell: Number.isSafeInteger(object.position.subCell) ? object.position.subCell : 0,
            tileElevation: isFiniteNumber(object.position.tileElevation) ? object.position.tileElevation : 0,
            worldY: isFiniteNumber(object.position.worldPosition?.y) ? object.position.worldPosition.y : 0,
        };
    }
    if (!spawned && object?.limboData) {
        record.limbo = {
            selected: object.limboData.selected === true,
            ...(Number.isSafeInteger(object.limboData.controlGroup)
                ? { controlGroup: object.limboData.controlGroup }
                : {}),
            inTransport: object.limboData.inTransport === true,
        };
    }
    return record;
}

function capturePlayer(player: any, index: number): WorldPlayerState {
    if (player?.playerListIndex !== index) {
        throw new Error(`Cannot capture world state: player slot ${index} is not canonical`);
    }
    const unitsBuilt: Record<string, number> = {};
    const unitsKilled: Record<string, number> = {};
    const unitsLost: Record<string, number> = {};
    for (const type of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const built = player.getUnitsBuilt?.(type);
        const killed = player.getUnitsKilled?.(type);
        const lost = player.getUnitsLost?.(type);
        if (typeof built === "number") unitsBuilt[String(type)] = built;
        if (typeof killed === "number") unitsKilled[String(type)] = killed;
        if (typeof lost === "number") unitsLost[String(type)] = lost;
    }
    return {
        index,
        credits: player.credits,
        score: player.score,
        defeated: player.defeated === true,
        resigned: player.resigned === true,
        dropped: player.dropped === true,
        aresFirestormActive: player.aresFirestormActive === true,
        productionEnabled: player.productionEnabled !== false,
        aiTriggersEnabled: player.aiTriggersEnabled !== false,
        cheerCooldownTicks: Number.isSafeInteger(player.cheerCooldownTicks) ? player.cheerCooldownTicks : 0,
        ...(typeof player.captureBuildLimitState === "function"
            ? { buildLimitState: player.captureBuildLimitState() }
            : {}),
        unitsBuilt,
        unitsKilled,
        unitsLost,
        traits: (player?.traits?.getAll?.() ?? [])
            .map(captureTraitState)
            .filter((entry: WorldTraitState | undefined): entry is WorldTraitState => !!entry),
    };
}

function captureSelection(selection: any, resolveId: (object: any) => number): WorldSelectionState | undefined {
    if (!selection) {
        return undefined;
    }
    const selected = (selection.getSelectedUnits?.() ?? [])
        .map(resolveId)
        .filter((id: number) => Number.isSafeInteger(id))
        .sort((a, b) => a - b);
    const groups: [number, number[]][] = [];
    for (let group = 1; group <= 10; group++) {
        const units = selection.getGroupUnits?.(group) ?? [];
        const ids = units.map(resolveId).filter((id: number) => Number.isSafeInteger(id)).sort((a, b) => a - b);
        if (ids.length) {
            groups.push([group, ids]);
        }
    }
    return { selected, groups };
}

function captureTraitOwnerState(owner: any): WorldTraitOwnerState[] {
    return (owner?.traits?.getAll?.() ?? [])
        .map(captureTraitState)
        .filter((entry: WorldTraitState | undefined): entry is WorldTraitState => !!entry);
}

function parseObjectState(value: unknown, label: string): WorldObjectState {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid world state ${label}`);
    }
    const candidate = value as WorldObjectState;
    assertSafeId(candidate.id, `${label} id`);
    assertSafeId(candidate.type, `${label} type`);
    assertString(candidate.name, `${label} name`);
    if (candidate.ownerIndex !== null && !Number.isSafeInteger(candidate.ownerIndex)) {
        throw new Error(`Invalid world state ${label} owner`);
    }
    if (typeof candidate.spawned !== "boolean" || !candidate.core || !Array.isArray(candidate.traits)) {
        throw new Error(`Invalid world state ${label}`);
    }
    if (candidate.position) {
        const position = candidate.position;
        if (!Number.isSafeInteger(position.rx) || !Number.isSafeInteger(position.ry) ||
            !Number.isSafeInteger(position.subCell) || !isFiniteNumber(position.tileElevation) ||
            !isFiniteNumber(position.worldY)) {
            throw new Error(`Invalid world state ${label} position`);
        }
    }
    if (candidate.limbo && (typeof candidate.limbo.selected !== "boolean" ||
        typeof candidate.limbo.inTransport !== "boolean")) {
        throw new Error(`Invalid world state ${label} limbo data`);
    }
    if (candidate.attachedTraits !== undefined) {
        if (!Array.isArray(candidate.attachedTraits)) {
            throw new Error(`Invalid world state ${label} attached traits`);
        }
        const keys = new Set<string>();
        for (const entry of candidate.attachedTraits) {
            if (!entry || typeof entry.key !== "string" || entry.key.length === 0 ||
                !("context" in entry) || !("state" in entry)) {
                throw new Error(`Invalid world state ${label} attached trait entry`);
            }
            if (keys.has(entry.key)) {
                throw new Error(`Invalid world state ${label}: duplicate attached trait ${entry.key}`);
            }
            keys.add(entry.key);
        }
    }
    return candidate;
}

function parseWorldState(value: unknown): WorldStateSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid world state: expected an object");
    }
    const candidate = value as WorldStateSnapshot;
    if (candidate.version !== WORLD_STATE_SNAPSHOT_VERSION) {
        throw new Error(`Unsupported world state version: ${String((value as any).version)}`);
    }
    if (!Number.isSafeInteger(candidate.tick) || candidate.tick < 0 ||
        !Number.isSafeInteger(candidate.nextObjectId) || candidate.nextObjectId < 0 ||
        !Number.isSafeInteger(candidate.status) || !isFiniteNumber(candidate.currentTime) ||
        !candidate.prng || !Array.isArray(candidate.players) || !Array.isArray(candidate.objects) ||
        !Array.isArray(candidate.limboObjects) || !Array.isArray(candidate.alliances) ||
        typeof candidate.alliancesFixed !== "boolean" || !Array.isArray(candidate.traits)) {
        throw new Error("Invalid world state: malformed collections");
    }
    const ids = new Set<number>();
    for (const object of [...candidate.objects, ...candidate.limboObjects]) {
        const parsed = parseObjectState(object, "object");
        if (ids.has(parsed.id)) {
            throw new Error(`Invalid world state: duplicate object ${parsed.id}`);
        }
        ids.add(parsed.id);
    }
    const seenPlayerIndexes = new Set<number>();
    for (const player of candidate.players) {
        if (!player || !Number.isSafeInteger(player.index) || player.index < 0 ||
            !Number.isSafeInteger(player.credits) || player.credits < 0 ||
            !Number.isSafeInteger(player.score) || !Number.isSafeInteger(player.cheerCooldownTicks) ||
            !Array.isArray(player.traits)) {
            throw new Error("Invalid world state: player entry");
        }
        if (seenPlayerIndexes.has(player.index)) {
            throw new Error(`Invalid world state: duplicate player slot ${player.index}`);
        }
        seenPlayerIndexes.add(player.index);
    }
    if (candidate.teamState !== undefined) {
        const teamState = candidate.teamState as { version?: unknown; teams?: unknown };
        if (teamState.version !== 1 || !Array.isArray(teamState.teams)) {
            throw new Error("Invalid world state: team state");
        }
    }
    if (candidate.secretLabState !== undefined) {
        const secretLabState = candidate.secretLabState as { version?: unknown };
        if (secretLabState.version !== 1) {
            throw new Error("Invalid world state: secret lab state");
        }
    }
    return candidate;
}

function restorePlayer(
    player: any,
    state: WorldPlayerState,
    options: WorldStateRestoreOptions,
    context?: unknown,
): void {
    const strict = options.strict === true;
    if (strict && player.playerListIndex !== state.index) {
        throw new Error(`Cannot restore world state: player slot ${state.index} identity changed`);
    }
    player.credits = state.credits;
    player.score = state.score;
    player.defeated = state.defeated;
    player.resigned = state.resigned;
    player.dropped = state.dropped;
    player.aresFirestormActive = state.aresFirestormActive;
    player.productionEnabled = state.productionEnabled;
    player.aiTriggersEnabled = state.aiTriggersEnabled;
    player.cheerCooldownTicks = state.cheerCooldownTicks;
    if (state.buildLimitState !== undefined && typeof player.restoreBuildLimitState === "function") {
        if (strict) player.validateBuildLimitState(state.buildLimitState);
        player.restoreBuildLimitState(state.buildLimitState);
    }
    for (let type = 0; type <= 9; type++) {
        player.restoreUnitsBuiltState?.(type, 0);
        player.restoreUnitsKilledState?.(type, 0);
        player.restoreUnitsLostState?.(type, 0);
    }
    for (const [key, value] of Object.entries(state.unitsBuilt)) {
        player.restoreUnitsBuiltState?.(Number(key), value);
    }
    for (const [key, value] of Object.entries(state.unitsKilled)) {
        player.restoreUnitsKilledState?.(Number(key), value);
    }
    for (const [key, value] of Object.entries(state.unitsLost)) {
        player.restoreUnitsLostState?.(Number(key), value);
    }
    const used = new Set<any>();
    for (const entry of state.traits) {
        const trait = findTrait(player, entry.key, used);
        if (!trait) {
            if (options.strict) throw new Error(`Cannot restore player trait ${entry.key}`);
            continue;
        }
        used.add(trait);
        const method = typeof trait.restoreState === "function"
            ? "restoreState"
            : typeof trait.deserialize === "function"
                ? "deserialize"
                : undefined;
        if (!method) {
            if (options.strict) throw new Error(`Cannot restore player trait ${entry.key}`);
            continue;
        }
        trait[method](entry.state, context);
    }
}

function findTrait(object: any, key: string, used: Set<any>): any {
    const traits = object?.traits?.getAll?.() ?? [];
    return traits.find((trait: any) => !used.has(trait) && objectKey(trait) === key);
}

function restoreObjectCore(object: any, state: WorldObjectState): void {
    const core = state.core;
    object.isCrashing = core.isCrashing === true;
    object.isDestroyed = core.isDestroyed === true;
    object.isDisposed = core.isDisposed === true;
    object.deathType = core.deathType;
    for (const field of [
        "direction",
        "zone",
        "onBridge",
        "isFiring",
        "isPanicked",
        "guardMode",
        "purchaseValue",
        "infDeathType",
        "spinVelocity",
        "turretNo",
        "isSinker",
        "pitch",
        "yaw",
        "roll",
        "overlayId",
        "value",
        "radarInvisible",
    ]) {
        if (Object.prototype.hasOwnProperty.call(core, field)) {
            object[field] = core[field];
        }
    }
    if (core.stance !== undefined && object.isInfantry?.()) {
        object.stance = core.stance;
    }
    if (core.healthHitPoints !== undefined && object.healthTrait?.setHitPoints) {
        object.healthTrait.setHitPoints(core.healthHitPoints);
    }
    if (core.veteranState !== undefined && object.veteranTrait?.restoreState) {
        object.veteranTrait.restoreState(core.veteranState);
    }
    if (core.ammoState !== undefined && object.ammoTrait?.restoreState) {
        object.ammoTrait.restoreState(core.ammoState);
    }
    if (core.poweredOn !== undefined && object.poweredTrait?.setTurnedOn) {
        object.poweredTrait.setTurnedOn(core.poweredOn === true);
    }
}

function restoreObjectTraits(object: any, states: WorldTraitState[], strict: boolean, context?: unknown): void {
    const used = new Set<any>();
    for (const entry of states) {
        const trait = findTrait(object, entry.key, used);
        if (!trait) {
            if (strict) {
                throw new Error(`Cannot restore world state: object ${object.id} trait ${entry.key} is unresolved`);
            }
            continue;
        }
        used.add(trait);
        const method = typeof trait.restoreState === "function"
            ? "restoreState"
            : typeof trait.deserialize === "function"
                ? "deserialize"
                : undefined;
        if (!method) {
            if (strict) {
                throw new Error(`Cannot restore world state: object ${object.id} trait ${entry.key} is not restorable`);
            }
            continue;
        }
        trait[method](entry.state, context);
    }
}

function resolveTile(game: any, state: WorldObjectState): any {
    if (!state.position) {
        return undefined;
    }
    return game?.map?.tiles?.getByMapCoords?.(state.position.rx, state.position.ry);
}

function setObjectPosition(object: any, state: WorldObjectState, tile: any): void {
    if (!state.position || !tile) {
        return;
    }
    const position = object.position;
    // Tile, sub-cell and tile elevation are the authoritative inputs: the
    // world Y is derived from them (including ramp interpolation), so
    // restoring an absolute elevation instead would discard the ramp and
    // bridge contribution and silently move the object.
    position.tile = tile;
    position.subCell = state.position.subCell;
    position.tileElevation = state.position.tileElevation;
}

function restoreObjectMembership(object: any, state: WorldObjectState, game: any, options: WorldStateRestoreOptions): void {
    const tile = resolveTile(game, state);
    if (state.spawned) {
        if (!tile) {
            throw new Error(`Cannot restore world state: object ${object.id} tile is unresolved`);
        }
        if (object.limboData) {
            options.unspawnObject?.(object);
            object.limboData = undefined;
        }
        if (!object.isSpawned) {
            options.spawnObject?.(object, tile);
        }
        else if (object.position.tile !== tile) {
            const oldTile = object.position.tile;
            if (oldTile && !object.isProjectile?.() && !object.isDebris?.()) {
                game.map.tileOccupation.unoccupyTileRange(oldTile, object);
            }
            setObjectPosition(object, state, tile);
            if (!object.isProjectile?.() && !object.isDebris?.()) {
                game.map.tileOccupation.occupyTileRange(tile, object);
            }
            game.map.technosByTile?.updateObject?.(object);
        }
        else {
            setObjectPosition(object, state, tile);
        }
        object.limboData = undefined;
    }
    else {
        if (object.isSpawned) {
            options.unspawnObject?.(object);
        }
        object.limboData = state.limbo ?? { selected: false, inTransport: false };
    }
}

export function captureWorldState(game: any): WorldStateSnapshot {
    const players = (game?.playerList?.getAll?.() ?? []).map((player: any, index: number) => capturePlayer(player, index));
    const objects = (game?.world?.getAllObjects?.() ?? []).map((object: any) => captureObject(object, game, true));
    const limboById = new Map<number, any>();
    for (const player of game?.playerList?.getAll?.() ?? []) {
        for (const object of player.getOwnedObjects?.(true) ?? []) {
            if (object?.limboData) {
                limboById.set(object.id, object);
            }
        }
    }
    const limboObjects = [...limboById.values()]
        .filter((object: any) => !game?.world?.hasObjectId?.(object.id))
        .map((object: any) => captureObject(object, game, false))
        .sort((a, b) => a.id - b.id);
    const resolveId = (object: any): number => object?.id;
    const selection = captureSelection(game?.unitSelection, resolveId);
    const allianceState = game?.alliances?.captureState?.();
    const alliances = (allianceState?.alliances ?? []).map((entry: any) => ({
        first: entry.first,
        second: entry.second,
        status: entry.status,
    }));
    return {
        version: WORLD_STATE_SNAPSHOT_VERSION,
        tick: game.currentTick,
        currentTime: game.currentTime,
        nextObjectId: game.nextObjectId.value,
        status: game.status,
        prng: game.prng.captureState(),
        players,
        objects: objects.sort((a, b) => a.id - b.id),
        limboObjects,
        alliances,
        alliancesFixed: allianceState?.fixed === true,
        ...(selection ? { selection } : {}),
        ...(game?.teamRuntime?.captureState ? { teamState: game.teamRuntime.captureState() } : {}),
        ...(game?.aresSecretLabService?.captureState
            ? { secretLabState: game.aresSecretLabService.captureState() }
            : {}),
        traits: captureTraitOwnerState(game?.traits),
    };
}

export function validateWorldState(state: unknown): WorldStateSnapshot {
    return parseWorldState(state);
}

export function restoreWorldState(game: any, state: unknown, options: WorldStateRestoreOptions = {}): void {
    const parsed = parseWorldState(state);
    const strict = options.strict === true;
    const playerList = game?.playerList?.getAll?.() ?? [];
    const resolvePlayer = options.resolvePlayerByIndex ?? ((index: number) => playerList[index]);
    const resolveObject = options.resolveObjectById ?? ((id: number) => {
        try {
            const worldObject = game?.world?.getObjectById?.(id);
            if (worldObject) return worldObject;
        }
        catch {
        }
        for (const player of playerList) {
            const owned = player?.getOwnedObjects?.(true)?.find((object: any) => object?.id === id);
            if (owned) return owned;
        }
        return undefined;
    });
    if (strict && parsed.players.length !== playerList.length) {
        throw new Error(
            `Cannot restore world state: player set is incomplete (${parsed.players.length} of ${playerList.length})`,
        );
    }
    const players = parsed.players.map((entry) => {
        const player = resolvePlayer(entry.index);
        if (!player) {
            throw new Error(`Cannot restore world state: player slot ${entry.index} is unresolved`);
        }
        if (player.playerListIndex !== entry.index) {
            throw new Error(
                `Cannot restore world state: player slot ${entry.index} identity changed to ${player.playerListIndex}`,
            );
        }
        return { player, entry };
    });
    const snapshotIds = new Set(
        [...parsed.objects, ...parsed.limboObjects].map((entry) => entry.id),
    );
    for (const entry of parsed.players) {
        const player = resolvePlayer(entry.index);
        if (!player) throw new Error(`Cannot restore world state: player slot ${entry.index} is unresolved`);
        const expectedOwned = new Set<number>();
        for (const objectState of [...parsed.objects, ...parsed.limboObjects]) {
            if (objectState.ownerIndex === entry.index) expectedOwned.add(objectState.id);
        }
        for (const object of player.getOwnedObjects?.(true) ?? []) {
            if (!expectedOwned.has(object.id)) {
                if (strict) throw new Error(`Cannot restore world state: object ${object.id} ownership is unresolved`);
                player.removeOwnedObject(object);
            }
        }
    }
    const objectMap = new Map<number, any>();
    for (const object of game?.world?.getAllObjects?.() ?? []) {
        if (!snapshotIds.has(object.id)) {
            if (strict) {
                throw new Error(`Cannot restore world state: object ${object.id} is absent from the snapshot`);
            }
            options.unspawnObject?.(object);
            object.owner?.removeOwnedObject?.(object);
        }
    }
    for (const player of playerList) {
        for (const object of player.getOwnedObjects?.(true) ?? []) {
            if (!snapshotIds.has(object.id)) {
                if (strict) {
                    throw new Error(`Cannot restore world state: limbo object ${object.id} is absent from the snapshot`);
                }
                player.removeOwnedObject?.(object);
                object.dispose?.();
            }
        }
    }
    for (const objectState of [...parsed.objects, ...parsed.limboObjects]) {
        let object = resolveObject(objectState.id);
        if (!object && options.createObject) {
            object = options.createObject(objectState.type, objectState.name);
            if (object) object.id = objectState.id;
        }
        if (!object) {
            throw new Error(`Cannot restore world state: object ${objectState.id} is unresolved`);
        }
        if (object.type !== objectState.type || object.name !== objectState.name) {
            throw new Error(`Cannot restore world state: object ${objectState.id} identity changed`);
        }
        objectMap.set(objectState.id, object);
        const owner = objectState.ownerIndex === null ? undefined : resolvePlayer(objectState.ownerIndex);
        if (objectState.ownerIndex !== null && !owner) {
            throw new Error(`Cannot restore world state: object ${objectState.id} owner is unresolved`);
        }
        if (owner && object.owner !== owner) {
            if (typeof game?.changeObjectOwner === "function") game.changeObjectOwner(object, owner);
            else object.owner = owner;
        }
        restoreObjectMembership(object, objectState, game, options);
        restoreObjectCore(object, objectState);
    }
    const traitContext = {
        game,
        gameObject: undefined as any,
        strict,
        resolveObjectById: resolveObject,
        resolvePlayerByIndex: resolvePlayer,
        resolveTile: (x: number, y: number) => game?.map?.tiles?.getByMapCoords?.(x, y),
        createTarget: (object: any, tile: any) => game?.createTarget?.(object, tile),
        resolveRules: (name: string, type: number) => game?.rules?.getObject?.(name, type),
        resolvePowerup: (type: string) => (game?.rules?.powerups?.powerups ?? [])
            .find((powerup: any) => String(powerup?.type ?? "") === String(type)),
    };
    for (const { player, entry } of players) {
        restorePlayer(player, entry, options, traitContext);
    }
    for (const objectState of [...parsed.objects, ...parsed.limboObjects]) {
        const object = objectMap.get(objectState.id);
        if (object) {
            const objectContext = { ...traitContext, gameObject: object };
            restoreObjectTraits(object, objectState.traits, strict, objectContext);
            for (const entry of objectState.attachedTraits ?? []) {
                const factory = getObjectTraitFactory(entry.key);
                if (!factory) {
                    if (strict) {
                        throw new Error(
                            `Cannot restore world state: object ${object.id} attached trait ${entry.key} has no factory`,
                        );
                    }
                    continue;
                }
                const alreadyAttached = (object?.traits?.getAll?.() ?? [])
                    .some((trait: any) => getRuntimeAttachKey(trait) === entry.key);
                if (alreadyAttached) {
                    if (strict) {
                        throw new Error(
                            `Cannot restore world state: object ${object.id} already has attached trait ${entry.key}`,
                        );
                    }
                    continue;
                }
                const trait = factory(entry.context, game);
                if (!trait) {
                    if (strict) {
                        throw new Error(
                            `Cannot restore world state: object ${object.id} attached trait ${entry.key} factory failed`,
                        );
                    }
                    continue;
                }
                if (typeof game?.addObjectTrait === "function") {
                    game.addObjectTrait(object, trait);
                }
                else if (object?.traits?.add === "function") {
                    object.traits.add(trait);
                }
                if (typeof trait.restoreState === "function") {
                    trait.restoreState(entry.state, objectContext);
                }
            }
        }
    }
    if (typeof game?.alliances?.restoreState === "function") {
        game.alliances.restoreState({
            version: 1,
            fixed: parsed.alliancesFixed,
            alliances: parsed.alliances,
        });
    }
    if (parsed.teamState !== undefined) {
        if (typeof game?.teamRuntime?.validateState !== "function" || typeof game.teamRuntime.restoreState !== "function") {
            throw new Error("Cannot restore world state: team runtime is unresolved");
        }
        game.teamRuntime.validateState(parsed.teamState);
        game.teamRuntime.restoreState(parsed.teamState, {
            strict,
            resolveObjectById: id => objectMap.get(id),
        });
    }
    if (parsed.secretLabState !== undefined) {
        const service = game?.aresSecretLabService;
        if (!service || typeof service.validateState !== "function" || typeof service.restoreState !== "function") {
            throw new Error("Cannot restore world state: secret lab runtime is unresolved");
        }
        service.validateState(parsed.secretLabState);
        service.restoreState(parsed.secretLabState, { strict });
    }
    if (parsed.selection && game?.unitSelection?.restoreState) {
        game.unitSelection.restoreState(parsed.selection, {
            resolveObjectById: id => objectMap.get(id),
            strict,
        });
    }
    if (parsed.traits.length) {
        const used = new Set<any>();
        for (const entry of parsed.traits) {
            const trait = findTrait(game, entry.key, used);
            if (!trait) {
                if (strict) throw new Error(`Cannot restore world state: world trait ${entry.key} is unresolved`);
                continue;
            }
            used.add(trait);
            const method = typeof trait.restoreState === "function"
                ? "restoreState"
                : typeof trait.deserialize === "function"
                    ? "deserialize"
                    : undefined;
            if (!method) {
                if (strict) throw new Error(`Cannot restore world state: world trait ${entry.key} is not restorable`);
                continue;
            }
            trait[method](entry.state, traitContext);
        }
    }
    game.currentTick = parsed.tick;
    game.currentTime = parsed.currentTime;
    game.status = parsed.status;
    game.nextObjectId.value = parsed.nextObjectId;
    game.prng.restoreState(parsed.prng);
}
