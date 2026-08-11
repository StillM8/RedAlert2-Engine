import type { AresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";

export interface AresHunterSeekerGeneralRules {
    hunterSeekerBuildings?: readonly string[];
    hunterSeekerDetonateProximity?: number;
    hunterSeekerDescendProximity?: number;
    hunterSeekerAscentSpeed?: number;
    hunterSeekerDescentSpeed?: number;
    hunterSeekerEmergeSpeed?: number;
}

export interface AresHunterSeekerSideRules {
    hunterSeeker?: string;
}

export interface AresHunterSeekerConfiguration {
    typeName?: string;
    buildingTypes: readonly string[];
    randomOnly: boolean;
    maxCount: number;
    detonateProximity: number;
    descendProximity: number;
    ascentSpeed: number;
    descentSpeed: number;
    emergeSpeed: number;
}

function normalize(value: string | undefined): string {
    return (value ?? "").trim().toLocaleLowerCase("en-US");
}

function firstDefined(...values: Array<number | undefined>): number {
    return values.find((value) => value !== undefined && Number.isFinite(value)) ?? 0;
}

/**
 * Resolve the authored Hunter Seeker data once at activation time.  Antares
 * takes the per-superweapon value first, then the owning side's unit, while
 * the global [SpecialWeapons]/[General] values provide the remaining
 * fallbacks.  Keeping this as a pure normalized helper prevents launch code
 * from reading raw INI data or inventing MO-specific defaults.
 */
export function resolveAresHunterSeekerConfiguration(
    definition: Pick<
        AresSuperWeaponDefinition,
        | "hunterSeekerBuildings"
        | "hunterSeekerType"
        | "hunterSeekerRandomOnly"
        | "swMaxCount"
    >,
    general: AresHunterSeekerGeneralRules = {},
    side: AresHunterSeekerSideRules | undefined = undefined,
): AresHunterSeekerConfiguration {
    const maxCount = definition.swMaxCount === undefined
        ? 1
        : Math.trunc(definition.swMaxCount);
    return {
        typeName: definition.hunterSeekerType?.trim() || side?.hunterSeeker?.trim() || undefined,
        buildingTypes: definition.hunterSeekerBuildings?.length
            ? [...definition.hunterSeekerBuildings]
            : [...(general.hunterSeekerBuildings ?? [])],
        randomOnly: definition.hunterSeekerRandomOnly === true,
        maxCount,
        detonateProximity: firstDefined(general.hunterSeekerDetonateProximity),
        descendProximity: firstDefined(general.hunterSeekerDescendProximity),
        ascentSpeed: firstDefined(general.hunterSeekerAscentSpeed),
        descentSpeed: firstDefined(general.hunterSeekerDescentSpeed),
        emergeSpeed: firstDefined(general.hunterSeekerEmergeSpeed),
    };
}

export function aresHunterSeekerBuildingMatches(building: any, names: Iterable<string>): boolean {
    const expected = new Set([...names].map(normalize).filter(Boolean));
    return !!building?.isBuilding?.() && expected.has(normalize(building.name ?? building.rules?.name));
}

/**
 * Select launch buildings in stable object-ID order.  Ares iterates the
 * owning house's building collection and applies SW.MaxCount; sorting here
 * makes the same authored content deterministic across hosts.
 */
export function selectAresHunterSeekerLaunchBuildings(
    buildings: readonly any[],
    names: readonly string[],
    maxCount: number,
): any[] {
    const eligible = buildings
        .filter((building) => building?.isSpawned !== false && !building?.isDestroyed &&
            aresHunterSeekerBuildingMatches(building, names))
        .slice()
        .sort((first, second) => {
            if (typeof first?.id === "number" && typeof second?.id === "number") {
                return first.id - second.id;
            }
            return String(first?.id ?? first?.name ?? "").localeCompare(String(second?.id ?? second?.name ?? ""));
        });
    return maxCount < 0 ? eligible : eligible.slice(0, Math.max(0, maxCount));
}

function isPassiveTarget(object: any): boolean {
    return object?.isPassive?.() === true ||
        object?.passive === true ||
        object?.rules?.passive === true;
}

function affectsHouse(object: any, owner: any, relation: string | undefined, game: any): boolean {
    const mode = normalize(relation || "Enemies");
    if (!mode || mode === "all") return true;
    const isOwner = object?.owner === owner;
    const isAlly = !isOwner && !!game?.alliances?.areAllied?.(object?.owner, owner);
    if (mode === "owner" || mode === "self") return isOwner;
    if (mode === "allies" || mode === "team") return isOwner || isAlly;
    if (mode === "none") return false;
    return mode === "enemies" || mode === "enemy" ? !isOwner && !isAlly : true;
}

export interface AresHunterSeekerTargetSelectionContext {
    owner: any;
    objects: readonly any[];
    game: any;
    randomOnly?: boolean;
    affectsHouse?: string;
}

/**
 * Antares' Hunter Seeker target selection is a generic enemy-technos query:
 * ignored objects and illegal/limbo targets are removed, non-passive targets
 * are preferred unless RandomOnly is set, and the final choice uses the
 * deterministic game RNG.  This helper deliberately knows nothing about MO
 * object IDs.
 */
export function selectAresHunterSeekerTarget(
    context: AresHunterSeekerTargetSelectionContext,
): any | undefined {
    const candidates = context.objects
        .filter((object) => object && object !== context.owner && object.isTechno?.() === true)
        .filter((object) => object.isSpawned !== false && !object.isDestroyed && !object.isCrashing)
        .filter((object) => object.limboData === undefined)
        .filter((object) => object.rules?.hunterSeekerIgnore !== true)
        .filter((object) => affectsHouse(object, context.owner, context.affectsHouse, context.game))
        .filter((object) => context.game?.isValidTarget?.(object) !== false)
        .sort((first, second) => {
            if (typeof first.id === "number" && typeof second.id === "number") return first.id - second.id;
            return String(first.id ?? first.name ?? "").localeCompare(String(second.id ?? second.name ?? ""));
        });
    if (!candidates.length) return undefined;

    const preferred = context.randomOnly
        ? []
        : candidates.filter((object) => !isPassiveTarget(object));
    const pool = preferred.length ? preferred : candidates;
    const index = context.game?.generateRandomInt
        ? context.game.generateRandomInt(0, pool.length - 1)
        : 0;
    return pool[Math.max(0, Math.min(pool.length - 1, index))];
}

