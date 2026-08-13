import { DeathType } from "@/game/gameobject/common/DeathType";
import { StanceType } from "@/game/gameobject/infantry/StanceType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { RadialTileFinder } from "@/game/map/tileFinder/RadialTileFinder";
import { MovementZone } from "@/game/type/MovementZone";
import { SpeedType } from "@/game/type/SpeedType";
import { SuperWeaponEffect } from "@/game/superweapon/SuperWeaponEffect";
import {
    isAresSuperWeaponInRange,
    resolveAresSuperWeaponRange,
} from "@/game/superweapon/AresSuperWeaponRange";
import {
    decideAresChronoshiftEligibility,
    resolveAresChronoshiftCrushable,
    type AresChronosphereEligibilityRules,
} from "@/extensions/ares/AresChronoshift";
export class ChronoSphereEffect extends SuperWeaponEffect {
    private tile2: any;
    private objectsToTeleport: Array<{
        obj: any;
        destTile: any;
    }> = [];
    private delayTicks: number = 0;
    constructor(
        e: any,
        t: any,
        i: any,
        r: any,
        superWeaponRange?: readonly number[],
        chronosphereRules?: AresChronosphereEligibilityRules,
    ) {
        super(e, t, i);
        this.tile2 = r;
        this.objectsToTeleport = [];
        this.superWeaponRange = superWeaponRange?.slice();
        this.chronosphereRules = chronosphereRules;
    }
    private readonly superWeaponRange?: readonly number[];
    private readonly chronosphereRules?: AresChronosphereEligibilityRules;

    private flag(value: unknown, defaultValue: boolean): boolean {
        return typeof value === "boolean" ? value : defaultValue;
    }

    private affectsIronCurtain(): boolean {
        return this.flag(this.chronosphereRules?.affectsIronCurtain, false);
    }

    private affectsUnwarpable(): boolean {
        return this.flag(this.chronosphereRules?.affectsUnwarpable, true);
    }

    private affectsUndeployable(): boolean {
        return this.flag(this.chronosphereRules?.affectsUndeployable, false);
    }

    private killOrganic(): boolean {
        return this.flag(this.chronosphereRules?.killOrganic, true);
    }

    private killTeleporters(): boolean {
        return this.flag(this.chronosphereRules?.killTeleporters, false);
    }

    private blowUnplaceable(): boolean {
        return this.flag(this.chronosphereRules?.blowUnplaceable, true);
    }

    private killCargo(): boolean {
        return this.flag(this.chronosphereRules?.killCargo, false);
    }

    /**
     * Ares treats deployed vehicle buildings as units when ReconsiderBuildings
     * is enabled.  Undeployable buildings can opt into the same placement path
     * explicitly through Chronosphere.AffectsUndeployable.
     */
    private isAresChronoshiftEligible(object: any): boolean {
        const isUndeployable = object?.isBuilding?.() === true && !!object.rules?.undeploysInto;
        if (isUndeployable && this.affectsUndeployable()) {
            return object.rules?.aresChronoshift?.allow !== false;
        }
        const objectCategory = object?.isBuilding?.()
            ? "building"
            : object?.isInfantry?.()
                ? "infantry"
                : object?.isAircraft?.()
                    ? "aircraft"
                    : object?.isVehicle?.()
                        ? "vehicle"
                        : object?.isUnit?.()
                            ? "unit"
                            : undefined;
        return decideAresChronoshiftEligibility({
            objectCategory,
            techno: object?.rules?.aresChronoshift,
            chronosphere: this.chronosphereRules,
        }).eligible;
    }

    private isChronoshiftObject(object: any): boolean {
        return (object?.isUnit?.() === true || object?.isBuilding?.() === true) &&
            this.isAresChronoshiftEligible(object);
    }

    private isAffectedByChronosphere(object: any): boolean {
        if (!this.isChronoshiftObject(object)) return false;
        if (!this.affectsUnwarpable() && object.rules?.warpable === false) return false;
        if (!this.affectsIronCurtain() && object.invulnerableTrait?.isActive?.()) return false;
        return true;
    }

    private killObjectCargo(object: any, game: any): void {
        if (!this.killCargo()) return;
        const cargo = [
            ...(object.transportTrait?.units ?? []),
            ...(object.garrisonTrait?.units ?? []),
        ];
        for (const unit of [...new Set(cargo)]) {
            if (!unit?.isDestroyed) {
                game.destroyObject(unit, { player: this.owner, obj: object }, true);
            }
        }
        if (object.transportTrait?.units) object.transportTrait.units = [];
        if (object.garrisonTrait?.units) object.garrisonTrait.units = [];
    }

    private foundationFor(object: any): any {
        return object.getFoundation?.() ?? object.art?.foundation ?? { width: 1, height: 1 };
    }

    private canPlaceBuilding(game: any, object: any, tile: any): boolean {
        if (!tile || game.map.mapBounds?.isWithinBounds && !game.map.mapBounds.isWithinBounds(tile)) {
            return false;
        }
        const occupiedTiles = game.map.tileOccupation.calculateTilesForGameObject(tile, object);
        if (!occupiedTiles?.length) return false;
        const speedType = object.rules?.speedType ?? SpeedType.Track;
        for (const candidate of occupiedTiles) {
            if (game.map.mapBounds?.isWithinBounds && !game.map.mapBounds.isWithinBounds(candidate)) return false;
            if (game.map.terrain?.getPassableSpeed &&
                game.map.terrain.getPassableSpeed(candidate, speedType, false, !!candidate.onBridgeLandType) <= 0) {
                return false;
            }
            if (game.map.terrain?.findObstacles?.({
                tile: candidate,
                onBridge: !!candidate.onBridgeLandType,
            }, object)?.some((other: any) => other !== object)) {
                return false;
            }
        }
        return true;
    }

    private findBuildingDestination(game: any, object: any, requestedTile: any): any | undefined {
        if (this.canPlaceBuilding(game, object, requestedTile)) return requestedTile;
        const foundation = this.foundationFor(object);
        const finder = new RadialTileFinder(
            game.map.tiles,
            game.map.mapBounds,
            requestedTile,
            foundation,
            1,
            15,
            (tile: any) => this.canPlaceBuilding(game, object, tile),
        );
        return finder.getNextTile();
    }

    private teleportBuilding(object: any, requestedTile: any, game: any): void {
        const destination = this.findBuildingDestination(game, object, requestedTile);
        if (!destination) {
            object.warpedOutTrait.setActive(false, true, game);
            if (this.blowUnplaceable()) {
                this.killObjectCargo(object, game);
                game.destroyObject(object, { player: this.owner }, true);
            }
            return;
        }

        const selection = game.getUnitSelection?.();
        const controlGroup = selection?.getOrCreateSelectionModel?.(object)?.getControlGroupNumber?.();
        const selected = selection?.isSelected?.(object) === true;
        game.limboObject(object, { selected, controlGroup });
        game.unlimboObject(object, destination, true);
        object.warpedOutTrait.setActive(false, true, game);
    }

    onStart(t: any): void {
        this.delayTicks = t.rules.general.chronoDelay;
        let i = t.map.tiles;
        const candidates: Array<{ object: any; sourceTile: any; destTile?: any }> = [];

        if (this.superWeaponRange !== undefined) {
            // Antares collects each techno once from the configured area. The
            // destination keeps the object's anchor-tile offset from the
            // source center, even when SW.Range is a larger rectangle/circle.
            const range = resolveAresSuperWeaponRange(this.superWeaponRange, {
                widthOrRange: 3,
                height: 3,
            });
            for (const object of t.getWorld().getAllObjects()) {
                const sourceTile = object.tile;
                if (!this.isAffectedByChronosphere(object) || !sourceTile || object.isDisposed ||
                    object.onBridge !== !!sourceTile.onBridgeLandType ||
                    (object.isInfantry?.() && object.stance === StanceType.Paradrop && 2 < object.tileElevation) ||
                    !isAresSuperWeaponInRange(this.tile, object, range, t.map.tileOccupation)) {
                    continue;
                }
                candidates.push({
                    object,
                    sourceTile,
                    destTile: i.getByMapCoords(
                        this.tile2.rx + sourceTile.rx - this.tile.rx,
                        this.tile2.ry + sourceTile.ry - this.tile.ry,
                    ),
                });
            }
        }
        else {
            for (let o = -1; o <= 1; o++) {
                for (let e = -1; e <= 1; e++) {
                    const sourceTile = i.getByMapCoords(this.tile.rx + o, this.tile.ry + e);
                    if (!sourceTile) continue;
                    const onBridge = !!sourceTile.onBridgeLandType;
                    const destTile = i.getByMapCoords(this.tile2.rx + o, this.tile2.ry + e);
                    for (const object of t.map.getGroundObjectsOnTile(sourceTile)) {
                        if (!this.isAffectedByChronosphere(object) ||
                            object.tile !== sourceTile ||
                            object.onBridge !== onBridge ||
                            (object.isInfantry() &&
                                object.stance === StanceType.Paradrop &&
                                2 < object.tileElevation) ||
                            object.isDisposed) {
                            continue;
                        }
                        candidates.push({ object, sourceTile, destTile });
                    }
                }
            }
        }

        for (const { object, destTile } of candidates) {
            const killOrganic = this.killOrganic() && object.rules.organic === true;
            const killTeleporter = this.killTeleporters() && object.rules.teleporter === true;
            if (killOrganic || killTeleporter || (!destTile && !(object.isBuilding?.() && !this.blowUnplaceable()))) {
                this.killObjectCargo(object, t);
                t.destroyObject(object, { player: this.owner }, this.killCargo());
            }
            else if (!object.warpedOutTrait.isActive()) {
                if (this.killCargo()) this.killObjectCargo(object, t);
                object.warpedOutTrait.setActive(true, true, t);
                this.objectsToTeleport.push({
                    obj: object,
                    destTile,
                });
            }
        }
    }
    onTick(l: any): boolean {
        if (0 < this.delayTicks) {
            this.delayTicks--;
        }
        if (this.delayTicks) {
            return false;
        }
        for (let { obj: d, destTile: g } of this.objectsToTeleport) {
            if (d.isSpawned) {
                if (d.isBuilding?.()) {
                    this.teleportBuilding(d, g, l);
                    continue;
                }
                let i = false, r = g ? l.map.tileOccupation.getBridgeOnTile(g) : undefined, s = l.map.getGroundObjectsOnTile(g), a = s.find((e: any) => e.isBuilding());
                var c = s.some((e: any) => l.rules.general.padAircraft.includes(e.name)), h = l.rules.general.padAircraft.includes(d.name) &&
                    !!a?.helipadTrait &&
                    !!a.dockTrait?.getAllDockTiles().includes(g) &&
                    !a.dockTrait.hasReservedDockAt(a.dockTrait.getDockNumberByTile(g)) &&
                    a.owner === d.owner;
                let e = false, n = d.rules.speedType, o = d.isInfantry();
                if (d.rules.movementZone === MovementZone.Fly) {
                    n = SpeedType.Wheel;
                }
                var u = l.map.mapBounds.isWithinBounds(g);
                if (!(h || (l.map.terrain.getPassableSpeed(g, n, o, !!r) && u))) {
                    let t = false;
                    if (!c &&
                        (0 <
                            l.map.terrain.getPassableSpeed(g, n, o, !!r, undefined, true) ||
                            !u)) {
                        if (a) {
                            i = true;
                        }
                        let e = new RadialTileFinder(l.map.tiles, l.map.mapBounds, g, { width: 1, height: 1 }, 1, 15, (e: any) => 0 <
                            l.map.terrain.getPassableSpeed(e, n, o, !!e.onBridgeLandType) &&
                            !l.map.terrain.findObstacles({ tile: e, onBridge: !!e.onBridgeLandType }, d).length);
                        u = e.getNextTile();
                        if (u) {
                            g = u;
                            r = l.map.tileOccupation.getBridgeOnTile(g);
                            s = l.map.getGroundObjectsOnTile(g);
                            t = true;
                        }
                    }
                    if (!t) {
                        d.moveTrait.teleportUnitToTile(g, r, true, false, l);
                        d.warpedOutTrait.setActive(false, true, l);
                        if (l.map.getTileZone(g) === ZoneType.Water) {
                            d.deathType = DeathType.Sink;
                        }
                        l.destroyObject(d, { player: this.owner });
                        e = true;
                    }
                }
                for (let t of s) {
                    if (!t.isDisposed &&
                        t.isUnit() &&
                        !this.objectsToTeleport.some(({ obj: e }) => e === t) &&
                        !(t.onBridge !== !!r && t.tile === g) &&
                        !(2 < Math.abs(t.tileElevation - d.tileElevation))) {
                        if (resolveAresChronoshiftCrushable(t.rules?.aresChronoshift) === false ||
                            (d.isInfantry() && l.rules.general?.chronoInfantryCrush === false && !t.isInfantry())) {
                            l.destroyObject(d, { player: this.owner });
                            e = true;
                            break;
                        }
                        if (t.isInfantry() &&
                            t.stance !== StanceType.Paradrop) {
                            t.deathType = DeathType.Crush;
                        }
                        l.destroyObject(t, { player: this.owner, obj: d });
                    }
                }
                if (!e) {
                    d.moveTrait.teleportUnitToTile(g, r, true, false, l);
                    if (h && a?.dockTrait) {
                        h = a.dockTrait.getAllDockTiles().indexOf(g);
                        a.dockTrait.undockUnitAt(h);
                        if (a.dockTrait.hasReservedDockAt(h)) {
                            throw new Error("Target building dock is already reserved by another unit");
                        }
                        a.dockTrait.dockUnitAt(d, h);
                    }
                    if (i) {
                        d.warpedOutTrait.setTimed(l.rules.general.chronoDelay, false, l);
                    }
                    else {
                        d.warpedOutTrait.setActive(false, true, l);
                    }
                }
            }
        }
        return true;
    }
}
