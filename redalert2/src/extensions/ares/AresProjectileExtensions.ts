/**
 * Normalized projectile extension values used by the standalone runtime.
 *
 * Ares/Antares treats Airburst as the legacy cell fan-out behavior and
 * Splits as the target-retargeting behavior.  They share the same
 * AirburstWeapon/Cluster plumbing, but their target pools are different.
 */
export interface AresProjectileExtensionRules {
    airburst: boolean;
    airburstWeapon?: string;
    cluster: number;
    airburstSpread: number;
    aroundTarget?: boolean;
    splits: boolean;
    retargetAccuracy: number;
    retargetSelf: boolean;
}

export interface AresCellOffset {
    x: number;
    y: number;
}

/**
 * Antares treats either Airburst or Splits as replacing the projectile's
 * ordinary detonation with child projectiles.
 */
export function hasAresProjectileSplitBehavior(
    rules: Pick<AresProjectileExtensionRules, "airburst" | "splits">,
): boolean {
    return rules.airburst || rules.splits;
}

/**
 * Return deterministic cell offsets for the CellRangeIterator-style circular
 * airburst pool.  The center is included for a zero/less-than-one spread.
 * Ordering is stable so child projectile creation remains lockstep-safe.
 */
export function getAresAirburstCellOffsets(spread: number): AresCellOffset[] {
    const radius = Math.max(0, spread);
    const maxOffset = Math.ceil(radius);
    const offsets: AresCellOffset[] = [];

    for (let y = -maxOffset; y <= maxOffset; y++) {
        for (let x = -maxOffset; x <= maxOffset; x++) {
            if (Math.sqrt(x * x + y * y) <= radius) {
                offsets.push({ x, y });
            }
        }
    }

    offsets.sort((a, b) => {
        const distance = (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y);
        return distance || a.y - b.y || a.x - b.x;
    });
    return offsets;
}

/**
 * Antares keeps the original target with RetargetAccuracy probability.  A
 * value of 0 therefore always chooses from the retarget pool, while 1 always
 * keeps the original target when one exists.
 */
export function shouldRetargetAresSplit(
    hasOriginalTarget: boolean,
    retargetAccuracy: number,
    randomValue: number,
): boolean {
    return !hasOriginalTarget || retargetAccuracy < randomValue;
}

export function chooseAresSplitTargetIndex(
    targetCount: number,
    randomValue: number,
): number {
    if (targetCount <= 0) return -1;
    const normalized = Math.max(0, Math.min(0.999999999999, randomValue));
    return Math.floor(normalized * targetCount);
}
