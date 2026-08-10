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
export class ChronoSphereEffect extends SuperWeaponEffect {
    private tile2: any;
    private objectsToTeleport: Array<{
        obj: any;
        destTile: any;
    }> = [];
    private delayTicks: number = 0;
    constructor(e: any, t: any, i: any, r: any, superWeaponRange?: readonly number[]) {
        super(e, t, i);
        this.tile2 = r;
        this.objectsToTeleport = [];
        this.superWeaponRange = superWeaponRange?.slice();
    }
    private readonly superWeaponRange?: readonly number[];

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
                if (!object.isUnit?.() || !sourceTile || object.isDisposed ||
                    object.onBridge !== !!sourceTile.onBridgeLandType ||
                    (object.isInfantry?.() && object.stance === StanceType.Paradrop && 2 < object.tileElevation) ||
                    object.invulnerableTrait?.isActive?.() ||
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
                        if (!object.isUnit() ||
                            object.tile !== sourceTile ||
                            object.onBridge !== onBridge ||
                            (object.isInfantry() &&
                                object.stance === StanceType.Paradrop &&
                                2 < object.tileElevation) ||
                            object.isDisposed ||
                            object.invulnerableTrait.isActive()) {
                            continue;
                        }
                        candidates.push({ object, sourceTile, destTile });
                    }
                }
            }
        }

        for (const { object, destTile } of candidates) {
            if ((object.rules.organic && !object.rules.teleporter) || !destTile) {
                t.destroyObject(object, { player: this.owner });
            }
            else if (!object.warpedOutTrait.isActive()) {
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
