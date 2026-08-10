import { ObjectType } from "@/engine/type/ObjectType";
import { Infantry } from "@/game/gameobject/Infantry";
import { SpeedType } from "@/game/type/SpeedType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { getFoundationCells } from "@/game/art/Foundation";
import { RadialTileFinder } from "@/game/map/tileFinder/RadialTileFinder";
import { SuperWeaponEffect, type TileCoord } from "@/game/superweapon/SuperWeaponEffect";
import type { Game } from "@/game/Game";
import type { Player } from "@/game/Player";

export type AresDeliveryOwner = "invoker" | "civilian" | "special" | "neutral";

interface UnitDeliveryRules {
    hasObject?(name: string, type: ObjectType): boolean;
    getObject(name: string, type: ObjectType): any;
    general?: { flightLevel?: number };
}

interface UnitDeliveryGame {
    rules: UnitDeliveryRules;
    map: any;
    createObject(type: ObjectType, name: string): any;
    changeObjectOwner(object: any, owner: Player): void;
    spawnObject(object: any, tile: any): void;
    getAllPlayers?(): Player[];
    getCivilianPlayer?(): Player | undefined;
    playerList?: { getAll?(): Player[] };
}

function normalize(value: string | undefined): string {
    return (value ?? "").trim().toLocaleLowerCase("en-US");
}

function playerCountryValues(player: any): string[] {
    const country = player?.country;
    return [
        country?.id,
        country?.name,
        country?.sideId,
        country?.rules?.id,
        country?.rules?.name,
        country?.rules?.sideId,
    ].filter((value): value is string => typeof value === "string").map(normalize);
}

function allPlayers(game: UnitDeliveryGame): Player[] {
    return game.getAllPlayers?.() ?? game.playerList?.getAll?.() ?? [];
}

/**
 * Antares resolves Deliver.Owner through the named Civilian, Special, or
 * Neutral country.  The standalone engine has no HouseClass singleton, so
 * the equivalent lookup is performed against the active Player registry.
 */
export function resolveUnitDeliveryOwner(
    ownerMode: string | undefined,
    invoker: Player,
    game: UnitDeliveryGame,
): Player {
    const mode = normalize(ownerMode || "invoker");
    if (mode === "invoker" || !mode) return invoker;

    const players = allPlayers(game);
    if (mode === "civilian") {
        return players.find(player => playerCountryValues(player).includes("civilian")) ??
            game.getCivilianPlayer?.() ?? invoker;
    }
    if (mode === "special" || mode === "neutral") {
        return players.find(player => playerCountryValues(player).includes(mode)) ?? invoker;
    }

    // Antares falls back to the invoker for an unrecognized/default owner
    // value rather than silently selecting an unrelated faction.
    return invoker;
}

/** Resolve a TechnoType name without narrowing the extension to vanilla units. */
export function resolveUnitDeliveryType(rules: UnitDeliveryRules, name: string): ObjectType | undefined {
    const types = [ObjectType.Infantry, ObjectType.Vehicle, ObjectType.Aircraft, ObjectType.Building];
    for (const type of types) {
        if (rules.hasObject?.(name, type) || !rules.hasObject && canReadObject(rules, name, type)) {
            return type;
        }
    }
    return undefined;
}

function canReadObject(rules: UnitDeliveryRules, name: string, type: ObjectType): boolean {
    try {
        return !!rules.getObject(name, type);
    }
    catch {
        return false;
    }
}

function foundationFor(object: any): any {
    return object.isBuilding?.()
        ? (object.getFoundation?.() ?? object.art?.foundation ?? { width: 1, height: 1 })
        : { width: 1, height: 1 };
}

function normalizedStartTile(game: UnitDeliveryGame, tile: any, object: any): any {
    if (!object.isBuilding?.()) return tile;
    const foundation = foundationFor(object);
    const center = object.art?.foundationCenter;
    const rx = tile.rx - (center?.x ?? Math.floor(foundation.width / 2));
    const ry = tile.ry - (center?.y ?? Math.floor(foundation.height / 2));
    // RadialTileFinder and MapBounds need a real tile because the isometric
    // dx/dy coordinates are not derivable from rx/ry by copying the target
    // tile. This is also important for irregular foundations near map edges.
    return game.map.tiles.getByMapCoords(rx, ry) ?? { ...tile, rx, ry };
}

function objectFitsAt(game: UnitDeliveryGame, object: any, tile: any): boolean {
    const map = game.map as any;
    const bounds = map.mapBounds;
    const occupiedTiles = map.tileOccupation.calculateTilesForGameObject(tile, object);
    if (!occupiedTiles.length) return false;

    const expectedFoundation = foundationFor(object);
    // A missing footprint tile means the object would be partly outside the
    // map.  This mirrors MapClass::NearByLocation rejecting the placement.
    const expectedCount = object.isBuilding?.()
        ? Math.max(1, getFoundationCells(expectedFoundation).length)
        : 1;
    if (object.isBuilding?.() && occupiedTiles.length < expectedCount) return false;

    if (object.isInfantry?.()) {
        const occupiedSubCells = (map.getGroundObjectsOnTile?.(tile) ?? [])
            .filter((other: any) => other.isInfantry?.())
            .map((other: any) => other.position?.desiredSubCell ?? other.position?.subCell)
            .filter((subCell: any) => subCell !== undefined && subCell !== 0);
        if (!Infantry.SUB_CELLS.some(subCell => !occupiedSubCells.includes(subCell))) {
            return false;
        }
    }

    for (const candidate of occupiedTiles) {
        if (bounds?.isWithinBounds && !bounds.isWithinBounds(candidate)) return false;
        const speedType = object.isBuilding?.()
            ? (object.rules?.speedType === SpeedType.Float ? SpeedType.Float : SpeedType.Track)
            : (object.isAircraft?.() ? SpeedType.Track : (object.rules?.speedType ?? SpeedType.Track));
        const passable = map.terrain?.getPassableSpeed?.(
            candidate,
            speedType,
            object.isInfantry?.() === true,
            !!candidate.onBridgeLandType,
        );
        if (passable !== undefined && passable <= 0) return false;
        if (map.terrain?.findObstacles?.({ tile: candidate, onBridge: !!candidate.onBridgeLandType }, object)?.length) {
            return false;
        }
    }
    return true;
}

function findDeliveryTile(game: UnitDeliveryGame, object: any, target: any): any | undefined {
    const map = game.map as any;
    const start = normalizedStartTile(game, target, object);
    const foundation = foundationFor(object);
    const finder = new RadialTileFinder(
        map.tiles,
        map.mapBounds,
        start,
        foundation,
        0,
        50,
        (tile: any) => objectFitsAt(game, object, tile),
    );
    return finder.getNextTile();
}

function setDeliveryState(object: any, owner: Player, game: UnitDeliveryGame, target: any): void {
    if (object.isBuilding?.()) {
        // ConstructionWorker consults this runtime override when building
        // adjacency is calculated.  It is the TypeScript equivalent of
        // Antares' BuildingExt::SkipBaseNormal flag.
        object.guardMode = false;
        return;
    }

    // Human-delivered units guard the target area.  AI-delivered units remain
    // order-free so the normal AI/passive-acquisition path can assign hunt
    // behavior without a fake legacy order type.
    object.guardMode = !owner.isAi;
    if (object.guardMode) {
        object.guardArea = { tile: target, onBridge: false };
    }

    if (object.isInfantry?.()) {
        const occupied = game.map.getGroundObjectsOnTile?.(target) ?? [];
        const used = occupied
            .filter((other: any) => other.isInfantry?.())
            .map((other: any) => other.position?.desiredSubCell ?? other.position?.subCell)
            .filter((subCell: any) => subCell !== undefined && subCell !== 0);
        const free = Infantry.SUB_CELLS.find(subCell => !used.includes(subCell));
        if (free !== undefined) object.position.subCell = free;
    }
}

function discardUnspawnedObject(object: any): void {
    object.owner?.removeOwnedObject?.(object);
    object.dispose?.();
}

export class UnitDeliveryEffect extends SuperWeaponEffect {
    private remainingTicks: number;

    constructor(
        type: string,
        owner: Player,
        tile: TileCoord,
        private readonly types: readonly string[],
        private readonly deferment: number = 20,
        private readonly ownerMode?: string,
        private readonly deliverBaseNormal: boolean = true,
    ) {
        super(type, owner, tile);
        this.remainingTicks = Math.max(0, Math.floor(Number.isFinite(deferment) ? deferment : 20));
    }

    onStart(_game: Game): void { }

    onTick(game: Game): boolean {
        if (this.remainingTicks > 0) {
            this.remainingTicks--;
            if (this.remainingTicks > 0) return false;
        }
        this.placeUnits(game as UnitDeliveryGame);
        return true;
    }

    private placeUnits(game: UnitDeliveryGame): void {
        const deliveryOwner = resolveUnitDeliveryOwner(this.ownerMode, this.owner, game);
        for (const name of this.types) {
            const type = resolveUnitDeliveryType(game.rules, name);
            if (type === undefined) {
                console.warn(`UnitDelivery superweapon references unknown TechnoType "${name}"; skipped.`);
                continue;
            }

            let object: any;
            try {
                object = game.createObject(type, name);
                game.changeObjectOwner(object, deliveryOwner);
                if (object.isBuilding?.() && object.initialFactoryOwnerId === undefined) {
                    // ObjectFactory creates unowned objects before the game
                    // assigns their Player. Preserve the owner-at-creation
                    // identity that Ares uses for FactoryOwners.
                    object.initialFactoryOwnerId = deliveryOwner.country?.id ?? deliveryOwner.country?.name;
                }
                const tile = findDeliveryTile(game, object, this.tile);
                if (!tile) {
                    console.warn(`UnitDelivery could not find a placement cell for "${name}"; skipped.`);
                    discardUnspawnedObject(object);
                    continue;
                }

                if (object.isBuilding?.() && !this.deliverBaseNormal) {
                    object.baseNormalOverride = false;
                }
                setDeliveryState(object, deliveryOwner, game, tile);
                game.spawnObject(object, tile);

                // Antares creates aircraft on the ground and immediately
                // transitions them to their flying state; the standalone
                // runtime uses the same two-step spawn contract as paradrops.
                if (object.isAircraft?.()) {
                    object.onBridge = false;
                    object.position.tileElevation = object.rules?.flightLevel ?? game.rules.general?.flightLevel ?? 0;
                    object.zone = ZoneType.Air;
                }
            }
            catch (error) {
                console.warn(`UnitDelivery failed to place "${name}"; skipped.`, error);
                if (object && !object.isSpawned) discardUnspawnedObject(object);
            }
        }
    }
}
