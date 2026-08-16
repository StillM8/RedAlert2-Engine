import type { AresAttachEffectInstance } from "@/extensions/ares/AresAttachEffectRuntime";

/** Versioned state for the active AttachEffect list and automatic scheduler. */
export const ARES_ATTACH_EFFECT_STATE_VERSION = 1 as const;

export type AresAttachEffectStatePhase =
    | "inactive"
    | "waiting-initial"
    | "active"
    | "waiting-renewal"
    | "disabled";

export interface AresAttachEffectExtensionState {
    readonly version: typeof ARES_ATTACH_EFFECT_STATE_VERSION;
    readonly instances: readonly AresAttachEffectInstance[];
    readonly automaticPhase: AresAttachEffectStatePhase;
    readonly automaticRemainingDelay: number;
}

export interface AresAttachEffectStateSource {
    readonly instances: readonly AresAttachEffectInstance[];
    readonly automaticPhase: AresAttachEffectStatePhase | string;
    readonly automaticRemainingDelay: number;
}

export interface AresAttachEffectStateTarget {
    instances: AresAttachEffectInstance[];
    automaticPhase: AresAttachEffectStatePhase;
    automaticRemainingDelay: number;
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
    return {
        version: ARES_ATTACH_EFFECT_STATE_VERSION,
        instances: normalizeInstances(source.instances),
        automaticPhase: normalizePhase(source.automaticPhase),
        automaticRemainingDelay: normalizeDelay(source.automaticRemainingDelay),
    };
}

function assertStateObject(state: unknown): asserts state is {
    version: unknown;
    instances: unknown;
    automaticPhase: unknown;
    automaticRemainingDelay: unknown;
} {
    if (typeof state !== "object" || state === null) {
        throw new Error("Invalid Ares AttachEffect state: expected an object");
    }
}

/** Replaces the live state only after the complete payload has been checked. */
export function restoreAresAttachEffectExtensionState(
    target: AresAttachEffectStateTarget,
    state: unknown,
): void {
    assertStateObject(state);
    if (state.version !== ARES_ATTACH_EFFECT_STATE_VERSION) {
        throw new Error(`Unsupported Ares AttachEffect state version: ${String(state.version)}`);
    }
    const normalized = serializeAresAttachEffectExtensionState({
        instances: state.instances as AresAttachEffectInstance[],
        automaticPhase: normalizePhase(state.automaticPhase),
        automaticRemainingDelay: normalizeDelay(state.automaticRemainingDelay),
    });
    target.instances = normalized.instances.map(instance => ({ ...instance }));
    target.automaticPhase = normalized.automaticPhase;
    target.automaticRemainingDelay = normalized.automaticRemainingDelay;
}
