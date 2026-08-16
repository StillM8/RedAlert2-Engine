import { Coords } from "@/game/Coords";
import { ObjectType } from "@/engine/type/ObjectType";
import { Warhead } from "@/game/Warhead";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { MoveTask } from "@/game/gameobject/task/move/MoveTask";
import { CallbackTask } from "@/game/gameobject/task/system/CallbackTask";
import { TaskGroup } from "@/game/gameobject/task/system/TaskGroup";
import { FacingUtil } from "@/game/gameobject/unit/FacingUtil";
import { RangeHelper } from "@/game/gameobject/unit/RangeHelper";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { UnlandableTrait } from "@/game/gameobject/trait/UnlandableTrait";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { Vector2 } from "@/game/math/Vector2";
import { bresenham } from "@/util/bresenham";
// One-shot marker anim played at the designated building (no dedicated flare anim exists in YR artmd)
const FLARE_ANIM = "RING1";
const STRIKE_DELAY_TICKS = 15;
const PLANE_STAGGER_TICKS = 15;
const DROP_RANGE_TILES = 2;
const BURST_INTERVAL_TICKS = 5;
const OVERSHOOT_TILES = 12;
interface StrikePlane {
    obj: any;
    dropsLeft: number;
    dropCooldownTicks: number;
    startedDropping: boolean;
}
interface Strike {
    target: any;
    planeRules: any;
    weaponRules?: any;
    entryPoint: Vector2;
    pendingPlanes: number;
    spawnDelayTicks: number;
    planes: StrikePlane[];
}
export class AirstrikeTrait implements NotifyTick {
    private strike?: Strike;
    isActive(): boolean {
        return !!this.strike;
    }
    launchStrike(designator: any, target: any, game: any): void {
        if (this.strike || !target.isBuilding())
            return;
        const isElite = !!designator.veteranTrait?.isElite();
        const planeType = isElite
            ? designator.rules.eliteAirstrikeTeamType
            : designator.rules.airstrikeTeamType;
        if (!planeType)
            return;
        const planeRules = game.rules.getObject(planeType, ObjectType.Aircraft);
        const planeCount = Math.max(1, isElite
            ? designator.rules.eliteAirstrikeTeam
            : designator.rules.airstrikeTeam);
        const targetTile = target.centerTile ?? target.tile;
        const entryPoint = this.chooseEntryPoint(targetTile, game);
        if (!entryPoint)
            return;
        this.strike = {
            target: target,
            planeRules: planeRules,
            weaponRules: planeRules.primary
                ? game.rules.getWeapon(planeRules.primary)
                : undefined,
            entryPoint: entryPoint,
            pendingPlanes: planeCount,
            spawnDelayTicks: STRIKE_DELAY_TICKS,
            planes: [],
        };
        game.events.dispatch(new TriggerAnimEvent(
            FLARE_ANIM,
            targetTile,
            undefined,
            designator.owner,
            designator,
        ));
    }
    [NotifyTick.onTick](gameObject: any, game: any): void {
        const strike = this.strike;
        if (!strike)
            return;
        const targetAlive = !strike.target.isDestroyed && strike.target.isSpawned;
        if (strike.pendingPlanes > 0) {
            if (targetAlive) {
                strike.spawnDelayTicks--;
                if (strike.spawnDelayTicks <= 0) {
                    this.spawnPlane(gameObject, strike, game);
                    strike.pendingPlanes--;
                    strike.spawnDelayTicks = PLANE_STAGGER_TICKS;
                }
            }
            else {
                strike.pendingPlanes = 0;
            }
        }
        const rangeHelper = new RangeHelper(game.map.tileOccupation);
        const targetTile = strike.target.centerTile ?? strike.target.tile;
        for (const plane of strike.planes.slice()) {
            if (plane.obj.isDestroyed || !plane.obj.isSpawned) {
                strike.planes.splice(strike.planes.indexOf(plane), 1);
                continue;
            }
            if (plane.dropCooldownTicks > 0) {
                plane.dropCooldownTicks--;
            }
            if (plane.dropCooldownTicks <= 0 &&
                (plane.startedDropping ||
                    rangeHelper.isInTileRange(plane.obj.tile, targetTile, 0, DROP_RANGE_TILES))) {
                plane.startedDropping = true;
                if (targetAlive) {
                    this.dropBombs(gameObject, plane.obj, strike, game);
                }
                plane.dropsLeft--;
                plane.dropCooldownTicks = BURST_INTERVAL_TICKS;
                if (plane.dropsLeft <= 0) {
                    strike.planes.splice(strike.planes.indexOf(plane), 1);
                }
            }
        }
        if (!strike.pendingPlanes && !strike.planes.length) {
            this.strike = undefined;
        }
    }
    private spawnPlane(designator: any, strike: Strike, game: any): void {
        const targetTile = strike.target.centerTile ?? strike.target.tile;
        const targetCoords = new Vector2(targetTile.rx, targetTile.ry);
        const flightPath = this.computeFlightPath(targetCoords, strike.entryPoint, game);
        if (!flightPath)
            return;
        const { fromTile, toTile } = flightPath;
        const plane = game.createUnitForPlayer(strike.planeRules, designator.owner);
        game.spawnObject(plane, fromTile);
        plane.direction = FacingUtil.fromMapCoords(targetCoords.clone().sub(new Vector2(fromTile.rx, fromTile.ry)));
        plane.position.tileElevation = Coords.worldToTileHeight(plane.rules.flightLevel ?? game.rules.general.flightLevel);
        plane.zone = ZoneType.Air;
        plane.onBridge = false;
        plane.unitOrderTrait.addTask(new TaskGroup(new MoveTask(game, toTile, false, { allowOutOfBoundsTarget: true }), new CallbackTask((obj: any) => {
            if (!obj.isDestroyed) {
                game.unspawnObject(obj);
            }
        })).setCancellable(false));
        plane.traits.find(UnlandableTrait)?.setEnabled(false);
        strike.planes.push({
            obj: plane,
            dropsLeft: Math.max(1, strike.weaponRules?.burst ?? 1),
            dropCooldownTicks: 0,
            startedDropping: false,
        });
    }
    private dropBombs(designator: any, plane: any, strike: Strike, game: any): void {
        const target = strike.target;
        const targetTile = target.centerTile ?? target.tile;
        const weaponRules = strike.weaponRules;
        const warheadName = weaponRules?.warhead ?? game.rules.combatDamage.c4Warhead;
        const damage = weaponRules?.damage ?? 120;
        const warhead = new Warhead(game.rules.getWarhead(warheadName));
        const targetZone = game.map.getTileZone(targetTile);
        warhead.detonate(game, damage, targetTile, 0, target.position.worldPosition.clone(), targetZone, CollisionType.None, game.createTarget(target, targetTile), {
            player: plane.owner,
            obj: plane.isDestroyed ? undefined : plane,
            weapon: undefined,
            aresAttribution: { airstrikeDesignator: designator },
        } as any, false, undefined, undefined);
    }
    private chooseEntryPoint(targetTile: any, game: any): Vector2 | undefined {
        const mapSize = game.map.tiles.getMapSize();
        const targetCoords = new Vector2(targetTile.rx, targetTile.ry);
        const candidates = [
            new Vector2(targetTile.rx, 0),
            new Vector2(targetTile.rx, mapSize.height - 1),
            new Vector2(0, targetTile.ry),
            new Vector2(mapSize.width - 1, targetTile.ry),
        ].filter((point) => point.clone().sub(targetCoords).length() >= 1);
        if (!candidates.length)
            return undefined;
        return candidates.reduce((closest, point) => point.clone().sub(targetCoords).length() <
            closest.clone().sub(targetCoords).length()
            ? point
            : closest);
    }
    private computeFlightPath(targetCoords: Vector2, entryPoint: Vector2, game: any): {
        fromTile: any;
        toTile: any;
    } | undefined {
        const direction = targetCoords.clone().sub(entryPoint);
        const endPoint = entryPoint
            .clone()
            .add(direction.clone().setLength(direction.length() + OVERSHOOT_TILES))
            .floor();
        const pathTiles = bresenham(entryPoint.x, entryPoint.y, endPoint.x, endPoint.y)
            .map((point: any) => game.map.tiles.getByMapCoords(point.x, point.y) ??
            game.map.tiles.getPlaceholderTile(point.x, point.y));
        while (pathTiles.length) {
            const firstTile = pathTiles[0];
            const worldCoords = Coords.tileToWorld(firstTile.rx + 0.5, firstTile.ry + 0.5);
            if (game.map.isWithinHardBounds(new Vector2(worldCoords.x, worldCoords.y)))
                break;
            pathTiles.shift();
        }
        if (!pathTiles.length)
            return undefined;
        return { fromTile: pathTiles[0], toTile: pathTiles[pathTiles.length - 1] };
    }
}
