/**
 * Pure Ares damage-particle candidate selection.
 *
 * This adapter does not create particle systems, choose a random candidate,
 * or call a renderer. It only applies Ares' precedence and defaults to the
 * already-resolved particle-system definitions supplied by a caller.
 */

export interface AresDamageParticleSystem {
    /** Authored ParticleSystem ID; casing is retained. */
    id: string;
    /** ParticleSystem BehavesLike value used by the vanilla fallback. */
    behavesLike?: string;
}

export interface AresDamageParticleRules {
    /** Whether the techno is an InfantryType. */
    isInfantry: boolean;
    /** Vanilla Cyborg flag used by the documented DamageSparks default. */
    cyborg: boolean;
    /** Vanilla DamageParticleSystems candidates, including behavior metadata. */
    damageParticleSystems?: readonly (AresDamageParticleSystem | string)[];
    /** Optional Ares override; [] is an authored empty override. */
    damageSmokeParticleSystems?: readonly (AresDamageParticleSystem | string)[];
    /** Optional Ares override; [] is an authored empty override. */
    damageSparksParticleSystems?: readonly (AresDamageParticleSystem | string)[];
    /** Optional Ares override for the spark enablement flag. */
    damageSparks?: boolean;
}

export interface AresDamageParticleSelection {
    /** Whether repeated damage sparks are enabled for this techno. */
    damageSparksEnabled: boolean;
    /** Candidate systems for severe-damage smoke. */
    damageSmokeParticleSystems: AresDamageParticleSystem[];
    /** Candidate systems for repeated damage sparks. */
    damageSparksParticleSystems: AresDamageParticleSystem[];
}

function normalizeSystem(
    system: AresDamageParticleSystem | string,
): AresDamageParticleSystem | undefined {
    if (typeof system === "string") {
        const id = system.trim();
        return id ? { id } : undefined;
    }

    const id = typeof system?.id === "string" ? system.id.trim() : "";
    if (!id) return undefined;

    const behavesLike = typeof system.behavesLike === "string"
        ? system.behavesLike.trim()
        : undefined;
    return behavesLike
        ? { id, behavesLike }
        : { id };
}

function copySystems(
    systems: readonly (AresDamageParticleSystem | string)[] | undefined,
): AresDamageParticleSystem[] {
    return (systems ?? [])
        .map(normalizeSystem)
        .filter((system): system is AresDamageParticleSystem => system !== undefined);
}

function fallbackSystems(
    systems: readonly AresDamageParticleSystem[],
    behavesLike: "smoke" | "spark",
): AresDamageParticleSystem[] {
    return systems
        .filter(system => system.behavesLike?.trim().toLocaleLowerCase("en-US") === behavesLike)
        .map(system => ({ ...system }));
}

/**
 * Resolve Ares' damage-particle candidates without mutating the input.
 *
 * An authored Ares list takes precedence even when it is empty, and its
 * entries are not restricted by BehavesLike. When the override is absent,
 * the vanilla DamageParticleSystems list is filtered to Smoke or Spark.
 * DamageSparks defaults to Cyborg only for infantry, and to false otherwise.
 */
export function resolveAresDamageParticleSelection(
    rules: AresDamageParticleRules,
): AresDamageParticleSelection {
    const baseSystems = copySystems(rules.damageParticleSystems);
    const smokeSystems = rules.damageSmokeParticleSystems === undefined
        ? fallbackSystems(baseSystems, "smoke")
        : copySystems(rules.damageSmokeParticleSystems);
    const sparkSystems = rules.damageSparksParticleSystems === undefined
        ? fallbackSystems(baseSystems, "spark")
        : copySystems(rules.damageSparksParticleSystems);

    return {
        damageSparksEnabled: rules.damageSparks ?? (rules.isInfantry && rules.cyborg),
        damageSmokeParticleSystems: smokeSystems,
        damageSparksParticleSystems: sparkSystems,
    };
}
