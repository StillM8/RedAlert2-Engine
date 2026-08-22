import type { AresAttachEffectInstance } from "@/extensions/ares/AresAttachEffectRuntime";

/** Versioned state for the active AttachEffect list and automatic scheduler. */
export const ARES_ATTACH_EFFECT_STATE_VERSION = 1 as const;

export type AresAttachEffectStatePhase =
    | "inactive"
    | "waiting-initial"
    | "active"
    | "waiting-renewal"
    | "disabled";

export interface AresAttachEffectDamageStateSnapshot {
    readonly effectId: string;
    readonly occurrence: number;
    readonly accumulator: number;
    readonly frameAccumulator: number;
    /**
     * Stable house identity of the attacker whose effect is dealing this
     * damage; resolved back to the live Player during restore. Absent means
     * attribution already fell back to the target's owner.
     */
    readonly sourcePlayerName?: string;
}

/**
 * Where a restored effect's definition must be re-resolved from. Definitions
 * are authored rules data, not runtime state: snapshots record the stable
 * origin so restore can rebind against the same rules objects that created
 * the effect instead of serializing arbitrary definition objects.
 */
export interface AresAttachEffectOriginSnapshot {
    readonly effectId: string;
    /** "warhead" or "techno" — which rules family owns this definition. */
    readonly kind: "warhead" | "techno";
    /** WarheadType/TechnoType section name owning the AttachEffect fields. */
    readonly ownerName: string;
}

export interface AresAttachEffectExtensionState {
    readonly version: typeof ARES_ATTACH_EFFECT_STATE_VERSION;
    readonly instances: readonly AresAttachEffectInstance[];
    readonly automaticPhase: AresAttachEffectStatePhase;
    readonly automaticRemainingDelay: number;
    /** Partial animation-damage accumulation; omitted when no damage is pending. */
    readonly animationDamage?: readonly AresAttachEffectDamageStateSnapshot[];
    /** Definition origins to rebind after restore; omitted when none are held. */
    readonly origins?: readonly AresAttachEffectOriginSnapshot[];
}

export interface AresAttachEffectStateSource {
    readonly instances: readonly AresAttachEffectInstance[];
    readonly automaticPhase: AresAttachEffectStatePhase | string;
    readonly automaticRemainingDelay: number;
    readonly animationDamage?: readonly AresAttachEffectDamageStateSnapshot[];
    readonly origins?: readonly AresAttachEffectOriginSnapshot[];
}

export type AresAttachEffectResolvedDefinition =
    | { kind: "warhead"; definition: unknown }
    | { kind: "techno"; definition: unknown }
    | undefined;

export interface AresAttachEffectRestoreContext {
    /** Resolve a stable house name back to the live player object. */
    resolvePlayer?(name: string): unknown;
    /**
     * Resolve an authored AttachEffect definition from its rules origin.
     * Return undefined when the rules no longer define it (mod change);
     * the effect then stays present but inert, exactly like a live trait
     * whose definition was never applied.
     */
    resolveDefinition?(
        kind: "warhead" | "techno",
        ownerName: string,
    ): unknown;
}

export interface AresAttachEffectStateTarget {
    instances: AresAttachEffectInstance[];
    automaticPhase: AresAttachEffectStatePhase;
    automaticRemainingDelay: number;
    animationDamage: Map<string, { accumulator: number; frameAccumulator: number; sourcePlayer?: unknown }[]>;
    definitions: Map<string, unknown>;
}

const PHASES = new Set<AresAttachEffectStatePhase>([
    "inactive",
    "waiting-initial",
    "active",
    "waiting-renewal",
    "disabled",
]);

function normalizePhase(value: unknown): AresAttachEffectStatePhase {
    if (typeof value !== "string" || !PHASES.has(value as AresAttachEffectStatePhase)) {
        throw new Error(`Invalid Ares AttachEffect state: unsupported phase ${String(value)}`);
    }
    return value as AresAttachEffectStatePhase;
}

function normalizeDelay(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error("Invalid Ares AttachEffect state: delay must be a non-negative integer");
    }
    return value as number;
}

function normalizeInstances(value: unknown): AresAttachEffectInstance[] {
    if (!Array.isArray(value)) {
        throw new Error("Invalid Ares AttachEffect state: instances must be an array");
    }
    return value.map((instance, index) => {
        if (typeof instance !== "object" || instance === null) {
            throw new Error(`Invalid Ares AttachEffect state: instance ${index} must be an object`);
        }
        const candidate = instance as Record<string, unknown>;
        if (typeof candidate.effectId !== "string" || candidate.effectId.length === 0) {
            throw new Error(`Invalid Ares AttachEffect state: instance ${index} has no effect ID`);
        }
        if (!Number.isSafeInteger(candidate.remainingFrames) ||
            ((candidate.remainingFrames as number) < 0 && candidate.remainingFrames !== -1)) {
            throw new Error(`Invalid Ares AttachEffect state: instance ${index} has invalid duration`);
        }
        if (typeof candidate.discardOnEntry !== "boolean") {
            throw new Error(`Invalid Ares AttachEffect state: instance ${index} has invalid discard flag`);
        }
        return {
            effectId: candidate.effectId,
            remainingFrames: candidate.remainingFrames as number,
            discardOnEntry: candidate.discardOnEntry,
        };
    });
}

/** Creates a deterministic JSON-safe AttachEffect snapshot. */
export function serializeAresAttachEffectExtensionState(
    source: AresAttachEffectStateSource,
): AresAttachEffectExtensionState {
    const animationDamage = normalizeAnimationDamage(source.animationDamage);
    const origins = normalizeOrigins(source.origins);
    const state: AresAttachEffectExtensionState = {
        version: ARES_ATTACH_EFFECT_STATE_VERSION,
        instances: normalizeInstances(source.instances),
        automaticPhase: normalizePhase(source.automaticPhase),
        automaticRemainingDelay: normalizeDelay(source.automaticRemainingDelay),
    };
    // Keep optional fields absent when empty so damage-free, origin-free
    // snapshots stay byte-identical to the original format.
    if (animationDamage.length) {
        (state as unknown as { animationDamage?: AresAttachEffectDamageStateSnapshot[] }).animationDamage =
            animationDamage;
    }
    if (origins.length) {
        (state as unknown as { origins?: AresAttachEffectOriginSnapshot[] }).origins = origins;
    }
    return state;
}

function assertStateObject(state: unknown): asserts state is {
    version: unknown;
    instances: unknown;
    automaticPhase: unknown;
    automaticRemainingDelay: unknown;
    animationDamage?: unknown;
    origins?: unknown;
} {
    if (typeof state !== "object" || state === null) {
        throw new Error("Invalid Ares AttachEffect state: expected an object");
    }
}

function normalizeAnimationDamage(
    value: readonly AresAttachEffectDamageStateSnapshot[] | undefined,
): AresAttachEffectDamageStateSnapshot[] {
    if (!value?.length) return [];
    return value.map((entry, index) => {
        if (typeof entry !== "object" || entry === null) {
            throw new Error(`Invalid Ares AttachEffect state: animation damage ${index} must be an object`);
        }
        const candidate = entry as unknown as Record<string, unknown>;
        if (typeof candidate.effectId !== "string" || (candidate.effectId as string).length === 0) {
            throw new Error(`Invalid Ares AttachEffect state: animation damage ${index} has no effect ID`);
        }
        if (!Number.isSafeInteger(candidate.occurrence) || (candidate.occurrence as number) < 0) {
            throw new Error(`Invalid Ares AttachEffect state: animation damage ${index} has invalid occurrence`);
        }
        if (typeof candidate.accumulator !== "number" || !Number.isFinite(candidate.accumulator) ||
            (candidate.accumulator as number) < 0) {
            throw new Error(`Invalid Ares AttachEffect state: animation damage ${index} has invalid accumulator`);
        }
        if (typeof candidate.frameAccumulator !== "number" || !Number.isFinite(candidate.frameAccumulator) ||
            (candidate.frameAccumulator as number) < 0) {
            throw new Error(`Invalid Ares AttachEffect state: animation damage ${index} has invalid frame accumulator`);
        }
        if (candidate.sourcePlayerName !== undefined &&
            (typeof candidate.sourcePlayerName !== "string" || (candidate.sourcePlayerName as string).length === 0)) {
            throw new Error(`Invalid Ares AttachEffect state: animation damage ${index} has invalid source player`);
        }
        return {
            effectId: candidate.effectId,
            occurrence: candidate.occurrence as number,
            accumulator: candidate.accumulator as number,
            frameAccumulator: candidate.frameAccumulator as number,
            ...(candidate.sourcePlayerName !== undefined
                ? { sourcePlayerName: candidate.sourcePlayerName as string }
                : {}),
        };
    });
}

function normalizeOrigins(
    value: readonly AresAttachEffectOriginSnapshot[] | undefined,
): AresAttachEffectOriginSnapshot[] {
    if (!value?.length) return [];
    return value.map((entry, index) => {
        if (typeof entry !== "object" || entry === null) {
            throw new Error(`Invalid Ares AttachEffect state: origin ${index} must be an object`);
        }
        const candidate = entry as unknown as Record<string, unknown>;
        if (typeof candidate.effectId !== "string" || (candidate.effectId as string).length === 0) {
            throw new Error(`Invalid Ares AttachEffect state: origin ${index} has no effect ID`);
        }
        if (candidate.kind !== "warhead" && candidate.kind !== "techno") {
            throw new Error(`Invalid Ares AttachEffect state: origin ${index} has unsupported kind ${String(candidate.kind)}`);
        }
        if (typeof candidate.ownerName !== "string" || (candidate.ownerName as string).length === 0) {
            throw new Error(`Invalid Ares AttachEffect state: origin ${index} has no owner name`);
        }
        return {
            effectId: candidate.effectId,
            kind: candidate.kind as "warhead" | "techno",
            ownerName: candidate.ownerName as string,
        };
    });
}

/**
 * Replaces the live state only after the complete payload has been checked.
 *
 * Validation covers schema/range checks plus the semantic checks provable
 * locally: duplicate (effectId, occurrence) damage entries and duplicate
 * origin effectIds are rejected transactionally before any live mutation.
 * Cross-checks against live rules (origin resolvable after a mod change,
 * occurrence within a live stack) are the host's job via
 * `context.resolveDefinition` and instance-driven reconciliation; orphaned
 * entries degrade to inert instead of throwing so a changed mod cannot break
 * every subsequent load.
 */
export function restoreAresAttachEffectExtensionState(
    target: AresAttachEffectStateTarget,
    state: unknown,
    context: AresAttachEffectRestoreContext = {},
): void {
    assertStateObject(state);
    if (state.version !== ARES_ATTACH_EFFECT_STATE_VERSION) {
        throw new Error(`Unsupported Ares AttachEffect state version: ${String(state.version)}`);
    }
    const animationDamage = normalizeAnimationDamage(state.animationDamage as
        readonly AresAttachEffectDamageStateSnapshot[] | undefined);
    const seenDamage = new Set<string>();
    for (const entry of animationDamage) {
        const key = `${entry.effectId}\0${entry.occurrence}`;
        if (seenDamage.has(key)) {
            throw new Error(`Invalid Ares AttachEffect state: duplicate damage entry ${entry.effectId}[${entry.occurrence}]`);
        }
        seenDamage.add(key);
    }
    const origins = normalizeOrigins(state.origins as readonly AresAttachEffectOriginSnapshot[] | undefined);
    const seenOrigin = new Set<string>();
    for (const entry of origins) {
        if (seenOrigin.has(entry.effectId)) {
            throw new Error(`Invalid Ares AttachEffect state: duplicate definition origin for ${entry.effectId}`);
        }
        seenOrigin.add(entry.effectId);
    }

    const normalized = serializeAresAttachEffectExtensionState({
        instances: state.instances as AresAttachEffectInstance[],
        automaticPhase: normalizePhase(state.automaticPhase),
        automaticRemainingDelay: normalizeDelay(state.automaticRemainingDelay),
        animationDamage,
        origins,
    });
    target.instances = normalized.instances.map(instance => ({ ...instance }));
    target.automaticPhase = normalized.automaticPhase;
    target.automaticRemainingDelay = normalized.automaticRemainingDelay;
    target.animationDamage =
        new Map<string, { accumulator: number; frameAccumulator: number; sourcePlayer?: unknown }[]>();
    for (const entry of animationDamage) {
        const queue = target.animationDamage.get(entry.effectId) ?? [];
        queue[entry.occurrence] = {
            accumulator: entry.accumulator,
            frameAccumulator: entry.frameAccumulator,
            ...(entry.sourcePlayerName !== undefined && context.resolvePlayer
                ? { sourcePlayer: context.resolvePlayer(entry.sourcePlayerName) }
                : {}),
        };
        target.animationDamage.set(entry.effectId, queue);
    }
    // Definition rebinding: re-resolve each held effect's authored definition
    // from its recorded rules origin. An unresolvable origin leaves that
    // effect present but inert — identical to a live trait whose definition
    // was never applied — instead of failing the whole restore.
    target.definitions = new Map<string, unknown>();
    for (const origin of origins) {
        const resolved = context.resolveDefinition?.(origin.kind, origin.ownerName);
        if (resolved !== undefined) {
            target.definitions.set(origin.effectId, resolved);
        }
    }
}
