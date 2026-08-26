/**
 * Contract for simulation state that can alter future tick results.
 *
 * Every piece of mutable simulation state must be classified into exactly
 * one of these categories, and canonical state MUST implement this
 * interface (getHash at minimum; captureState/restoreState when the state
 * outlives a tick boundary):
 *
 * 1. Authored rules      — immutable after load. Never hashed, never snapshotted.
 * 2. Presentation-only   — render/audio/UI caches. May mutate freely; never
 *                          hashed (a divergence cannot change the simulation).
 * 3. Derived             — recomputable from canonical state + rules. May be
 *                          cached; hashing optional (must never disagree with
 *                          its inputs' hash).
 * 4. Canonical           — determines what the NEXT tick does. Must be hashed
 *                          and snapshot-restorable.
 * 5. External resources  — audio handles, sockets, textures. Never hashed.
 *
 * Rule of thumb: if two peers could disagree on this field while agreeing on
 * everything else, and the disagreement would eventually cause a different
 * command result, it is canonical (#4).
 */
export interface DeterministicStateOwner<TSnapshot = unknown> {
    /** Contributes this state's fingerprint to the enclosing entity hash. */
    getHash(): number;

    /** JSON-safe canonical snapshot of category-#4 state only. */
    captureState(): TSnapshot;

    /**
     * Replaces canonical state from a snapshot. Must validate the payload
     * transactionally: throw WITHOUT mutating on invalid input.
     */
    restoreState(state: TSnapshot, context?: unknown): void;
}
