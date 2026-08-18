const jamRadiusByRules = new WeakMap<object, number>();

function readRadius(rules: any): number {
    if (!rules || (typeof rules !== "object" && typeof rules !== "function")) return 0;
    const cached = jamRadiusByRules.get(rules);
    if (cached !== undefined) return cached;
    const authored = Number.isFinite(rules.radarJamRadius)
        ? Number(rules.radarJamRadius)
        : Number(rules.ini?.getNumber?.("RadarJamRadius", 0) ?? 0);
    const radius = Math.max(0, authored || 0);
    jamRadiusByRules.set(rules, radius);
    return radius;
}

export function getAresRadarJamRadius(objectOrRules: any): number {
    return readRadius(objectOrRules?.rules ?? objectOrRules);
}

function tileOf(object: any): any {
    return object?.centerTile ?? object?.tile;
}

export function isWithinAresRadarJamRadius(jammer: any, provider: any): boolean {
    const radius = getAresRadarJamRadius(jammer);
    if (radius <= 0) return false;
    const source = tileOf(jammer);
    const target = tileOf(provider);
    if (!source || !target) return false;
    const dx = Number(source.rx ?? 0) - Number(target.rx ?? 0);
    const dy = Number(source.ry ?? 0) - Number(target.ry ?? 0);
    return dx * dx + dy * dy <= radius * radius;
}

/**
 * Ares Red Alert-style RadarJamRadius affects only hostile Radar/SpySat
 * providers in range. It does not deactivate the provider building itself.
 */
export function isAresRadarProviderJammed(provider: any, game: any): boolean {
    if (!provider?.isSpawned || provider.isDestroyed || !provider.owner) return false;
    for (const player of game.getCombatants?.() ?? []) {
        if (player === provider.owner || game.alliances?.areAllied?.(player, provider.owner)) {
            continue;
        }
        for (const jammer of player.getOwnedObjects?.(true) ?? player.getOwnedObjects?.() ?? []) {
            if (!jammer?.isSpawned || jammer.isDestroyed || jammer.isCrashing) continue;
            if (getAresRadarJamRadius(jammer) <= 0) continue;
            if (isWithinAresRadarJamRadius(jammer, provider)) return true;
        }
    }
    return false;
}

export function hasOperationalAresRadarProvider(
    player: any,
    game: any,
    predicate: (building: any) => boolean,
): boolean {
    for (const building of player?.buildings ?? []) {
        if (!building?.isSpawned || building.isDestroyed) continue;
        if (!predicate(building)) continue;
        if (building.warpedOutTrait?.isActive?.()) continue;
        if (!isAresRadarProviderJammed(building, game)) return true;
    }
    return false;
}
