/**
 * Normalized Ares custom Ivan Bomb data.
 *
 * Ares keeps the bomb attachment in the shared Ivan-bomb mechanic, but moves
 * the damage, fuse, bridge, image, and sound choices onto the weapon that
 * planted it.  Keeping the authored values separate from the resolved charge
 * lets the ordinary RA2/YR global fallbacks remain unchanged.
 */

export interface AresIvanBombSection {
    getBool(key: string, defaultValue?: boolean): boolean;
    getNumber(key: string, defaultValue?: number): number;
    getString(key: string, defaultValue?: string): string;
    has(key: string): boolean;
}

export interface AresIvanBombRules {
    /** Undocumented Antares-compatible death-bomb selector. */
    deathBomb: boolean;
    /** Undocumented Antares-compatible allied-target death-bomb selector. */
    deathBombOnAllies: boolean;
    destroysBridges: boolean;
    detachable: boolean;
    damage?: number;
    delay?: number;
    tickingSound?: string;
    attachSound?: string;
    warhead?: string;
    image?: string;
    flickerRate?: number;
    canDetonateTimeBomb?: boolean;
    canDetonateDeathBomb?: boolean;
    detonateOnSell: boolean;
}

export interface AresIvanBombChargeRules {
    deathBomb: boolean;
    destroysBridges: boolean;
    detachable: boolean;
    damage: number;
    delay: number;
    tickingSound?: string;
    attachSound?: string;
    warhead: string;
    image?: string;
    flickerRate: number;
    canDetonateTimeBomb: boolean;
    canDetonateDeathBomb: boolean;
    detonateOnSell: boolean;
}

function optionalString(section: AresIvanBombSection, key: string): string | undefined {
    if (!section.has(key)) return undefined;
    const value = section.getString(key).trim();
    return value || undefined;
}

function optionalInteger(section: AresIvanBombSection, key: string): number | undefined {
    if (!section.has(key)) return undefined;
    const value = section.getNumber(key, Number.NaN);
    return Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/** Parse the weapon-level Ares Ivan Bomb extensions and their documented defaults. */
export function parseAresIvanBombRules(section: AresIvanBombSection): AresIvanBombRules {
    return {
        deathBomb: section.getBool("IvanBomb.DeathBomb"),
        deathBombOnAllies: section.getBool("IvanBomb.DeathBombOnAllies"),
        destroysBridges: section.getBool("IvanBomb.DestroysBridges", true),
        detachable: section.getBool("IvanBomb.Detachable", true),
        damage: optionalInteger(section, "IvanBomb.Damage"),
        delay: optionalInteger(section, "IvanBomb.Delay"),
        tickingSound: optionalString(section, "IvanBomb.TickingSound"),
        attachSound: optionalString(section, "IvanBomb.AttachSound"),
        warhead: optionalString(section, "IvanBomb.Warhead"),
        image: optionalString(section, "IvanBomb.Image"),
        flickerRate: optionalInteger(section, "IvanBomb.FlickerRate"),
        canDetonateTimeBomb: section.has("IvanBomb.CanDetonateTimeBomb")
            ? section.getBool("IvanBomb.CanDetonateTimeBomb")
            : undefined,
        canDetonateDeathBomb: section.has("IvanBomb.CanDetonateDeathBomb")
            ? section.getBool("IvanBomb.CanDetonateDeathBomb")
            : undefined,
        detonateOnSell: section.getBool("IvanBomb.DetonateOnSell", true),
    };
}

interface CombatDamageFallbacks {
    ivanDamage?: number;
    ivanTimedDelay?: number;
    ivanIconFlickerRate?: number;
    ivanWarhead?: string;
    canDetonateTimeBomb?: boolean;
    canDetonateDeathBomb?: boolean;
}

/** Resolve one planted charge against the active ruleset's global fallbacks. */
export function resolveAresIvanBombRules(
    rules: AresIvanBombRules,
    combatDamage: CombatDamageFallbacks,
    alliedTarget: boolean,
): AresIvanBombChargeRules {
    const deathBomb = alliedTarget ? rules.deathBombOnAllies : rules.deathBomb;
    return {
        deathBomb,
        destroysBridges: rules.destroysBridges,
        detachable: rules.detachable,
        damage: rules.damage ?? combatDamage.ivanDamage ?? 0,
        // Death bombs never auto-detonate; a negative delay disables the
        // automatic timer so the charge stays active until the victim dies
        // or the owner manually detonates it.
        delay: deathBomb ? -1 : Math.max(0, rules.delay ?? combatDamage.ivanTimedDelay ?? 0),
        tickingSound: rules.tickingSound,
        attachSound: rules.attachSound,
        warhead: rules.warhead || combatDamage.ivanWarhead || "",
        image: rules.image,
        flickerRate: Math.max(0, rules.flickerRate ?? combatDamage.ivanIconFlickerRate ?? 0),
        canDetonateTimeBomb: rules.canDetonateTimeBomb ?? combatDamage.canDetonateTimeBomb ?? true,
        canDetonateDeathBomb: rules.canDetonateDeathBomb ?? combatDamage.canDetonateDeathBomb ?? true,
        detonateOnSell: rules.detonateOnSell,
    };
}
