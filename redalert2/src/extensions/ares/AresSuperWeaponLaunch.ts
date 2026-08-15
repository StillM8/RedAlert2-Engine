import { ObjectType } from "@/engine/type/ObjectType";
import { getAresSuperWeaponProviderNames } from "@/extensions/ares/AresSuperWeaponProviders";
import { getBuildingSuperWeaponTraits } from "@/game/gameobject/trait/SuperWeaponTrait";

type TileLike = { rx: number; ry: number; z?: number };

export interface AresSuperWeaponLaunchRules {
    name?: string;
    swRangeMinimum?: number;
    swRangeMaximum?: number;
    swDesignators?: string[];
    swAnyDesignator?: boolean;
    swInhibitors?: string[];
    swAnyInhibitor?: boolean;
}

export interface AresSuperWeaponLaunchGame {
    alliances: {
        areAllied(player1: any, player2: any): boolean;
    };
    getWorld?(): {
        getAllObjects?(): any[];
    };
    world?: {
        getAllObjects?(): any[];
    };
    getCombatants?(): any[];
}

function normalize(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function configuredNames(values: string[] | undefined): Set<string> {
    return new Set((values ?? [])
        .map(normalize)
        .filter(value => value.length > 0 && value !== "none" && value !== "all"));
}

function isBuilding(object: any): boolean {
    return object?.isBuilding?.() === true || object?.rules?.type === ObjectType.Building;
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

function isPresent(object: any): boolean {
    if (!object || object.limboData || object.isDisposed || object.isDestroyed || object.isCrashing) {
        return false;
    }
    // Ownership is the authoritative source for provider/designator lists;
    // synthetic hosts can register an owned launch building before the
    // render/world spawn callback runs. Limbo and terminal-state flags above
    // still exclude objects that cannot participate in a launch.
    if (object.warpedOutTrait?.isActive?.() === true) {
        return false;
    }
    const health = object.healthTrait?.health;
    return !Number.isFinite(health) || health > 0;
}

function isOperational(object: any): boolean {
    if (!isPresent(object) || object.empTrait?.isUnderEMP?.() === true) return false;
    if (!isBuilding(object)) return true;

    if (object.poweredTrait?.isPoweredOn && !object.poweredTrait.isPoweredOn()) {
        return false;
    }
    if (object.rules?.powered && object.owner?.powerTrait?.isLowPower?.()) {
        return false;
    }
    return true;
}

function objectTile(object: any): TileLike | undefined {
    const tile = isBuilding(object)
        ? object.centerTile ?? object.tile
        : object.tile ?? object.centerTile;
    return tile && Number.isFinite(tile.rx) && Number.isFinite(tile.ry) ? tile : undefined;
}

function distance(first: TileLike | undefined, second: TileLike | undefined): number {
    if (!first || !second) return Number.POSITIVE_INFINITY;
    return Math.hypot(first.rx - second.rx, first.ry - second.ry);
}

function getOwnedObjects(owner: any): any[] {
    if (typeof owner?.getOwnedObjects === "function") {
        return owner.getOwnedObjects().filter(isTechno);
    }

    const objects = new Set<any>();
    if (typeof owner?.getOwnedObjectsByType === "function") {
        for (const type of [ObjectType.Building, ObjectType.Infantry, ObjectType.Vehicle, ObjectType.Aircraft]) {
            for (const object of owner.getOwnedObjectsByType(type) ?? []) objects.add(object);
        }
    }
    if (owner?.buildings && typeof owner.buildings[Symbol.iterator] === "function") {
        for (const object of owner.buildings) objects.add(object);
    }
    return [...objects].filter(isTechno);
}

function getWorldObjects(game: AresSuperWeaponLaunchGame): any[] {
    const fromGetter = game.getWorld?.()?.getAllObjects?.();
    if (fromGetter) return fromGetter;
    const fromWorld = game.world?.getAllObjects?.();
    if (fromWorld) return fromWorld;
    return (game.getCombatants?.() ?? []).flatMap(player => getOwnedObjects(player));
}

function objectName(object: any): string {
    return normalize(object?.rules?.name ?? object?.name);
}

function matchesConfiguredName(object: any, names: Set<string>): boolean {
    return names.has(objectName(object));
}

function providerNames(building: any): string[] {
    const traits = getBuildingSuperWeaponTraits(building);
    const traitNames = traits.map(trait => trait?.name).filter(Boolean);
    if (traitNames.length) return traitNames;
    return getAresSuperWeaponProviderNames(building?.rules ?? {});
}

function getProviderBuildings(owner: any, superWeaponName: string | undefined): any[] {
    const expected = normalize(superWeaponName);
    if (!expected) return [];
    return getOwnedObjects(owner).filter(object =>
        isBuilding(object) &&
        providerNames(object).some(name => normalize(name) === expected)
    );
}

function resolveRange(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value! >= 0 ? value! : fallback;
}

function hasExplicitRange(rules: AresSuperWeaponLaunchRules): boolean {
    return [rules.swRangeMinimum, rules.swRangeMaximum]
        .some(value => Number.isFinite(value) && value! >= 0);
}

function isWithinLaunchRange(
    source: any,
    target: TileLike,
    rules: AresSuperWeaponLaunchRules,
): boolean {
    const minimum = resolveRange(rules.swRangeMinimum, 0);
    const maximum = resolveRange(rules.swRangeMaximum, Number.POSITIVE_INFINITY);
    const range = distance(objectTile(source), target);
    return range >= minimum && range <= maximum;
}

function isDesignatorInRange(object: any, target: TileLike): boolean {
    const designatorRange = resolveRange(object?.rules?.designatorRange, resolveRange(object?.rules?.sight, 0));
    return distance(objectTile(object), target) <= designatorRange;
}

function isInhibitorInRange(object: any, target: TileLike): boolean {
    const inhibitorRange = resolveRange(object?.rules?.inhibitorRange, resolveRange(object?.rules?.sight, 0));
    return distance(objectTile(object), target) <= inhibitorRange;
}

function hasMatchingDesignator(
    rules: AresSuperWeaponLaunchRules,
    owner: any,
    target: TileLike,
): boolean {
    const names = configuredNames(rules.swDesignators);
    if (!rules.swAnyDesignator && !names.size) return true;

    return getOwnedObjects(owner)
        .filter(isOperational)
        .some(object =>
            (rules.swAnyDesignator || matchesConfiguredName(object, names)) &&
            isDesignatorInRange(object, target)
        );
}

function hasMatchingInhibitor(
    rules: AresSuperWeaponLaunchRules,
    owner: any,
    target: TileLike,
    game: AresSuperWeaponLaunchGame,
): boolean {
    const names = configuredNames(rules.swInhibitors);
    if (!rules.swAnyInhibitor && !names.size) return false;

    return getWorldObjects(game)
        .filter(object =>
            isOperational(object) &&
            !!object.owner &&
            object.owner !== owner &&
            !game.alliances.areAllied(object.owner, owner) &&
            (rules.swAnyInhibitor || matchesConfiguredName(object, names))
        )
        .some(object => isInhibitorInRange(object, target));
}

/**
 * Apply the common Ares launch-site rules shared by human and AI actions.
 *
 * RangeMinimum/RangeMaximum are measured from an operational building that
 * provides the selected superweapon to the target cell.  Designators measure
 * from an operational owned TechnoType to the target.  Inhibitors make the
 * target area untargetable when an operational enemy TechnoType is within
 * its inhibitor range.
 */
export function isAresSuperWeaponLaunchAllowed(
    rules: AresSuperWeaponLaunchRules,
    owner: any,
    target: TileLike,
    game: AresSuperWeaponLaunchGame,
): boolean {
    const needsProvider = hasExplicitRange(rules);
    const providers = getProviderBuildings(owner, rules.name);

    // AlwaysGranted and other provider-less Ares weapons remain launchable
    // when they have no launch-site restriction.  A target-area inhibitor is
    // still evaluated even when no physical provider is required.
    if (!providers.length) {
        if (needsProvider) return false;
        return hasMatchingDesignator(rules, owner, target) &&
            !hasMatchingInhibitor(rules, owner, target, game);
    }

    const launchSites = providers.filter(isOperational).filter(site =>
        isWithinLaunchRange(site, target, rules)
    );
    if (!launchSites.length) return false;

    if (!hasMatchingDesignator(rules, owner, target)) return false;
    return !hasMatchingInhibitor(rules, owner, target, game);
}
