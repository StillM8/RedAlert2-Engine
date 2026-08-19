export interface AresCustomMissileSectionLike {
    getBool(key: string, fallback?: boolean): boolean;
    getNumber(key: string, fallback?: number): number;
    getString(key: string, fallback?: string): string;
    has?(key: string): boolean;
}

/**
 * Per-AircraftType Ares custom rocket data.
 *
 * Ares deliberately defaults custom RocketStruct values to zero; mod authors
 * are expected to provide meaningful Missile.* values when Missile.Custom=yes.
 * Conversion into the engine's world/angle units happens at the host boundary.
 */
export interface AresCustomMissileRules {
    custom: boolean;
    pauseFrames: number;
    tiltFrames: number;
    pitchInitial: number;
    pitchFinal: number;
    turnRate: number;
    raiseRate: number;
    acceleration: number;
    altitude: number;
    damage: number;
    eliteDamage: number;
    bodyLength: number;
    lazyCurve: boolean;
    warhead?: string;
    eliteWarhead?: string;
    weapon?: string;
    eliteWeapon?: string;
    takeOffAnim?: string;
    trailerAnim?: string;
    trailerSeparation: number;
}

function optionalName(section: AresCustomMissileSectionLike, key: string, fallback?: string): string | undefined {
    const value = section.getString(key, fallback ?? "").trim();
    return value && value.toLocaleLowerCase("en-US") !== "none" ? value : undefined;
}

export function hasAresCustomMissileFields(section: { entries?: Map<string, unknown> }): boolean {
    for (const key of section.entries?.keys?.() ?? []) {
        if (key.trim().toLocaleLowerCase("en-US").startsWith("missile.")) return true;
    }
    return false;
}

export function parseAresCustomMissileRules(section: AresCustomMissileSectionLike): AresCustomMissileRules {
    return {
        custom: section.getBool("Missile.Custom"),
        pauseFrames: Math.max(0, Math.floor(section.getNumber("Missile.PauseFrames"))),
        tiltFrames: Math.max(0, Math.floor(section.getNumber("Missile.TiltFrames"))),
        pitchInitial: section.getNumber("Missile.PitchInitial"),
        pitchFinal: section.getNumber("Missile.PitchFinal"),
        turnRate: Math.max(0, section.getNumber("Missile.TurnRate")),
        raiseRate: Math.max(0, section.getNumber("Missile.RaiseRate")),
        acceleration: Math.max(0, section.getNumber("Missile.Acceleration")),
        altitude: Math.max(0, section.getNumber("Missile.Altitude")),
        damage: Math.floor(section.getNumber("Missile.Damage")),
        eliteDamage: Math.floor(section.getNumber("Missile.EliteDamage")),
        bodyLength: Math.max(0, section.getNumber("Missile.BodyLength")),
        lazyCurve: section.getBool("Missile.LazyCurve"),
        warhead: optionalName(section, "Missile.Warhead"),
        eliteWarhead: optionalName(section, "Missile.EliteWarhead"),
        weapon: optionalName(section, "Missile.Weapon"),
        eliteWeapon: optionalName(section, "Missile.EliteWeapon"),
        takeOffAnim: optionalName(section, "Missile.TakeOffAnim", "V3TAKOFF"),
        trailerAnim: optionalName(section, "Missile.TrailerAnim", "V3TRAIL"),
        trailerSeparation: Math.max(1, Math.floor(section.getNumber("Missile.TrailerSeparation", 3))),
    };
}

/** Select the promoted custom payload using the parent spawner's rank. */
export function resolveAresCustomMissilePayload(
    rules: AresCustomMissileRules,
    elite: boolean,
): { damage: number; warhead?: string; weapon?: string } {
    return elite
        ? {
            damage: rules.eliteDamage,
            warhead: rules.eliteWarhead ?? rules.warhead,
            weapon: rules.eliteWeapon ?? rules.weapon,
        }
        : { damage: rules.damage, warhead: rules.warhead, weapon: rules.weapon };
}
