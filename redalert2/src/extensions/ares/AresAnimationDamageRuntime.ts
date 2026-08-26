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

interface RuntimeInstance extends AresAnimationDamageSpawn {
    frame: number;
    loopNumber: number;
    frameAccumulator: number;
    damageState: AresAnimationDamageState;
}

/** JSON-safe snapshot of one live animation-damage instance. */
export interface AresAnimationDamageInstanceState {
    /** Authored definition name; rebound against rules during restore. */
    readonly definitionName: string;
    readonly frame: number;
    readonly loopNumber: number;
    readonly frameAccumulator: number;
    readonly accumulator: number;
    readonly tileRx: number;
    readonly tileRy: number;
    readonly tileZ?: number;
    readonly elevation: number;
    readonly zone: unknown;
    /** Canonical PlayerList index; absent when attribution fell back. */
    readonly sourcePlayerIndex?: number;
    /** Deterministic object id of the damaging source, if any. */
    readonly sourceObjectId?: number;
}

export interface AresAnimationDamageRuntimeState {
    readonly version: 1;
    readonly nextId: number;
    readonly instances: readonly AresAnimationDamageInstanceState[];
}

export interface AresAnimationDamageRestoreContext {
    resolveTile?(rx: number, ry: number): unknown;
    resolvePlayerByIndex?(index: number): unknown;
    resolveObjectById?(id: number): unknown;
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
     * Insertion order is deterministic, so ids are hashed as-is.
     */
    getHash(): number {
        const parts: (string | number)[] = ["AresAnimationDamageRuntime", this.nextId];
        for (const [id, instance] of this.instances) {
            parts.push(
                id,
                instance.definition.name ?? "",
                instance.frame,
                instance.loopNumber,
                instance.frameAccumulator,
                instance.damageState.accumulator,
                instance.tile?.rx ?? -1,
                instance.tile?.ry ?? -1,
            );
        }
        return fnv32aStrings(parts);
    }

    captureState(): AresAnimationDamageRuntimeState {
        return {
            version: 1,
            nextId: this.nextId,
            instances: [...this.instances.entries()].map(([id, instance]) => ({
                definitionName: instance.definition.name ?? "",
                frame: instance.frame,
                loopNumber: instance.loopNumber,
                frameAccumulator: instance.frameAccumulator,
                accumulator: instance.damageState.accumulator,
                tileRx: instance.tile?.rx ?? -1,
                tileRy: instance.tile?.ry ?? -1,
                ...(Number.isFinite(instance.tile?.z) ? { tileZ: instance.tile.z } : {}),
                elevation: instance.elevation,
                zone: instance.zone,
                ...(instance.sourcePlayer?.playerListIndex !== undefined && instance.sourcePlayer !== undefined
                    ? { sourcePlayerIndex: instance.sourcePlayer.playerListIndex }
                    : {}),
                ...(instance.sourceObject?.id !== undefined
                    ? { sourceObjectId: instance.sourceObject.id }
                    : {}),
            })),
        };
    }

    /**
     * Replaces the live instance set only after the payload validates.
     * Cross-references (tile/player/object/definition) rebind through the
     * context; an unresolvable reference degrades that field to undefined
     * instead of failing the whole restore, matching how a live effect with
     * no source behaves.
     */
    restoreState(state: unknown, context: AresAnimationDamageRestoreContext = {}): void {
        if (typeof state !== "object" || state === null) {
            throw new Error("Invalid Ares animation damage runtime state: expected an object");
        }
        const candidate = state as Partial<AresAnimationDamageRuntimeState> &
            Record<string, unknown>;
        if (candidate.version !== 1) {
            throw new Error(`Unsupported Ares animation damage runtime state version: ${String(candidate.version)}`);
        }
        if (!Array.isArray(candidate.instances)) {
            throw new Error("Invalid Ares animation damage runtime state: instances must be an array");
        }
        if (!Number.isSafeInteger(candidate.nextId) || (candidate.nextId as number) < 0) {
            throw new Error("Invalid Ares animation damage runtime state: nextId");
        }

        // Validate everything before mutating anything.
        for (const entry of candidate.instances as Array<Record<string, unknown>>) {
            if (typeof entry !== "object" || entry === null) {
                throw new Error("Invalid Ares animation damage runtime state: instance must be an object");
            }
            if (typeof entry.definitionName !== "string") {
                throw new Error("Invalid Ares animation damage runtime state: instance has no definition name");
            }
            for (const key of ["frame", "loopNumber", "frameAccumulator", "accumulator", "tileRx", "tileRy", "elevation"] as const) {
                if (typeof entry[key] !== "number" || !Number.isFinite(entry[key] as number)) {
                    throw new Error(`Invalid Ares animation damage runtime state: instance ${key}`);
                }
            }
            if (entry.sourcePlayerIndex !== undefined &&
                (!Number.isSafeInteger(entry.sourcePlayerIndex) || (entry.sourcePlayerIndex as number) < 0)) {
                throw new Error("Invalid Ares animation damage runtime state: sourcePlayerIndex");
            }
            if (entry.sourceObjectId !== undefined &&
                (!Number.isSafeInteger(entry.sourceObjectId) || (entry.sourceObjectId as number) < 0)) {
                throw new Error("Invalid Ares animation damage runtime state: sourceObjectId");
            }
        }

        this.instances.clear();
        for (const entry of candidate.instances as Array<Record<string, unknown>>) {
            const tile = context.resolveTile?.(entry.tileRx as number, entry.tileRy as number) as any;
            const definition = context.resolveDefinition?.(entry.definitionName as string);
            this.instances.set(this.nextId++, {
                ...(definition ? { definition } : { definition: { name: entry.definitionName } as AresAnimationDamageDefinition }),
                tile,
                position: tile?.center ?? undefined,
                elevation: entry.elevation as number,
                zone: entry.zone,
                sourcePlayer: entry.sourcePlayerIndex !== undefined
                    ? context.resolvePlayerByIndex?.(entry.sourcePlayerIndex as number)
                    : undefined,
                sourceObject: entry.sourceObjectId !== undefined
                    ? context.resolveObjectById?.(entry.sourceObjectId as number)
                    : undefined,
                frame: entry.frame as number,
                loopNumber: entry.loopNumber as number,
                frameAccumulator: entry.frameAccumulator as number,
                damageState: { accumulator: entry.accumulator as number },
            });
        }
        // The counter continues past both the restored ids and any prior
        // spawns so future spawns can never collide with restored entries.
        this.nextId = Math.max(this.nextId, candidate.nextId as number);
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
}
