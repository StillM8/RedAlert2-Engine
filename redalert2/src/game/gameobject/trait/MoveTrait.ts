import { fnv32aStrings } from "@/util/math";
import { scalarStateHash, STATE_HASH_HOST_KEYS } from "@/util/stateHash";

/** A path cell, serialized by map coordinates rather than by tile identity. */
export interface MoveTraitPathCellState {
    rx: number;
    ry: number;
    onBridge: boolean;
}

export interface MoveTraitState {
    version: 1;
    disabled: boolean;
    chronoAftereffectLocked?: boolean;
    speedPenalty: number;
    moveState: number;
    collisionState: number;
    velocity: unknown;
    lastVelocity: unknown;
    lastTeleportTick?: number;
    lastMoveResult?: number;
    lastTargetOffset?: unknown;
    /** Private locomotor phase/cursor/velocity-turn state; patched onto the live locomotor. */
    locomotorState?: unknown;
    /**
     * Legacy presence markers. Version-1 snapshots written before in-flight
     * path restore existed carry only these two counts; strict restore still
     * refuses them, because a count cannot reconstruct the reserved cells.
     */
    reservedPathNodeCount?: number;
    hasWaypoint?: boolean;
    /**
     * The actual reserved cells and the active waypoint. These are restored
     * by re-resolving each map cell and re-registering the reservation, so a
     * checkpoint taken while a unit is moving no longer has to be refused.
     */
    reservedPathNodes?: MoveTraitPathCellState[];
    currentWaypoint?: MoveTraitPathCellState | null;
}

function capturePathCell(cell: any): MoveTraitPathCellState | null {
    if (!cell?.tile || !Number.isSafeInteger(cell.tile.rx) || !Number.isSafeInteger(cell.tile.ry)) {
        return null;
    }
    return { rx: cell.tile.rx, ry: cell.tile.ry, onBridge: !!cell.onBridge };
}

function validatePathCell(value: unknown, label: string): MoveTraitPathCellState {
    const cell = value as MoveTraitPathCellState;
    if (!cell || !Number.isSafeInteger(cell.rx) || cell.rx < 0 ||
        !Number.isSafeInteger(cell.ry) || cell.ry < 0 ||
        typeof cell.onBridge !== "boolean") {
        throw new Error(`Invalid move state: ${label}`);
    }
    return { rx: cell.rx, ry: cell.ry, onBridge: cell.onBridge };
}

/** Canonical identities cross worlds as markers, never as walked internals. */
function serializeScalarTree(value: unknown): unknown {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
        return value;
    }
    if (typeof value !== "object") return undefined;
    const object = value as any;
    if (Array.isArray(object)) {
        return object.map((item) => serializeScalarTree(item)).filter((item) => item !== undefined);
    }
    const out: Record<string, unknown> = {};
    if (typeof object.playerListIndex === "number") {
        out.$player = object.playerListIndex;
    }
    else if (typeof object.id === "number") {
        out.$id = object.id;
    }
    for (const key of Object.keys(object).sort()) {
        if (STATE_HASH_HOST_KEYS.has(key)) continue;
        const serialized = serializeScalarTree(object[key]);
        if (serialized !== undefined) out[key] = serialized;
    }
    return out;
}

function restoreScalarTree(live: any, tree: unknown): any {
    if (tree === undefined || tree === null) return live;
    if (typeof tree !== "object") return tree;
    if (Array.isArray(tree)) {
        return tree.map((item, index) => restoreScalarTree(live?.[index], item));
    }
    const target = live && typeof live === "object" ? live : {};
    for (const key of Object.keys(tree as object)) {
        if (key === "$id" || key === "$player") continue;
        target[key] = restoreScalarTree(target[key], (tree as any)[key]);
    }
    return target;
}

/**
 * Non-mutating resolve pass: canonical identity markers must match the live
 * references before anything is applied (strict restore contract).
 */
function validateScalarTree(live: any, tree: unknown, label: string): void {
    if (tree === undefined || tree === null || typeof tree !== "object") return;
    if (Array.isArray(tree)) {
        tree.forEach((item, index) => validateScalarTree(live?.[index], item, `${label}[${index}]`));
        return;
    }
    const record = tree as any;
    if (typeof record.$id === "number" && live?.id !== record.$id) {
        throw new Error(`Cannot restore move state: ${label} identity ${record.$id} is unresolved`);
    }
    if (typeof record.$player === "number" && live?.playerListIndex !== record.$player) {
        throw new Error(`Cannot restore move state: ${label} player identity ${record.$player} is unresolved`);
    }
    for (const key of Object.keys(record)) {
        if (key === "$id" || key === "$player") continue;
        validateScalarTree(live?.[key], record[key], `${label}.${key}`);
    }
}
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { ZoneType, getZoneType } from "@/game/gameobject/unit/ZoneType";
import { InfDeathType } from "@/game/gameobject/infantry/InfDeathType";
import { ObjectTeleportEvent } from "@/game/event/ObjectTeleportEvent";
import { DeathType } from "@/game/gameobject/common/DeathType";
import { NotifyTeleport } from "@/game/gameobject/trait/interface/NotifyTeleport";
import { LocomotorType } from "@/game/type/LocomotorType";
import { JumpjetLocomotor } from "@/game/gameobject/locomotor/JumpjetLocomotor";
import { SpeedType } from "@/game/type/SpeedType";
import { WingedLocomotor } from "@/game/gameobject/locomotor/WingedLocomotor";
import { StanceType } from "@/game/gameobject/infantry/StanceType";
import { NotifyTileChange as GlobalNotifyTileChange } from "@/game/trait/interface/NotifyTileChange";
import { NotifyTileChange } from "@/game/gameobject/trait/interface/NotifyTileChange";
import { EnterTileEvent } from "@/game/event/EnterTileEvent";
import { Vector3 } from "@/game/math/Vector3";
import { NotifyElevationChange } from "@/game/trait/interface/NotifyElevationChange";
import { Target } from "@/game/Target";
import {
    resolveAresAttachEffectCombat,
    type AresAttachEffectAggregateInput,
} from "@/extensions/ares/AresAttachEffectCombat";
interface GameObject {
    rules: any;
    veteranTrait?: any;
    aresAttachEffectTrait?: {
        getAggregateMultipliers(): AresAttachEffectAggregateInput;
    };
    crateBonuses: any;
    healthTrait: any;
    position: any;
    tile: any;
    tileElevation: number;
    direction: number;
    zone: ZoneType;
    onBridge: boolean;
    owner: any;
    crusher: boolean;
    spinVelocity: number;
    traits: any[];
    turretTrait?: any;
    attackTrait?: any;
    unitOrderTrait: any;
    moveTrait: MoveTrait;
    stance?: StanceType;
    infDeathType?: InfDeathType;
    deathType?: DeathType;
    isDestroyed: boolean;
    isVehicle(): boolean;
    isAircraft(): boolean;
    isUnit(): boolean;
    isInfantry(): boolean;
    isTechno(): boolean;
    isOverlay(): boolean;
    applyRocking(x: number, y: number): void;
}
interface TileOccupation {
    unoccupyTileRange(tile: any, obj: GameObject): void;
    occupyTileRange(tile: any, obj: GameObject): void;
    occupySingleTile(tile: any, obj: GameObject): void;
    getBridgeOnTile(tile: any): any;
    getGroundObjectsOnTile(tile: any): GameObject[];
    unoccupySingleTile(tile: any, obj: GameObject): void;
    tiles?: { getByMapCoords(rx: number, ry: number): any };
}
interface GameState {
    currentTick: number;
    map: any;
    rules: any;
    events: any;
    traits: any[];
    crateGeneratorTrait: any;
    areFriendly(a: GameObject, b: GameObject): boolean;
    destroyObject(obj: GameObject, source: any): void;
}
interface Task {
    children: Task[];
}
interface PathNode {
    tile: any;
    onBridge?: any;
}
interface Waypoint {
}
export enum MoveState {
    Idle = 0,
    ReachedNextWaypoint = 1,
    PlanMove = 2,
    Moving = 3
}
export enum MoveResult {
    Success = 0,
    Cancel = 1,
    CloseEnough = 2,
    Fail = 3
}
export enum CollisionState {
    Waiting = 0,
    Resolved = 1
}
const isMoveTask = (task: Task): boolean => {
    // Keep movement-state tracking independent from the concrete MoveTask
    // module. MoveTask depends on MoveTrait's state enums, so importing the
    // class here creates an initialization cycle in test/runtime bundles.
    // The marker is inherited by specialized movement tasks and preserves the
    // previous recursive child-task behavior without coupling the modules.
    return (task as any).isMoveTask === true ||
        (!!task.children?.[0] && isMoveTask(task.children[0]));
};
export class MoveTrait {
    private gameObject: GameObject;
    private tileOccupation: TileOccupation;
    private disabled: boolean = false;
    private chronoAftereffectLocked: boolean = false;
    private speedPenalty: number = 0;
    private velocity: Vector3 = new Vector3();
    private reservedPathNodes: PathNode[] = [];
    private moveState: MoveState = MoveState.Idle;
    private collisionState: CollisionState = CollisionState.Resolved;
    private locomotor?: any;
    private currentWaypoint?: Waypoint;
    private lastTargetOffset?: any;
    private lastVelocity?: Vector3;
    private lastMoveResult?: MoveResult;
    private lastTeleportTick?: number;
    get baseSpeed(): number {
        const baseSpeed = this.gameObject.rules.speed *
            (this.gameObject.veteranTrait?.getVeteranSpeedMultiplier() ?? 1) *
            this.gameObject.crateBonuses.speed *
            (this.gameObject.isVehicle() &&
                this.gameObject.healthTrait.health <= 50 &&
                this.gameObject.rules.locomotor !== LocomotorType.Hover
                ? 0.75
                : 1) *
            (1 - this.speedPenalty);
        return resolveAresAttachEffectCombat(
            { speed: baseSpeed },
            this.gameObject.aresAttachEffectTrait?.getAggregateMultipliers(),
        ).effective.speed;
    }
    constructor(gameObject: GameObject, tileOccupation: TileOccupation) {
        this.gameObject = gameObject;
        this.tileOccupation = tileOccupation;
    }
    /**
     * Canonical movement state for the lockstep hash. Velocity, movement and
     * collision phases, path reservations, and the active locomotor's private
     * state all change future simulation results; previously this trait
     * contributed nothing to `GameObject.getHash()` (see
     * docs/DeterministicStateCoverage.md, Locomotors row).
     */
    getHash(): number {
        return fnv32aStrings([
            "MoveTrait",
            this.disabled ? 1 : 0,
            this.chronoAftereffectLocked ? 1 : 0,
            this.speedPenalty,
            this.moveState,
            this.collisionState,
            this.lastTeleportTick ?? -1,
            this.lastMoveResult ?? -1,
            scalarStateHash("velocity", this.velocity),
            scalarStateHash("lastVelocity", this.lastVelocity),
            scalarStateHash("waypoint", this.currentWaypoint),
            scalarStateHash("pathNodes", this.reservedPathNodes),
            scalarStateHash("locomotor", this.locomotor),
            scalarStateHash("targetOffset", this.lastTargetOffset),
        ]);
    }

    /**
     * Versioned movement slice (the Locomotors row of
     * docs/DeterministicStateCoverage.md). Path reservations and waypoints are
     * live pathfinding references: they are counted, never fabricated, and
     * strict restore refuses snapshots holding them (restore only at rest).
     */
    captureState(): MoveTraitState {
        return {
            version: 1,
            disabled: this.disabled,
            chronoAftereffectLocked: this.chronoAftereffectLocked,
            speedPenalty: this.speedPenalty,
            moveState: this.moveState,
            collisionState: this.collisionState,
            velocity: serializeScalarTree(this.velocity),
            lastVelocity: serializeScalarTree(this.lastVelocity),
            lastTeleportTick: this.lastTeleportTick,
            lastMoveResult: this.lastMoveResult,
            lastTargetOffset: serializeScalarTree(this.lastTargetOffset),
            locomotorState: this.locomotor ? serializeScalarTree(this.locomotor) : undefined,
            reservedPathNodes: this.reservedPathNodes
                .map(capturePathCell)
                .filter((cell): cell is MoveTraitPathCellState => cell !== null),
            currentWaypoint: capturePathCell(this.currentWaypoint),
        };
    }

    /**
     * Transactional restore: identity markers and locomotor presence resolve
     * before any mutation. Strict mode additionally refuses in-flight path
     * state on either side of the restore.
     */
    validateState(state: unknown, options: { strict?: boolean } = {}): MoveTraitState {
        if (!state || typeof state !== "object") {
            throw new Error("Invalid move state: expected an object");
        }
        const parsed = state as MoveTraitState;
        if (parsed.version !== 1) {
            throw new Error(`Unsupported move state version: ${String((state as any).version)}`);
        }
        if (typeof parsed.disabled !== "boolean" ||
            (parsed.chronoAftereffectLocked !== undefined && typeof parsed.chronoAftereffectLocked !== "boolean") ||
            typeof parsed.speedPenalty !== "number" || !Number.isFinite(parsed.speedPenalty) ||
            !Number.isSafeInteger(parsed.moveState) || parsed.moveState < MoveState.Idle || parsed.moveState > MoveState.Moving ||
            !Number.isSafeInteger(parsed.collisionState) || parsed.collisionState < CollisionState.Waiting || parsed.collisionState > CollisionState.Resolved) {
            throw new Error("Invalid move state: scalar fields");
        }
        if (parsed.reservedPathNodes !== undefined) {
            if (!Array.isArray(parsed.reservedPathNodes)) {
                throw new Error("Invalid move state: reservedPathNodes");
            }
            parsed.reservedPathNodes = parsed.reservedPathNodes
                .map((cell, index) => validatePathCell(cell, `reservedPathNodes[${index}]`));
        }
        if (parsed.currentWaypoint !== undefined && parsed.currentWaypoint !== null) {
            parsed.currentWaypoint = validatePathCell(parsed.currentWaypoint, "currentWaypoint");
        }
        for (const value of [parsed.lastTeleportTick, parsed.lastMoveResult]) {
            if (value !== undefined && !Number.isSafeInteger(value)) {
                throw new Error("Invalid move state: optional tick");
            }
        }
        const strict = options.strict === true;
        // A legacy snapshot carries only counts, which cannot reconstruct the
        // reserved cells, so an in-flight legacy checkpoint is still refused.
        // Current snapshots carry the cells and are restored below.
        if (parsed.reservedPathNodes === undefined && parsed.currentWaypoint === undefined && strict &&
            ((parsed.reservedPathNodeCount ?? 0) > 0 || parsed.hasWaypoint === true ||
                this.reservedPathNodes.length > 0 || this.currentWaypoint !== undefined)) {
            throw new Error("Cannot restore move state: in-flight path state is not restorable");
        }
        // Every referenced cell must resolve before anything is mutated, so a
        // bad checkpoint cannot leave a half-applied reservation set behind.
        if (strict) {
            for (const [index, cell] of (parsed.reservedPathNodes ?? []).entries()) {
                this.resolvePathCell(cell, `reservedPathNodes[${index}]`);
            }
            if (parsed.currentWaypoint) {
                this.resolvePathCell(parsed.currentWaypoint, "currentWaypoint");
            }
        }
        if (parsed.locomotorState !== undefined && !this.locomotor && strict) {
            throw new Error("Cannot restore move state: locomotor is unresolved");
        }
        if (strict) {
            validateScalarTree(this.velocity, parsed.velocity, "velocity");
            validateScalarTree(this.lastVelocity, parsed.lastVelocity, "lastVelocity");
            validateScalarTree(this.lastTargetOffset, parsed.lastTargetOffset, "lastTargetOffset");
            if (parsed.locomotorState !== undefined && this.locomotor) {
                validateScalarTree(this.locomotor, parsed.locomotorState, "locomotor");
            }
        }
        return parsed;
    }

    restoreState(state: unknown, options: { strict?: boolean } = {}): void {
        const parsed = this.validateState(state, options);
        const strict = options.strict === true;
        this.disabled = parsed.disabled;
        this.chronoAftereffectLocked = parsed.chronoAftereffectLocked ?? false;
        this.speedPenalty = parsed.speedPenalty;
        this.moveState = parsed.moveState;
        this.collisionState = parsed.collisionState;
        this.lastTeleportTick = parsed.lastTeleportTick;
        this.lastMoveResult = parsed.lastMoveResult;
        restoreScalarTree(this.velocity, parsed.velocity);
        if (parsed.lastVelocity === undefined) {
            this.lastVelocity = undefined;
        }
        else {
            this.lastVelocity = restoreScalarTree(this.lastVelocity, parsed.lastVelocity);
        }
        this.lastTargetOffset = parsed.lastTargetOffset === undefined
            ? undefined
            : restoreScalarTree(this.lastTargetOffset, parsed.lastTargetOffset);
        if (parsed.locomotorState !== undefined && this.locomotor) {
            restoreScalarTree(this.locomotor, parsed.locomotorState);
        }
        if (parsed.reservedPathNodes !== undefined) {
            // The live reservations belong to the pre-restore world and must be
            // released before new ones are registered, or the tile occupation
            // grid would keep both sets.
            this.unreservePathNodes();
            for (const cell of parsed.reservedPathNodes) {
                const tile = this.resolvePathCell(cell, "reservedPathNode");
                if (!tile) continue;
                const node: PathNode = { tile, ...(cell.onBridge ? { onBridge: true } : {}) };
                this.reservedPathNodes.push(node);
                this.tileOccupation.occupySingleTile(tile, this.gameObject);
            }
        }
        else {
            this.unreservePathNodes();
        }
        if (parsed.currentWaypoint === undefined || parsed.currentWaypoint === null) {
            this.currentWaypoint = undefined;
        }
        else {
            const tile = this.resolvePathCell(parsed.currentWaypoint, "currentWaypoint");
            this.currentWaypoint = tile === undefined
                ? undefined
                : {
                    tile,
                    ...(parsed.currentWaypoint.onBridge ? { onBridge: true } : {}),
                };
        }
    }

    private resolvePathCell(cell: MoveTraitPathCellState, label: string): any {
        const tile = this.gameObject?.position?.tiles?.getByMapCoords?.(cell.rx, cell.ry) ??
            this.tileOccupation?.tiles?.getByMapCoords?.(cell.rx, cell.ry);
        if (!tile) {
            throw new Error(
                `Cannot restore move state: ${label} ${cell.rx},${cell.ry} is unresolved`,
            );
        }
        return tile;
    }

    isDisabled(): boolean {
        return this.disabled;
    }
    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
    }
    isChronoAftereffectLocked(): boolean {
        return this.chronoAftereffectLocked;
    }
    setChronoAftereffectLocked(locked: boolean): void {
        this.chronoAftereffectLocked = locked;
    }
    isMoving(): boolean {
        return this.moveState === MoveState.Moving;
    }
    isIdle(): boolean {
        return this.moveState === MoveState.Idle;
    }
    isWaiting(): boolean {
        return this.collisionState === CollisionState.Waiting;
    }
    [NotifyTick.onTick](gameObject: GameObject, gameState: GameState): void {
        if (this.moveState !== MoveState.Idle && this.collisionState === CollisionState.Resolved) {
            const currentTask = gameObject.unitOrderTrait.getCurrentTask();
            if (!(currentTask && isMoveTask(currentTask))) {
                this.velocity.set(0, 0, 0);
                this.moveState = MoveState.Idle;
                this.locomotor = undefined;
                if (!currentTask &&
                    !gameObject.attackTrait?.currentTarget &&
                    gameObject.isVehicle() &&
                    gameObject.turretTrait) {
                    gameObject.turretTrait.desiredFacing = gameObject.direction;
                }
            }
        }
        if (this.moveState === MoveState.Idle) {
            if (gameObject.rules.locomotor === LocomotorType.Jumpjet) {
                JumpjetLocomotor.tickStationary(gameObject as any, gameState as any);
            }
            else if (gameObject.isAircraft() &&
                gameObject.rules.locomotor === LocomotorType.Aircraft) {
                WingedLocomotor.tickStationary(gameObject as any, gameState as any);
            }
        }
    }
    [NotifyDestroy.onDestroy](gameObject: GameObject, gameState: GameState): void {
        this.unreservePathNodes();
    }
    teleportUnitToTile(targetTile: any, bridge: any, fromTile: any, preserveMovement: boolean, gameState: GameState): void {
        const gameObject = this.gameObject;
        const oldTile = gameObject.tile;
        (gameObject.traits as any)
            .filter(NotifyTeleport)
            .forEach((trait: any) => {
            trait[NotifyTeleport.onBeforeTeleport](gameObject, gameState, fromTile, preserveMovement);
        });
        gameObject.position.tileElevation = gameObject.tileElevation;
        gameObject.position.tile = targetTile;
        gameObject.position.subCell = gameObject.position.desiredSubCell;
        this.handleTileChange(oldTile, bridge, true, gameState, true);
        if (!preserveMovement) {
            this.unreservePathNodes();
            this.speedPenalty = 0;
            this.velocity.set(0, 0, 0);
            this.moveState = MoveState.Idle;
            this.collisionState = CollisionState.Resolved;
            this.locomotor = undefined;
            this.currentWaypoint = undefined;
            this.lastTargetOffset = undefined;
            this.lastVelocity = undefined;
            this.lastMoveResult = MoveResult.Cancel;
            if (gameObject.isVehicle()) {
                gameObject.spinVelocity = 0;
                if (gameObject.turretTrait) {
                    gameObject.turretTrait.desiredFacing = gameObject.direction;
                }
            }
        }
        this.lastTeleportTick = gameState.currentTick;
        gameState.events.dispatch(new ObjectTeleportEvent(gameObject, fromTile, oldTile));
    }
    handleTileChange(oldTile: any, bridge: any, teleporting: boolean, gameState: GameState, isTeleport: boolean = false): void {
        const gameObject = this.gameObject;
        if (Target.usesGroundLayerUnderBridge(gameObject)) {
            bridge = undefined;
            if (gameObject.onBridge) {
                gameObject.onBridge = false;
                gameObject.position.tileElevation = 0;
                gameObject.zone = getZoneType(gameObject.tile.landType);
            }
        }
        gameState.map.tileOccupation.unoccupyTileRange(oldTile, gameObject);
        gameState.map.tileOccupation.occupyTileRange(gameObject.tile, gameObject);
        gameState.map.technosByTile.updateObject(gameObject);
        if (gameObject.zone !== ZoneType.Air) {
            const oldBridge = gameObject.onBridge ?
                gameState.map.tileOccupation.getBridgeOnTile(oldTile) : undefined;
            const oldLandType = gameObject.onBridge ?
                oldTile.onBridgeLandType : oldTile.landType;
            const newLandType = bridge ?
                gameObject.tile.onBridgeLandType : gameObject.tile.landType;
            if (oldLandType !== newLandType) {
                const speedModifier = gameState.rules
                    .getLandRules(newLandType)
                    .getSpeedModifier(gameObject.rules.speedType);
                if (speedModifier > 0 ||
                    gameObject.rules.speedType === SpeedType.Amphibious ||
                    isTeleport) {
                    gameObject.zone = getZoneType(newLandType);
                }
            }
            if (bridge !== oldBridge) {
                gameObject.position.tileElevation +=
                    -(oldBridge?.tileElevation ?? 0) + (bridge?.tileElevation ?? 0);
                gameObject.onBridge = !!bridge;
            }
            const nodeIndex = gameObject.moveTrait.reservedPathNodes.findIndex(node => node.tile === gameObject.tile);
            if (nodeIndex !== -1) {
                gameObject.moveTrait.reservedPathNodes.splice(nodeIndex, 1);
            }
            if (gameObject.crusher) {
                const crushableObjects = gameState.map
                    .getGroundObjectsOnTile(gameObject.tile)
                    .filter(obj => (!obj.isUnit() || obj.onBridge === gameObject.onBridge) &&
                    obj.rules.crushable &&
                    !(obj.isInfantry() && obj.stance === StanceType.Paradrop) &&
                    (!(obj.isTechno() && !teleporting) || !gameState.areFriendly(obj, gameObject)));
                for (const crushable of crushableObjects) {
                    if (!crushable.isDestroyed) {
                        if (crushable.isInfantry()) {
                            crushable.infDeathType = InfDeathType.None;
                        }
                        if (gameObject.isVehicle() &&
                            crushable.isOverlay() &&
                            crushable.rules.wall) {
                            gameObject.applyRocking(0, 0.5);
                        }
                        crushable.deathType = DeathType.Crush;
                        gameState.destroyObject(crushable, { player: gameObject.owner, obj: gameObject });
                    }
                }
            }
            if (!gameObject.onBridge) {
                const crate = gameState.map.tileOccupation
                    .getGroundObjectsOnTile(gameObject.tile)
                    .find(obj => obj.isOverlay() && obj.rules.crate);
                if (crate) {
                    gameState.crateGeneratorTrait.pickupCrate(gameObject, crate, gameState);
                }
            }
        }
        (gameState.traits as any)
            .filter(GlobalNotifyTileChange)
            .forEach((trait: any) => {
            trait[GlobalNotifyTileChange.onTileChange](gameObject, gameState, oldTile, isTeleport);
        });
        (gameObject.traits as any)
            .filter(NotifyTileChange)
            .forEach((trait: any) => {
            trait[NotifyTileChange.onTileChange](gameObject, gameState, oldTile, isTeleport);
        });
        gameState.events.dispatch(new EnterTileEvent(gameObject.tile, gameObject));
    }
    handleElevationChange(oldElevation: number, gameState: GameState): void {
        (gameState.traits as any)
            .filter(NotifyElevationChange)
            .forEach((trait: any) => {
            trait[NotifyElevationChange.onElevationChange](this.gameObject, gameState, oldElevation);
        });
    }
    unreservePathNodes(): void {
        this.reservedPathNodes.forEach(node => {
            if (node.tile !== this.gameObject.tile) {
                this.tileOccupation.unoccupySingleTile(node.tile, this.gameObject);
            }
        });
        this.reservedPathNodes.length = 0;
    }
    dispose(): void {
        this.gameObject = undefined as any;
    }
}
