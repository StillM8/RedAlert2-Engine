import { ObjectType } from "@/engine/type/ObjectType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { ShroudType } from "@/game/map/MapShroud";

export interface AresSuperWeaponFilterGame {
    alliances: {
        areAllied(player1: any, player2: any): boolean;
    };
    map: {
        getTileZone(tile: any): ZoneType;
        getGroundObjectsOnTile?(tile: any): any[];
        getObjectsOnTile?(tile: any): any[];
    };
    mapShroudTrait?: {
        getPlayerShroud?(player: any): {
            getShroudType?(tile: any): ShroudType;
            getShroudTypeByTileCoords?(rx: number, ry: number, z: number): ShroudType;
            isShrouded?(tile: any): boolean;
        } | undefined;
    };
}

function tokens(value: string | undefined): Set<string> {
    return new Set((value ?? "")
        .split(",")
        .map(token => token.trim().toLocaleLowerCase("en-US"))
        .filter(Boolean));
}

function isUnit(object: any): boolean {
    // Ares distinguishes `Infantry` from `Unit`; the latter covers vehicles
    // and aircraft.  Some engine objects expose only isUnit(), so guard the
    // infantry case explicitly instead of treating every unit as a vehicle.
    if (object?.isInfantry?.() === true || object?.rules?.type === ObjectType.Infantry) {
        return false;
    }
    return object?.isVehicle?.() === true ||
        object?.isAircraft?.() === true ||
        (object?.isUnit?.() === true && object?.rules?.type !== ObjectType.Infantry);
}

function isBuilding(object: any): boolean {
    return object?.isBuilding?.() === true || object?.rules?.type === ObjectType.Building;
}

function houseAllowed(object: any, owner: any, houses: Set<string>, game: AresSuperWeaponFilterGame): boolean {
    if (!houses.size) return true;
    if (houses.has("none")) return false;
    if (houses.has("all")) return true;
    if (!object?.owner) return false;
    const isOwner = object.owner === owner;
    const isAlly = !isOwner && game.alliances.areAllied(object.owner, owner);
    const isEnemy = !isOwner && !isAlly;
    if (houses.has("owner") && isOwner) return true;
    if (houses.has("allies") && isAlly) return true;
    if (houses.has("team") && (isOwner || isAlly)) return true;
    return houses.has("enemies") && isEnemy;
}

function targetAllowed(object: any, tile: any, targets: Set<string>, game: AresSuperWeaponFilterGame): boolean {
    if (!targets.size || targets.has("none")) return true;
    const zone = game.map.getTileZone(tile);
    // Antares stores land/water as a bitmask.  Therefore land,water means
    // both zones are legal; it is not two sequential predicates.
    const allowsLand = targets.has("land");
    const allowsWater = targets.has("water");
    if ((allowsLand || allowsWater) &&
        ((zone === ZoneType.Ground && !allowsLand) ||
            (zone === ZoneType.Water && !allowsWater))) {
        return false;
    }
    const typeTargets = ["infantry", "units", "buildings"].filter(target => targets.has(target));
    if (!typeTargets.length) return !targets.has("empty");
    if (targets.has("buildings") && isBuilding(object)) return true;
    if (targets.has("infantry") && object?.isInfantry?.()) return true;
    if (targets.has("units") && isUnit(object)) return true;
    return false;
}

function isTechno(object: any): boolean {
    return object?.isTechno?.() === true ||
        isBuilding(object) ||
        object?.isInfantry?.() === true ||
        object?.isVehicle?.() === true ||
        object?.isAircraft?.() === true ||
        object?.isUnit?.() === true ||
        [ObjectType.Building, ObjectType.Infantry, ObjectType.Vehicle, ObjectType.Aircraft]
            .includes(object?.rules?.type);
}

function compareTargetObjects(first: any, second: any): number {
    const firstId = first?.id;
    const secondId = second?.id;
    if (typeof firstId === "number" && typeof secondId === "number") {
        return firstId - secondId;
    }
    const firstKey = String(firstId ?? first?.name ?? "");
    const secondKey = String(secondId ?? second?.name ?? "");
    return firstKey.localeCompare(secondKey);
}

function getTechnoTargetsAtCell(game: AresSuperWeaponFilterGame, tile: any): any[] {
    const objects = game.map.getGroundObjectsOnTile?.(tile) ?? game.map.getObjectsOnTile?.(tile) ?? [];
    return objects.filter(isTechno).sort(compareTargetObjects);
}

function requiredHouseAllowed(object: any, owner: any, houses: Set<string>, game: AresSuperWeaponFilterGame): boolean {
    // Antares treats RequiresHouse=None as no house restriction.  This is
    // intentionally different from AffectsHouse=None, which affects nothing.
    if (!houses.size || houses.has("none")) return true;
    return houseAllowed(object, owner, houses, game);
}

/**
 * Implements Antares' common SW.FireIntoShroud gate.  The documented/default
 * value is yes, so an omitted value is permissive.  Ares checks the current
 * owner's map visibility at the selected cell before applying the type's
 * target/content rules; TemporaryReveal is not unexplored in the standalone
 * MapShroud model and therefore remains launchable.
 *
 * The shroud service is optional for headless actions/tests and observer-like
 * hosts.  In that case there is no visibility state to reject against, so the
 * default is to allow the action rather than silently inventing a shroud.
 */
export function isAresSuperWeaponFireIntoShroudAllowed(
    fireIntoShroud: boolean | undefined,
    owner: any,
    tile: any,
    game: AresSuperWeaponFilterGame,
): boolean {
    if (fireIntoShroud !== false) return true;

    const shroud = game.mapShroudTrait?.getPlayerShroud?.(owner);
    if (!shroud) return true;

    let shroudType: ShroudType | undefined;
    if (typeof shroud.getShroudType === "function") {
        shroudType = shroud.getShroudType(tile);
    }
    else if (typeof shroud.getShroudTypeByTileCoords === "function" && tile) {
        shroudType = shroud.getShroudTypeByTileCoords(tile.rx, tile.ry, tile.z ?? 0);
    }
    else if (typeof shroud.isShrouded === "function") {
        return !shroud.isShrouded(tile);
    }

    // A missing/unsupported visibility API is treated like an observer host;
    // the action path still retains its ordinary target validation.
    return shroudType === undefined || shroudType !== ShroudType.Unexplored;
}

/**
 * Ares only applies SW.ManualFire=no when AutoFire is enabled.  This mirrors
 * the Antares click-path rule: an auto-only superweapon ignores owner clicks,
 * while AI-created activation actions remain valid.
 */
export function isAresSuperWeaponManualActivationAllowed(
    autoFire: boolean | undefined,
    manualFire: boolean | undefined,
    owner: any,
): boolean {
    return !(autoFire === true && manualFire === false && !owner?.isAi);
}

/**
 * Implements Antares' IsCellEligible + IsTechnoEligible semantics for a
 * manually selected superweapon target.  A cell-only mask such as `water`
 * allows both occupied and empty cells; a content mask such as `buildings`
 * requires a matching techno; `empty` requires no techno on the cell.
 */
export function isAresSuperWeaponRequiredTargetAllowed(
    object: any | undefined,
    tile: any,
    requiresTarget: string | undefined,
    game: AresSuperWeaponFilterGame,
): boolean {
    const targets = tokens(requiresTarget);
    if (!targets.size || targets.has("none") || targets.has("all")) return true;

    const zone = game.map.getTileZone(tile);
    const allowsLand = targets.has("land");
    const allowsWater = targets.has("water");
    if ((allowsLand || allowsWater) &&
        ((zone === ZoneType.Ground && !allowsLand) ||
            (zone === ZoneType.Water && !allowsWater))) {
        return false;
    }

    const hasContentMask = targets.has("empty") ||
        targets.has("infantry") ||
        targets.has("units") ||
        targets.has("buildings");
    if (!hasContentMask) return true;
    if (!object) return targets.has("empty");
    if (targets.has("buildings") && isBuilding(object)) return true;
    if (targets.has("infantry") && object?.isInfantry?.() === true) return true;
    if (targets.has("units") && isUnit(object)) return true;
    return false;
}

/**
 * Validate the target cell before an Ares superweapon activation.  The
 * original game checks the cell's ground content, not overlays or terrain
 * objects.  The host may expose more than one techno on a tile, so this
 * standalone runtime accepts a matching deterministic candidate; ordinary
 * maps still have one ground content object just like the original cell.
 */
export function isAresSuperWeaponActivationAllowed(
    requiresHouse: string | undefined,
    requiresTarget: string | undefined,
    owner: any,
    tile: any,
    game: AresSuperWeaponFilterGame,
): boolean {
    const houses = tokens(requiresHouse);
    const targets = getTechnoTargetsAtCell(game, tile);
    if (!targets.length) {
        return isAresSuperWeaponRequiredTargetAllowed(undefined, tile, requiresTarget, game);
    }
    return targets.some((object) =>
        isAresSuperWeaponRequiredTargetAllowed(object, tile, requiresTarget, game) &&
        requiredHouseAllowed(object, owner, houses, game));
}

/**
 * Build the object predicate used by Ares ranged superweapon effects. Empty
 * cells are not passed to Warhead.detonate, but all object-side house and
 * terrain/type restrictions are evaluated here.
 */
export function createAresSuperWeaponTargetFilter(
    affectsHouse: string | undefined,
    affectsTarget: string | undefined,
    owner: any,
    game: AresSuperWeaponFilterGame,
): (object: any, tile: any) => boolean {
    const houses = tokens(affectsHouse);
    const targets = tokens(affectsTarget);
    return (object, tile) => houseAllowed(object, owner, houses, game) && targetAllowed(object, tile, targets, game);
}
