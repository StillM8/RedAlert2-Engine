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

export function traceAresWaveCells(
    start: { x: number; z: number },
    end: { x: number; z: number },
    tileSize: number = 256,
): AresCellOffset[] {
    if (![start.x, start.z, end.x, end.z].every(Number.isFinite)) return [];
    const size = Number.isFinite(tileSize) && tileSize > 0 ? tileSize : 256;
    let x = Math.floor(start.x / size);
    let y = Math.floor(start.z / size);
    const endX = Math.floor(end.x / size);
    const endY = Math.floor(end.z / size);
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dz > 0 ? 1 : -1;
    const nextBoundaryX = (dx > 0 ? x + 1 : x) * size;
    const nextBoundaryY = (dz > 0 ? y + 1 : y) * size;
    let tMaxX = dx === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryX - start.x) / dx;
    let tMaxY = dz === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryY - start.z) / dz;
    const tDeltaX = dx === 0 ? Number.POSITIVE_INFINITY : size / Math.abs(dx);
    const tDeltaY = dz === 0 ? Number.POSITIVE_INFINITY : size / Math.abs(dz);
    const cells: AresCellOffset[] = [{ x, y }];
    const epsilon = 1e-12;
    while (x !== endX || y !== endY) {
        if (x === endX) {
            y += stepY;
            tMaxY += tDeltaY;
        }
        else if (y === endY) {
            x += stepX;
            tMaxX += tDeltaX;
        }
        else if (tMaxX < tMaxY - epsilon) {
            x += stepX;
            tMaxX += tDeltaX;
        }
        else if (tMaxY < tMaxX - epsilon) {
            y += stepY;
            tMaxY += tDeltaY;
        }
        else {
            x += stepX;
            y += stepY;
            tMaxX += tDeltaX;
            tMaxY += tDeltaY;
        }
        cells.push({ x, y });
    }
    return cells;
}

export interface AresProjectileAnimationFrameInput {
    direction: number;
    rotates: boolean;
    animLength: number;
    animRate: number;
    ageTicks: number;
    frameCount: number;
}

/**
 * Resolve the SHP frame for Ares animated Rotates=yes projectiles. Each of
 * the 32 facings owns AnimLength consecutive frames. Simulation age is used
 * so render-frame rate cannot change the selected frame.
 */
export function resolveAresProjectileAnimationFrame(input: AresProjectileAnimationFrameInput): number {
    const frameCount = Math.max(1, Math.floor(input.frameCount));
    if (!input.rotates) return 0;
    const animLength = Math.max(1, Math.floor(input.animLength));
    const animRate = Math.max(1, Math.floor(input.animRate));
    const facing = Math.round((((input.direction - 45 + 360) % 360) / 360) * 32) % 32;
    const animationFrame = Math.floor(Math.max(0, input.ageTicks) / animRate) % animLength;
    return Math.min(frameCount - 1, facing * animLength + animationFrame);
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
