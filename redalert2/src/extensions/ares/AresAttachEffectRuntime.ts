import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";

/**
 * The stable authored identity of one AttachEffect definition. The runtime
 * integration will provide this from its data registry; this model does not
 * know or depend on any particular mod object name.
 */
export type AresAttachEffectId = string;

/**
 * Minimal serializable state for one active effect instance. Definition data
 * remains in the caller's rules registry; only state needed for deterministic
 * lifecycle decisions is retained here.
 */
export interface AresAttachEffectInstance {
    effectId: AresAttachEffectId;
    remainingFrames: number;
    discardOnEntry: boolean;
}

export type AresAttachEffectApplyDecision =
    | "applied"
    | "reapplied"
    | "stacked"
    | "blocked-by-protection"
    | "ignored-zero-duration";

export interface AresAttachEffectApplyResult {
    decision: AresAttachEffectApplyDecision;
    instances: readonly AresAttachEffectInstance[];
    /** The caller should perform the generic decloak operation when true. */
    forceDecloak: boolean;
    /** The caller should recreate the existing effect animation when true. */
    resetAnimation: boolean;
}

export interface AresAttachEffectAdvanceResult {
    instances: readonly AresAttachEffectInstance[];
    expiredEffectIds: readonly AresAttachEffectId[];
}

export interface AresAttachEffectRemovalResult {
    instances: readonly AresAttachEffectInstance[];
    removedEffectIds: readonly AresAttachEffectId[];
}

/**
 * Ares treats -1 as infinite. Zero is not an active effect, and other
 * negative values are safely treated as already expired rather than being
 * allowed to create an accidental immortal state.
 */
function activeDuration(duration: number): number {
    if (duration === -1) return -1;
    if (Number.isSafeInteger(duration) && duration > 0) return duration;
    return 0;
}

function copyInstance(instance: AresAttachEffectInstance): AresAttachEffectInstance {
    return {
        effectId: instance.effectId,
        remainingFrames: instance.remainingFrames,
        discardOnEntry: instance.discardOnEntry,
    };
}

function activeInstances(
    instances: readonly AresAttachEffectInstance[],
): AresAttachEffectInstance[] {
    return instances
        .filter(instance => instance.remainingFrames === -1 || instance.remainingFrames > 0)
        .map(copyInstance);
}

/**
 * Apply one generic AttachEffect definition to an immutable instance list.
 *
 * This follows the documented Ares distinction: a non-cumulative effect
 * refreshes the matching instance, while a cumulative effect appends another
 * instance. Matching is by the caller-supplied stable definition ID.
 */
export function applyAresAttachEffect(
    definition: AresAttachEffectDefinition,
    effectId: AresAttachEffectId,
    instances: readonly AresAttachEffectInstance[] = [],
    options: { protectedByIronCurtainOrForceShield?: boolean } = {},
): AresAttachEffectApplyResult {
    const current = activeInstances(instances);
    const duration = activeDuration(definition.duration);
    const protectedTarget = options.protectedByIronCurtainOrForceShield === true;

    if (protectedTarget && !definition.penetratesIronCurtain) {
        return {
            decision: "blocked-by-protection",
            instances: current,
            forceDecloak: false,
            resetAnimation: false,
        };
    }

    if (duration === 0) {
        return {
            decision: "ignored-zero-duration",
            instances: current,
            forceDecloak: false,
            resetAnimation: false,
        };
    }

    const matchingIndex = current.findIndex(instance => instance.effectId === effectId);
    if (!definition.cumulative && matchingIndex >= 0) {
        const refreshed = [...current];
        refreshed[matchingIndex] = {
            effectId,
            remainingFrames: duration,
            discardOnEntry: definition.discardOnEntry,
        };
        return {
            decision: "reapplied",
            instances: refreshed,
            forceDecloak: definition.forceDecloak,
            resetAnimation: definition.animResetOnReapply && definition.animation !== undefined,
        };
    }

    return {
        decision: definition.cumulative ? "stacked" : "applied",
        instances: [
            ...current,
            {
                effectId,
                remainingFrames: duration,
                discardOnEntry: definition.discardOnEntry,
            },
        ],
        forceDecloak: definition.forceDecloak,
        resetAnimation: false,
    };
}

/**
 * Advance one deterministic game tick. Positive durations lose one frame;
 * infinite effects remain at -1. Zero and other negative values are removed.
 */
export function advanceAresAttachEffects(
    instances: readonly AresAttachEffectInstance[],
): AresAttachEffectAdvanceResult {
    const next: AresAttachEffectInstance[] = [];
    const expiredEffectIds: AresAttachEffectId[] = [];

    for (const instance of instances) {
        if (instance.remainingFrames === -1) {
            next.push(copyInstance(instance));
            continue;
        }

        const remaining = instance.remainingFrames > 0
            ? instance.remainingFrames - 1
            : 0;
        if (remaining <= 0) {
            expiredEffectIds.push(instance.effectId);
        } else {
            next.push({ ...copyInstance(instance), remainingFrames: remaining });
        }
    }

    return { instances: next, expiredEffectIds };
}

/**
 * Advance the internal mutable trait state without allocating a replacement
 * array. The write cursor preserves authored instance order and the returned
 * expiry list remains deterministic. This is intentionally separate from the
 * pure helper above because callers outside the trait may rely on immutable
 * input semantics.
 */
export function advanceAresAttachEffectsInPlace(
    instances: AresAttachEffectInstance[],
): AresAttachEffectId[] {
    const expiredEffectIds: AresAttachEffectId[] = [];
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < instances.length; readIndex++) {
        const instance = instances[readIndex];
        if (instance.remainingFrames === -1) {
            instances[writeIndex++] = instance;
            continue;
        }

        const remaining = instance.remainingFrames > 0
            ? instance.remainingFrames - 1
            : 0;
        if (remaining <= 0) {
            expiredEffectIds.push(instance.effectId);
            continue;
        }

        instance.remainingFrames = remaining;
        instances[writeIndex++] = instance;
    }

    instances.length = writeIndex;
    return expiredEffectIds;
}

/** Remove only effects marked DiscardOnEntry when the target leaves the map. */
export function discardAresAttachEffectsOnEntry(
    instances: readonly AresAttachEffectInstance[],
): AresAttachEffectRemovalResult {
    const removedEffectIds: AresAttachEffectId[] = [];
    const remaining = instances
        .filter(instance => {
            if (instance.discardOnEntry) {
                removedEffectIds.push(instance.effectId);
                return false;
            }
            return true;
        })
        .map(copyInstance);

    return { instances: remaining, removedEffectIds };
}
