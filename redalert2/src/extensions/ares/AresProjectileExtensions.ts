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

export interface AresRangedTravelDecision {
    /** Distance the projectile may move this tick in the caller's units. */
    distance: number;
    /** Accumulated distance after applying this movement. */
    travelDistance: number;
    /** True when the projectile has consumed all configured fuel/range. */
    exhausted: boolean;
}

/**
 * Resolve one deterministic movement step for Ares Ranged=yes projectiles.
 *
 * Keeping this unit-agnostic makes the rule independently testable; the game
 * passes both distances in leptons.  Non-ranged projectiles are deliberately
 * unchanged.  A zero range therefore detonates before travelling, while the
 * documented default is supplied by WeaponRules as 390 cells.
 */
export function resolveAresRangedTravel(
    requestedDistance: number,
    travelDistance: number,
    ranged: boolean,
    maxTravelDistance: number,
): AresRangedTravelDecision {
    const requested = Math.max(0, requestedDistance);
    const traveled = Math.max(0, travelDistance);
    if (!ranged) {
        return {
            distance: requested,
            travelDistance: traveled + requested,
            exhausted: false,
        };
    }

    const maximum = Math.max(0, maxTravelDistance);
    const remaining = Math.max(0, maximum - traveled);
    const distance = Math.min(requested, remaining);
    const nextTravelDistance = traveled + distance;
    return {
        distance,
        travelDistance: nextTravelDistance,
        exhausted: nextTravelDistance >= maximum,
    };
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

/**
 * QuadTree query order depends on insertion and movement history. Ares' split
 * selection must see one stable candidate order in every lockstep peer.
 */
export function sortAresSplitCandidates<T extends {
    id?: number | string;
    name?: string;
    tile?: { rx?: number; ry?: number; z?: number };
}>(candidates: readonly T[]): T[] {
    const key = (candidate: T): [number, number, string] => {
        const numericId = Number(candidate.id);
        if (Number.isFinite(numericId)) return [0, numericId, ""];
        const tile = candidate.tile;
        return [
            1,
            0,
            `${String(candidate.name ?? "").toLocaleLowerCase("en-US")}|${tile?.rx ?? 0}|${tile?.ry ?? 0}|${tile?.z ?? 0}`,
        ];
    };
    return [...candidates].sort((left, right) => {
        const a = key(left);
        const b = key(right);
        return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
    });
}
