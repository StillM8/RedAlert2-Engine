import { ObjectType } from "@/engine/type/ObjectType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

export interface AresSuperWeaponFilterGame {
    alliances: {
        areAllied(player1: any, player2: any): boolean;
    };
    map: {
        getTileZone(tile: any): ZoneType;
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
