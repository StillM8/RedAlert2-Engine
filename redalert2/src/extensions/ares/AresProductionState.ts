import type { SideId } from './AresSides';

/**
 * The standalone engine currently resumes single-player saves by replaying
 * the recorded action log.  This versioned value is also the stable boundary
 * for a future full snapshot serializer: it contains the Ares-owned
 * production state that an action log or snapshot must preserve.
 */
export const ARES_PRODUCTION_STATE_VERSION = 2 as const;

export interface AresProductionExtensionState {
    readonly version: typeof ARES_PRODUCTION_STATE_VERSION;
    readonly stolenTechs: readonly (number | SideId)[];
    readonly permanentFactoryOwnerPlans: readonly string[];
    readonly reverseEngineeredPlans: readonly string[];
}

export interface AresProductionStateSource {
    readonly stolenTech: Iterable<number | SideId>;
    readonly permanentFactoryOwnerPlans: Iterable<string>;
    readonly reverseEngineeredPlans: Iterable<string>;
}

export interface AresProductionStateTarget {
    stolenTech: Set<number | SideId>;
    permanentFactoryOwnerPlans: Set<string>;
    reverseEngineeredPlans: Set<string>;
}

function normalizePlanId(value: string): string | undefined {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function planKey(value: string): string {
    return value.toLocaleLowerCase('en-US');
}

function normalizePlanIds(values: Iterable<string>): string[] {
    const plans = new Map<string, string>();
    for (const value of values) {
        const normalized = normalizePlanId(value);
        if (normalized && !plans.has(planKey(normalized))) {
            // Keep the first authored spelling for diagnostics while using a
            // case-insensitive key, matching Ares country-name lookup.
            plans.set(planKey(normalized), normalized);
        }
    }
    return [...plans.values()].sort((a, b) =>
        planKey(a).localeCompare(planKey(b)) || a.localeCompare(b));
}

function stolenTechKey(value: number | SideId): string {
    return typeof value === 'number'
        ? `number:${value}`
        : `side:${value.trim().toLocaleLowerCase('en-US')}`;
}

function normalizeStolenTech(values: Iterable<number | SideId>): Array<number | SideId> {
    const entries = new Map<string, number | SideId>();
    for (const value of values) {
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || !Number.isInteger(value)) {
                throw new Error(`Invalid Ares stolen-tech index: ${value}`);
            }
            const key = stolenTechKey(value);
            if (!entries.has(key)) {
                entries.set(key, value);
            }
            continue;
        }
        const normalized = value.trim();
        if (normalized.length === 0) {
            continue;
        }
        const key = stolenTechKey(normalized);
        if (!entries.has(key)) {
            entries.set(key, normalized);
        }
    }
    return [...entries.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, value]) => value);
}

/** Creates a deterministic, JSON-safe representation of Ares production state. */
export function serializeAresProductionExtensionState(
    source: AresProductionStateSource,
): AresProductionExtensionState {
    return {
        version: ARES_PRODUCTION_STATE_VERSION,
        stolenTechs: normalizeStolenTech(source.stolenTech),
        permanentFactoryOwnerPlans: normalizePlanIds(source.permanentFactoryOwnerPlans),
        reverseEngineeredPlans: normalizePlanIds(source.reverseEngineeredPlans),
    };
}

function assertStateObject(state: unknown): asserts state is {
    version: unknown;
    stolenTechs: unknown;
    permanentFactoryOwnerPlans: unknown;
    reverseEngineeredPlans?: unknown;
} {
    if (typeof state !== 'object' || state === null) {
        throw new Error('Invalid Ares production state: expected an object');
    }
}

/**
 * Restores only the Ares-owned production collections.  The target sets are
 * replaced atomically from the validated state so a failed/partial load cannot
 * leave stale captured plans behind.
 */
export function restoreAresProductionExtensionState(
    target: AresProductionStateTarget,
    state: unknown,
): void {
    assertStateObject(state);
    // Version 1 predates reverse-engineered plans. It remains readable so
    // older saves do not lose their existing stolen-tech/factory state.
    if (state.version !== 1 && state.version !== ARES_PRODUCTION_STATE_VERSION) {
        throw new Error(`Unsupported Ares production state version: ${String(state.version)}`);
    }
    if (!Array.isArray(state.stolenTechs) || !Array.isArray(state.permanentFactoryOwnerPlans)) {
        throw new Error('Invalid Ares production state: collections must be arrays');
    }
    if (state.version === ARES_PRODUCTION_STATE_VERSION && !Array.isArray(state.reverseEngineeredPlans)) {
        throw new Error('Invalid Ares production state: reverseEngineeredPlans must be an array');
    }

    const normalized = serializeAresProductionExtensionState({
        stolenTech: state.stolenTechs as Array<number | SideId>,
        permanentFactoryOwnerPlans: state.permanentFactoryOwnerPlans as string[],
        reverseEngineeredPlans: (state.version === 1 ? [] : state.reverseEngineeredPlans) as string[],
    });

    target.stolenTech.clear();
    for (const value of normalized.stolenTechs) {
        target.stolenTech.add(value);
    }
    target.permanentFactoryOwnerPlans.clear();
    for (const value of normalized.permanentFactoryOwnerPlans) {
        target.permanentFactoryOwnerPlans.add(value);
    }
    target.reverseEngineeredPlans.clear();
    for (const value of normalized.reverseEngineeredPlans) {
        target.reverseEngineeredPlans.add(value);
    }
}
