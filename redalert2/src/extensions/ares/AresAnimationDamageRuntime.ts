import {
    advanceAresAnimationDamage,
    type AresAnimationDamageDefinition,
    type AresAnimationDamageState,
} from "@/extensions/ares/AresAnimationDamage";
import { GameSpeed } from "@/game/GameSpeed";
import { fnv32aStrings } from "@/util/math";

export interface AresAnimationDamageSpawn {
    definition: AresAnimationDamageDefinition;
    tile: any;
    position: any;
    elevation: number;
    zone: any;
    sourcePlayer?: any;
    sourceObject?: any;
}

export interface AresAnimationDamageDelivery extends AresAnimationDamageSpawn {
    damage: number;
}

export interface AresAnimationDamageRuntimeOptions {
    /** Resolves a live player to its canonical PlayerList index. */
    getPlayerIndex?(player: any): number | undefined;
}

interface RuntimeInstance extends AresAnimationDamageSpawn {
    frame: number;
    loopNumber: number;
    frameAccumulator: number;
    damageState: AresAnimationDamageState;
}

/** JSON-safe snapshot of one live animation-damage instance. */
export interface AresAnimationDamageInstanceState {
    /** Canonical runtime identity; restored exactly and never regenerated. */
    readonly id: number;
    /** Authored definition name; rebound against rules during restore. */
    readonly definitionName: string;
    readonly frame: number;
    readonly loopNumber: number;
    readonly frameAccumulator: number;
    readonly accumulator: number;
    readonly tileRx: number;
    readonly tileRy: number;
    readonly tileZ?: number;
    /** Exact simulation position consumed by Warhead.detonate(). */
    readonly positionX: number;
    readonly positionY: number;
    readonly positionZ: number;
    readonly elevation: number;
    readonly zone: unknown;
    /** Canonical PlayerList index; absent when attribution fell back. */
    readonly sourcePlayerIndex?: number;
    /** Explicitly tagged legacy fallback when no canonical player resolver exists. */
    readonly sourcePlayerName?: string;
    /** A configured resolver rejected the live player; strict restore rejects this. */
    readonly sourcePlayerUnresolved?: true;
}

export const ARES_ANIMATION_DAMAGE_RUNTIME_STATE_VERSION = 2 as const;

export interface AresAnimationDamageRuntimeState {
    readonly version: typeof ARES_ANIMATION_DAMAGE_RUNTIME_STATE_VERSION;
    readonly nextId: number;
    readonly instances: readonly AresAnimationDamageInstanceState[];
}

export interface AresAnimationDamageRestoreContext {
    /** Strict canonical restore rejects unresolved external state. */
    strict?: boolean;
    resolveTile?(rx: number, ry: number): unknown;
    resolvePlayerByIndex?(index: number): unknown;
    resolvePlayerByName?(name: string): unknown;
    resolveDefinition?(name: string): AresAnimationDamageDefinition | undefined;
}

export interface AresAnimationDamageRuntimeHost {
    applyAresAnimationDamageArea(request: AresAnimationDamageDelivery): void;
}

/**
 * Simulation-side lifetime for standalone Ares animation damage.
 *
 * The renderer owns the visual transient, but damage must be driven by the
 * deterministic game tick. This runtime mirrors the animation frame clock,
 * keeps Damage.Delay in animation frames, and snapshots instances so a
 * damage-triggered explosion cannot recursively run in the same tick.
 */
export class AresAnimationDamageRuntime {
    private nextId = 1;
    private instances = new Map<number, RuntimeInstance>();
    private readonly getPlayerIndex?: (player: any) => number | undefined;

    constructor(options: AresAnimationDamageRuntimeOptions = {}) {
        this.getPlayerIndex = options.getPlayerIndex;
    }

    spawn(request: AresAnimationDamageSpawn): boolean {
        if (request.definition.damage <= 0 || request.definition.rate <= 0) {
            return false;
        }

        this.instances.set(this.nextId++, {
            ...request,
            frame: request.definition.reverse
                ? request.definition.end
                : request.definition.start,
            loopNumber: 0,
            frameAccumulator: 0,
            damageState: { accumulator: 0 },
        });
        return true;
    }

    /**
     * Canonical state: frame clock position, fractional timing, and the
     * pending damage accumulator decide when and where future damage lands.
     * `sourceObject` is intentionally excluded: the current standalone
     * delivery path consumes sourcePlayer but never reads sourceObject. It is
     * retained on the live request for event compatibility, not treated as
     * canonical state until a gameplay reader exists.
     */
    getHash(): number {
        const parts: (string | number)[] = ["AresAnimationDamageRuntime", this.nextId];
        for (const [id, instance] of [...this.instances.entries()].sort(([a], [b]) => a - b)) {
            const sourcePlayerIndex = this.resolveCanonicalPlayerIndex(instance.sourcePlayer);
            parts.push(
                id,
                instance.definition.name ?? "",
                instance.frame,
                instance.loopNumber,
                instance.frameAccumulator,
                instance.damageState.accumulator,
                instance.tile?.rx ?? -1,
                instance.tile?.ry ?? -1,
                instance.tile?.z ?? 0,
                finiteOrZero(instance.position?.x),
                finiteOrZero(instance.position?.y),
                finiteOrZero(instance.position?.z),
                instance.elevation,
                stableScalar(instance.zone),
                sourcePlayerIndex !== undefined
                    ? 1
                    : instance.sourcePlayer !== undefined && instance.sourcePlayer !== null
                        ? this.getPlayerIndex ? 3 : 2
                        : 0,
                sourcePlayerIndex ?? (this.getPlayerIndex
                    ? "unresolved"
                    : stableScalar(instance.sourcePlayer?.name ?? instance.sourcePlayer?.id)),
            );
        }
        return fnv32aStrings(parts);
    }

    captureState(): AresAnimationDamageRuntimeState {
        return {
            version: ARES_ANIMATION_DAMAGE_RUNTIME_STATE_VERSION,
            nextId: this.nextId,
            instances: [...this.instances.entries()].sort(([a], [b]) => a - b).map(([id, instance]) => {
                const sourcePlayerIndex = this.resolveCanonicalPlayerIndex(instance.sourcePlayer);
                const sourcePlayerState = sourcePlayerIndex !== undefined
                    ? { sourcePlayerIndex }
                    : instance.sourcePlayer !== undefined && instance.sourcePlayer !== null
                        ? this.getPlayerIndex
                            ? { sourcePlayerUnresolved: true as const }
                            : { sourcePlayerName: String(instance.sourcePlayer.name ?? instance.sourcePlayer.id ?? "") }
                        : {};
                return {
                    id,
                    definitionName: instance.definition.name ?? "",
                    frame: instance.frame,
                    loopNumber: instance.loopNumber,
                    frameAccumulator: instance.frameAccumulator,
                    accumulator: instance.damageState.accumulator,
                    tileRx: instance.tile?.rx ?? -1,
                    tileRy: instance.tile?.ry ?? -1,
                    ...(Number.isFinite(instance.tile?.z) ? { tileZ: instance.tile.z } : {}),
                    positionX: finiteOrZero(instance.position?.x),
                    positionY: finiteOrZero(instance.position?.y),
                    positionZ: finiteOrZero(instance.position?.z),
                    elevation: instance.elevation,
                    zone: jsonScalar(instance.zone),
                    ...sourcePlayerState,
                };
            }),
        };
    }

    /**
     * Replaces the live instance set only after the complete payload and all
     * cross-references have been resolved into temporary structures. Strict
     * canonical restore rejects missing rules or references; the default
     * permissive mode retains legacy save behavior for callers that cannot
     * provide a complete world resolver.
     */
    restoreState(state: unknown, context: AresAnimationDamageRestoreContext = {}): void {
        if (typeof state !== "object" || state === null) {
            throw new Error("Invalid Ares animation damage runtime state: expected an object");
        }
        const candidate = state as Partial<AresAnimationDamageRuntimeState> &
            Record<string, unknown>;
        if (candidate.version !== ARES_ANIMATION_DAMAGE_RUNTIME_STATE_VERSION) {
            throw new Error(`Unsupported Ares animation damage runtime state version: ${String(candidate.version)}`);
        }
        if (!Array.isArray(candidate.instances)) {
            throw new Error("Invalid Ares animation damage runtime state: instances must be an array");
        }
        if (!Number.isSafeInteger(candidate.nextId) || (candidate.nextId as number) < 1) {
            throw new Error("Invalid Ares animation damage runtime state: nextId");
        }

        const entries = candidate.instances as Array<Record<string, unknown>>;
        const activeIds = new Set<number>();
        // Validate the complete scalar payload before resolving anything.
        for (const entry of entries) {
            if (typeof entry !== "object" || entry === null) {
                throw new Error("Invalid Ares animation damage runtime state: instance must be an object");
            }
            if (typeof entry.definitionName !== "string") {
                throw new Error("Invalid Ares animation damage runtime state: instance has no definition name");
            }
            if (!Number.isSafeInteger(entry.id) || (entry.id as number) < 1) {
                throw new Error("Invalid Ares animation damage runtime state: instance id");
            }
            if (activeIds.has(entry.id as number)) {
                throw new Error(`Invalid Ares animation damage runtime state: duplicate instance id ${entry.id}`);
            }
            activeIds.add(entry.id as number);
            for (const key of [
                "frame", "loopNumber", "frameAccumulator", "accumulator", "tileRx", "tileRy",
                "positionX", "positionY", "positionZ", "elevation",
            ] as const) {
                if (typeof entry[key] !== "number" || !Number.isFinite(entry[key] as number)) {
                    throw new Error(`Invalid Ares animation damage runtime state: instance ${key}`);
                }
            }
            if (!Number.isSafeInteger(entry.frame) || !Number.isSafeInteger(entry.loopNumber) ||
                (entry.frameAccumulator as number) < 0 || (entry.accumulator as number) < 0 ||
                !Number.isSafeInteger(entry.tileRx) || !Number.isSafeInteger(entry.tileRy)) {
                throw new Error("Invalid Ares animation damage runtime state: invalid frame or coordinate state");
            }
            if (entry.tileZ !== undefined &&
                (typeof entry.tileZ !== "number" || !Number.isFinite(entry.tileZ))) {
                throw new Error("Invalid Ares animation damage runtime state: tileZ");
            }
            if (entry.sourcePlayerIndex !== undefined &&
                (!Number.isSafeInteger(entry.sourcePlayerIndex) || (entry.sourcePlayerIndex as number) < 0)) {
                throw new Error("Invalid Ares animation damage runtime state: sourcePlayerIndex");
            }
            if (entry.sourcePlayerName !== undefined &&
                typeof entry.sourcePlayerName !== "string") {
                throw new Error("Invalid Ares animation damage runtime state: sourcePlayerName");
            }
            if (entry.sourcePlayerUnresolved !== undefined && entry.sourcePlayerUnresolved !== true) {
                throw new Error("Invalid Ares animation damage runtime state: sourcePlayerUnresolved");
            }
            const sourceIdentityFields = [
                entry.sourcePlayerIndex !== undefined,
                entry.sourcePlayerName !== undefined,
                entry.sourcePlayerUnresolved === true,
            ].filter(Boolean).length;
            if (sourceIdentityFields > 1) {
                throw new Error("Invalid Ares animation damage runtime state: conflicting source player identities");
            }
            if ((entry.id as number) >= (candidate.nextId as number)) {
                throw new Error("Invalid Ares animation damage runtime state: instance id must be below nextId");
            }
        }

        const replacement = new Map<number, RuntimeInstance>();
        for (const entry of entries) {
            const tile = context.resolveTile?.(entry.tileRx as number, entry.tileRy as number) as any;
            if (context.strict && !tile) {
                throw new Error(`Cannot restore Ares animation damage instance ${entry.id}: tile is unresolved`);
            }
            if (context.strict && entry.tileZ !== undefined && tile?.z !== entry.tileZ) {
                throw new Error(`Cannot restore Ares animation damage instance ${entry.id}: tile elevation changed`);
            }
            const definition = context.resolveDefinition?.(entry.definitionName as string);
            if (context.strict && !definition) {
                throw new Error(`Cannot restore Ares animation damage instance ${entry.id}: definition ${entry.definitionName} is unresolved`);
            }
            const sourcePlayer = entry.sourcePlayerIndex !== undefined
                ? context.resolvePlayerByIndex?.(entry.sourcePlayerIndex as number)
                : entry.sourcePlayerName !== undefined
                    ? context.resolvePlayerByName?.(entry.sourcePlayerName as string)
                    : undefined;
            if (context.strict && entry.sourcePlayerIndex !== undefined && sourcePlayer === undefined) {
                throw new Error(`Cannot restore Ares animation damage instance ${entry.id}: source player is unresolved`);
            }
            if (context.strict && entry.sourcePlayerName !== undefined && sourcePlayer === undefined) {
                throw new Error(`Cannot restore Ares animation damage instance ${entry.id}: legacy source player is unresolved`);
            }
            if (context.strict && entry.sourcePlayerUnresolved === true) {
                throw new Error(`Cannot restore Ares animation damage instance ${entry.id}: source player is unresolved`);
            }
            replacement.set(entry.id as number, {
                ...(definition ? { definition } : { definition: { name: entry.definitionName } as AresAnimationDamageDefinition }),
                tile,
                position: {
                    x: entry.positionX as number,
                    y: entry.positionY as number,
                    z: entry.positionZ as number,
                },
                elevation: entry.elevation as number,
                zone: entry.zone,
                sourcePlayer,
                frame: entry.frame as number,
                loopNumber: entry.loopNumber as number,
                frameAccumulator: entry.frameAccumulator as number,
                damageState: { accumulator: entry.accumulator as number },
            });
        }
        // Replacement is the commit point. Destination history cannot affect
        // the restored allocation stream.
        this.instances = replacement;
        this.nextId = candidate.nextId as number;
    }

    update(host: AresAnimationDamageRuntimeHost): void {
        const active = [...this.instances.entries()];
        for (const [id, instance] of active) {
            // A new animation created by a damage warhead starts on the next
            // simulation tick, matching the transient animation lifecycle.
            if (!this.instances.has(id)) continue;

            instance.frameAccumulator += instance.definition.rate / GameSpeed.BASE_TICKS_PER_SECOND;
            const framesToAdvance = Math.floor(instance.frameAccumulator);
            instance.frameAccumulator -= framesToAdvance;

            let finished = false;
            for (let frame = 0; frame < framesToAdvance; frame++) {
                const step = advanceAresAnimationDamage(instance.definition, instance.damageState);
                instance.damageState = step.state;
                if (step.damage) {
                    host.applyAresAnimationDamageArea({
                        ...instance,
                        damage: step.damage,
                    });
                }

                if (this.advanceFrame(instance)) {
                    finished = true;
                    break;
                }
            }

            if (finished) {
                this.instances.delete(id);
            }
        }
    }

    clear(): void {
        this.instances.clear();
    }

    getActiveCount(): number {
        return this.instances.size;
    }

    private advanceFrame(instance: RuntimeInstance): boolean {
        const definition = instance.definition;
        const targetFrame = definition.reverse
            ? (instance.loopNumber > 0 ? definition.loopStart : definition.start)
            : (instance.loopNumber > 0 ? definition.loopEnd : definition.end);
        const step = definition.reverse ? -1 : 1;
        const nextFrame = instance.frame + step;

        if (definition.reverse ? nextFrame >= targetFrame : nextFrame <= targetFrame) {
            instance.frame = nextFrame;
            return false;
        }

        if (definition.loopCount === -1 || instance.loopNumber < definition.loopCount - 1) {
            instance.loopNumber++;
            instance.frame = definition.reverse ? definition.loopEnd : definition.loopStart;
            return false;
        }

        return true;
    }

    private resolveCanonicalPlayerIndex(player: any): number | undefined {
        if (player === undefined || player === null) return undefined;
        if (this.getPlayerIndex) {
            const resolved = this.getPlayerIndex(player);
            return isCanonicalIndex(resolved) ? resolved : undefined;
        }
        return isCanonicalIndex(player.playerListIndex) ? player.playerListIndex : undefined;
    }

}

function isCanonicalIndex(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteOrZero(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function jsonScalar(value: unknown): string | number | boolean | null {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    return null;
}

function stableScalar(value: unknown): string | number {
    return value === null || value === undefined
        ? "null"
        : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : "unsupported";
}
