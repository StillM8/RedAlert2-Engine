import type { AresTechnoExtensions } from './AresTechnoExtensions';

interface AresManualControlHostRules {
    ares?: Pick<AresTechnoExtensions, 'manualControl'>;
}

/**
 * Ares NoManualFire is a player-input/cursor restriction only. Keep this
 * predicate separate from AttackTrait/AttackOrder simulation so retaliation,
 * opportunity fire, AI, triggers, and scripted orders remain valid.
 */
export function allowsAresManualFire(rules: AresManualControlHostRules | undefined): boolean {
    return rules?.ares?.manualControl?.noManualFire !== true;
}

/** Parsed now so the future self-GuardArea cursor path has one normalized gate. */
export function allowsAresSelfGuardArea(rules: AresManualControlHostRules | undefined): boolean {
    return rules?.ares?.manualControl?.noSelfGuardArea !== true;
}
