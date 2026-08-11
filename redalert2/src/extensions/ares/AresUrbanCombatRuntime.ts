import type {
    AresUrbanCombatBuildingRules,
    AresUrbanCombatProjectileRules,
} from "@/extensions/ares/AresUrbanCombat";

export type AresUrbanCombatHitDecision =
    | { kind: "building"; passThrough: false }
    | { kind: "occupant-fatal"; passThrough: true }
    | { kind: "occupant-damage"; passThrough: true; damage: number };

export interface AresUrbanCombatOccupancyContext {
    /** Vanilla/Ares CanBeOccupied=yes on the target building. */
    buildingCanBeOccupied: boolean;
    /** Vanilla/Ares Occupier=yes on the infantry type. */
    infantryIsOccupier: boolean;
    /** Whether the target has reached MaxNumberOccupants. */
    buildingIsFull: boolean;
    /** Whether the target currently has no occupants. */
    buildingIsEmpty: boolean;
    /** Whether this infantry belongs to the building's current owner. */
    sameOwner: boolean;
    /** Neutral buildings may be occupied by foreign infantry in Antares. */
    buildingIsNeutral: boolean;
    /** A hostile/foreign infantry attempt, used for Bunker.Raidable. */
    infantryIsHostile: boolean;
    /** Antares rejects mind-controlled infantry from this occupancy path. */
    infantryIsMindControlled?: boolean;
    /** Optional caller-supplied red-health/other occupancy veto. */
    occupancyBlocked?: boolean;
}

function clampUnit(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    // Keep 1 as a valid upper-bound input from preventing a 100% chance.
    return Math.min(1 - Number.EPSILON, Math.max(0, value));
}

function safeChance(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function safeMultiplier(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value : 1;
}

/**
 * Returns the effective pass-through chance for one projectile/building hit.
 *
 * Ares only considers pass-through when occupants exist and UC.PassThrough is
 * positive. SubjectToTrenches=yes uses the configured chance; no forces the
 * effective chance to 100%, matching Antares' bullet hook and Ares docs.
 */
export function getAresUrbanCombatPassThroughChance(
    building: Pick<AresUrbanCombatBuildingRules, "passThrough">,
    projectile: Pick<AresUrbanCombatProjectileRules, "subjectToTrenches">,
    hasOccupants: boolean,
): number {
    const configuredChance = safeChance(building.passThrough);
    if (!hasOccupants || configuredChance <= 0) return 0;
    return projectile.subjectToTrenches ? configuredChance : 1;
}

/**
 * Resolves the building-versus-occupant result with caller-supplied rolls.
 * Supplying rolls keeps this adapter deterministic and leaves random-stream
 * ownership to the eventual projectile/combat integration point.
 */
export function resolveAresUrbanCombatHit(
    building: Pick<AresUrbanCombatBuildingRules, "passThrough" | "fatalRate" | "damageMultiplier">,
    projectile: Pick<AresUrbanCombatProjectileRules, "subjectToTrenches">,
    input: {
        hasOccupants: boolean;
        passThroughRoll: number;
        fatalRoll: number;
        weaponDamage: number;
    },
): AresUrbanCombatHitDecision {
    const passThroughChance = getAresUrbanCombatPassThroughChance(
        building,
        projectile,
        input.hasOccupants,
    );
    if (clampUnit(input.passThroughRoll, 1) >= passThroughChance) {
        return { kind: "building", passThrough: false };
    }

    if (clampUnit(input.fatalRoll, 1) < safeChance(building.fatalRate)) {
        return { kind: "occupant-fatal", passThrough: true };
    }

    const damage = Math.ceil(
        Math.max(0, Number.isFinite(input.weaponDamage) ? input.weaponDamage : 0) *
        safeMultiplier(building.damageMultiplier),
    );
    return { kind: "occupant-damage", passThrough: true, damage };
}

/** Whether an empty Bunker.Raidable building may be entered by this infantry. */
export function canAresBunkerBeRaided(
    building: Pick<AresUrbanCombatBuildingRules, "bunkerRaidable">,
    context: Pick<AresUrbanCombatOccupancyContext, "buildingIsEmpty" | "infantryIsHostile">,
): boolean {
    return building.bunkerRaidable && context.buildingIsEmpty && context.infantryIsHostile;
}

/**
 * Applies Antares' generic CanBeOccupiedBy and ownership gates without
 * resolving game objects. An empty allowed list means no type restriction;
 * otherwise the infantry name must match case-insensitively.
 */
export function canAresUrbanCombatInfantryOccupy(
    building: Pick<AresUrbanCombatBuildingRules, "bunkerRaidable" | "canBeOccupiedBy">,
    infantryType: string,
    context: AresUrbanCombatOccupancyContext,
): boolean {
    if (!context.buildingCanBeOccupied || !context.infantryIsOccupier || context.buildingIsFull) {
        return false;
    }
    if (context.infantryIsMindControlled || context.occupancyBlocked) return false;

    const normalizedInfantry = infantryType.trim().toLocaleLowerCase("en-US");
    if (!normalizedInfantry) return false;
    const allowed = building.canBeOccupiedBy
        .map(value => value.trim().toLocaleLowerCase("en-US"))
        .filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(normalizedInfantry)) return false;

    return context.sameOwner || context.buildingIsNeutral || canAresBunkerBeRaided(building, context);
}
