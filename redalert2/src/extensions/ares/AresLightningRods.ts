export interface AresLightningRodTarget {
    id?: number | string;
    name?: string;
    tile?: { rx: number; ry: number; z?: number };
    isSpawned?: boolean;
    isDisposed?: boolean;
    isDestroyed?: boolean;
    isCrashing?: boolean;
    limboData?: unknown;
    rules?: {
        lightningRod?: boolean;
        lightningRodModifier?: number;
    };
    isTechno?(): boolean;
    isBuilding?(): boolean;
}

export interface AresTileCoord {
    rx: number;
    ry: number;
    z?: number;
}

function stableTargetKey(target: AresLightningRodTarget): string {
    const numericId = Number(target.id);
    if (Number.isFinite(numericId)) return `0:${numericId.toString().padStart(16, "0")}`;
    return `1:${String(target.name ?? "").toLocaleLowerCase("en-US")}:${target.tile?.rx ?? 0}:${target.tile?.ry ?? 0}:${target.tile?.z ?? 0}`;
}

function distanceSquared(a: AresTileCoord, b: AresTileCoord): number {
    const dx = a.rx - b.rx;
    const dy = a.ry - b.ry;
    const dz = (a.z ?? 0) - (b.z ?? 0);
    return dx * dx + dy * dy + dz * dz;
}

/**
 * Ares Lightning Rod cloud attraction.
 *
 * Random Lightning Storm clouds are first assigned their ordinary random
 * cell. If the nearest live TechnoType to that cell is a BuildingType with
 * LightningRod=yes, the cloud is moved above that building. The deterministic
 * tie-break is important because Set/QuadTree iteration order must not become
 * lockstep-visible state.
 */
export function resolveAresLightningRodCloudTile(
    randomTile: AresTileCoord,
    candidates: Iterable<AresLightningRodTarget>,
    ignoreLightningRod = false,
): AresTileCoord {
    if (ignoreLightningRod) return randomTile;

    let nearest: AresLightningRodTarget | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestKey = "";
    for (const candidate of candidates) {
        if (candidate.isSpawned === false || candidate.isDisposed || candidate.isDestroyed ||
            candidate.isCrashing || candidate.limboData || !candidate.tile ||
            candidate.isTechno?.() === false) {
            continue;
        }
        const distance = distanceSquared(randomTile, candidate.tile);
        const key = stableTargetKey(candidate);
        if (distance < nearestDistance || (distance === nearestDistance && (!nearest || key < nearestKey))) {
            nearest = candidate;
            nearestDistance = distance;
            nearestKey = key;
        }
    }

    return nearest?.isBuilding?.() === true && nearest.rules?.lightningRod === true
        ? nearest.tile!
        : randomTile;
}

/** Apply LightningRod.Modifier to the rod itself, not other CellSpread victims. */
export function resolveAresLightningRodDamage(
    damage: number,
    target: AresLightningRodTarget,
    isWeatherStorm: boolean,
    ignoreLightningRod = false,
): number {
    if (!isWeatherStorm || ignoreLightningRod || target.isBuilding?.() !== true ||
        target.rules?.lightningRod !== true) {
        return damage;
    }
    const modifier = Number.isFinite(target.rules?.lightningRodModifier)
        ? target.rules!.lightningRodModifier!
        : 1;
    return damage * modifier;
}
