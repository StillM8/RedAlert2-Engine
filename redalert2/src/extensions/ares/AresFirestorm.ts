/**
 * Standalone Firestorm state and wall queries.
 *
 * Antares keeps Firestorm active per owner and checks active wall buildings
 * along a projectile path. The TypeScript engine exposes the same semantic
 * predicate to collision code instead of reproducing Antares' map hooks.
 */

export function isAresFirestormActive(owner: any): boolean {
    return owner?.aresFirestormActive === true;
}

export function setAresFirestormActive(owner: any, active: boolean): void {
    if (owner) owner.aresFirestormActive = active;
}

export function isAresFirestormWall(object: any): boolean {
    return !!object &&
        object.isDestroyed !== true &&
        !object.limboData &&
        (object.rules?.firestormWall === true || object.rules?.ares?.firestormWall === true);
}

/**
 * A wall owned by the projectile source does not block that source. This
 * deliberately follows Antares' owner-identity check; allied walls are not
 * silently treated as the firing player's own wall.
 */
export function isAresActiveFirestormWall(object: any, ignoredOwner?: any): boolean {
    return isAresFirestormWall(object) &&
        object.owner !== ignoredOwner &&
        isAresFirestormActive(object.owner);
}

export interface FirestormTileOccupation {
    getObjectsOnTile(tile: any): readonly any[];
}

export function findAresActiveFirestormWall(
    tile: any,
    ignoredOwner: any,
    occupation: FirestormTileOccupation,
): any | undefined {
    return occupation.getObjectsOnTile(tile)
        .find(object => isAresActiveFirestormWall(object, ignoredOwner));
}

export interface FirestormNeighbourMap {
    getTileByMapCoords(x: number, y: number): any;
    getObjectsOnTile(tile: any): readonly any[];
}

/**
 * Returns the four-way connection mask used by the Firestorm wall artwork.
 * Antares links only live, same-owner Firestorm wall buildings; diagonal
 * neighbours do not contribute a connection.
 */
export function getAresFirestormConnectionMask(
    wall: any,
    map: FirestormNeighbourMap,
): number {
    if (!wall?.tile || !wall.owner || !isAresFirestormWall(wall)) return 0;
    const directions = [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
    ];
    let mask = 0;
    for (let index = 0; index < directions.length; index++) {
        const direction = directions[index];
        const tile = map.getTileByMapCoords(
            wall.tile.rx + direction.x,
            wall.tile.ry + direction.y,
        );
        if (!tile) continue;
        const connected = map.getObjectsOnTile(tile).some(object =>
            object !== wall &&
            object.owner === wall.owner &&
            isAresFirestormWall(object),
        );
        if (connected) mask |= 1 << index;
    }
    return mask;
}

/**
 * Reduces the active Firestorm duration when an active wall absorbs damage.
 * The wall itself remains intact, matching Antares' ReceiveDamage hook; the
 * configured coefficient converts incoming damage into charge-timer ticks.
 */
export function applyAresFirestormWallDamage(
    wall: any,
    damage: number,
    coefficient = 1,
): boolean {
    if (!isAresFirestormWall(wall) || !isAresFirestormActive(wall.owner)) {
        return false;
    }
    const amount = Math.max(0, Math.floor(damage * coefficient));
    const weapon = wall.owner?.superWeaponsTrait?.getAll?.()
        ?.find((candidate: any) => candidate.rules?.ares?.extensionType === "Firestorm");
    if (!weapon?.isChargeDrainActive?.()) return true;
    weapon.reduceChargeDrain(amount);
    return true;
}
