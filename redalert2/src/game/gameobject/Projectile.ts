import { GameObject } from './GameObject';
import { ObjectType } from '@/engine/type/ObjectType';
import { Weapon } from '@/game/Weapon';
import { WeaponType } from '@/game/WeaponType';
import { FacingUtil } from './unit/FacingUtil';
import { Coords } from '@/game/Coords';
import { ZoneType } from './unit/ZoneType';
import { TileOccupation, LayerType } from '@/game/map/TileOccupation';
import { RadialTileFinder } from '@/game/map/tileFinder/RadialTileFinder';
import { RangeHelper } from './unit/RangeHelper';
import { TargetUtil } from './unit/TargetUtil';
import * as geometry from '@/game/math/geometry';
import { RandomTileFinder } from '@/game/map/tileFinder/RandomTileFinder';
import { clamp, lerp } from '@/util/math';
import { TriggerAnimEvent } from '@/game/event/TriggerAnimEvent';
import { MovementZone } from '@/game/type/MovementZone';
import { StanceType } from './infantry/StanceType';
import { MovePositionHelper } from './unit/MovePositionHelper';
import { GameSpeed } from '@/game/GameSpeed';
import { VeteranLevel } from './unit/VeteranLevel';
import { ScatterTask } from './task/ScatterTask';
import { Warhead } from '@/game/Warhead';
import { ObjectRules } from '@/game/rules/ObjectRules';
import { CollisionHelper } from './unit/CollisionHelper';
import { CollisionType } from './unit/CollisionType';
import { Vector2 } from '@/game/math/Vector2';
import { Vector3 } from '@/game/math/Vector3';
import { Box2 } from '@/game/math/Box2';
import {
    chooseAresSplitTargetIndex,
    getAresAirburstCellOffsets,
    hasAresProjectileSplitBehavior,
    sortAresSplitCandidates,
    shouldRetargetAresSplit,
} from '@/extensions/ares/AresProjectileExtensions';
import {
    applyAresFirestormWallDamage,
    isAresActiveFirestormWall,
} from '@/extensions/ares/AresFirestorm';
import {
    getAresUrbanCombatPassThroughChance,
    resolveAresUrbanCombatHit,
} from '@/extensions/ares/AresUrbanCombatRuntime';
export enum ProjectileState {
    Travel = 0,
    Impact = 1,
    Detonation = 2
}
export class Projectile extends GameObject {
    private _fromObject?: any;
    private tileOccupation: TileOccupation;
    private state: ProjectileState;
    private detonationTimer: number;
    private collisionType: CollisionType;
    private direction: number;
    private zone: ZoneType;
    private isShrapnel: boolean;
    private isNuke: boolean;
    private baseDamageMultiplier: number;
    private veteranDamageMult: number;
    private snapToTarget: boolean;
    private targetLockLost: boolean;
    private limboTravelTicks: number;
    private homingTravelDistance: number;
    private homingTravelTicks: number;
    private velocity: Vector3;
    private sonicVisitedObjects: Map<any, Set<any>>;
    private collisionHelper: CollisionHelper;
    private initialSelfPosition?: Vector3;
    private target: any;
    private fromWeapon: any;
    private fromPlayer: any;
    private maxSpeed?: number;
    private initialTileDistToTarget?: number;
    private homingMoveDir?: Vector3;
    private aimPoint?: Vector3;
    private overshootTiles?: number;
    private lastTargetLockPosition?: Vector3;
    private speed?: number;
    private impactAnim?: string;
    get fromObject() {
        return this._fromObject;
    }
    set fromObject(value: any) {
        this._fromObject = value;
        if (value && value.veteranTrait && !value.isDestroyed) {
            this.veteranDamageMult = value.veteranTrait.getVeteranDamageMultiplier();
        }
    }
    get rot(): number {
        return this.fromWeapon.rules.isSonic
            ? ObjectRules.iniRotToDegsPerTick(this.iniRot)
            : this.rules.rot;
    }
    get iniRot(): number {
        return this.fromWeapon.rules.isSonic ? 10 : this.rules.iniRot;
    }
    static factory(name: string, rules: any, art: any, tileOccupation: TileOccupation): Projectile {
        return new this(name, rules, art, tileOccupation);
    }
    constructor(name: string, rules: any, art: any, tileOccupation: TileOccupation) {
        super(ObjectType.Projectile, name, rules, art);
        this.tileOccupation = tileOccupation;
        this.state = ProjectileState.Travel;
        this.detonationTimer = 0;
        this.collisionType = CollisionType.None;
        this.direction = 0;
        this.zone = ZoneType.Air;
        this.isShrapnel = false;
        this.isNuke = false;
        this.baseDamageMultiplier = 1;
        this.veteranDamageMult = 1;
        this.snapToTarget = false;
        this.targetLockLost = false;
        this.limboTravelTicks = 0;
        this.homingTravelDistance = 0;
        this.homingTravelTicks = 0;
        this.velocity = new Vector3();
        this.sonicVisitedObjects = new Map();
        this.collisionHelper = new CollisionHelper(tileOccupation);
    }
    onSpawn(game: any): void {
        super.onSpawn(game);
        this.initialSelfPosition = this.position.worldPosition.clone();
        if (!this.target.obj ||
            this.fromWeapon.type === WeaponType.DeathWeapon ||
            this.fromWeapon.rules.limboLaunch ||
            (!this.isHoming() && this.fromWeapon.speed === Number.POSITIVE_INFINITY) ||
            this.rules.inaccurate ||
            this.rules.arcing ||
            this.rules.flakScatter ||
            this.isPrismSupportBeam(game)) {
        }
        else {
            let damage = this.computeBaseDamage(game);
            if (damage > 0) {
                damage = this.fromWeapon.warhead.computeDamage(damage, this.target.obj, game);
                this.target.obj.healthTrait?.projectDamage(damage);
            }
        }
        game.afterTick(() => {
            const rangeHelper = new RangeHelper(this.tileOccupation);
            const tileDistance = rangeHelper.distance2(this.target.getWorldCoords(), this as any) / Coords.LEPTONS_PER_TILE;
            this.initialTileDistToTarget = tileDistance;
            this.maxSpeed = this.computeMaxSpeed(this.fromWeapon.speed, tileDistance, game.rules.audioVisual.gravity);
        });
        if (this.isHoming()) {
            if (this.iniRot === 1) {
                this.homingMoveDir = this.target
                    .getWorldCoords()
                    .clone()
                    .sub(this.position.worldPosition);
            }
            if (this.fromObject?.isAircraft() &&
                this.rules.isAntiGround &&
                !this.rules.isAntiAir) {
                const targetObj = this.target.obj;
                if (targetObj?.isVehicle() &&
                    !targetObj.isDestroyed &&
                    targetObj.veteranLevel === VeteranLevel.Elite &&
                    !targetObj.unitOrderTrait.hasTasks()) {
                    targetObj.unitOrderTrait.addTask(new ScatterTask(game as any, undefined as any, undefined as any));
                }
            }
        }
        else if (this.rules.vertical) {
            const pos = this.position.clone();
            pos.tileElevation = this.fromWeapon.warhead.rules.nukeMaker
                ? Coords.worldToTileHeight(this.fromWeapon.projectileRules.detonationAltitude)
                : 0;
            this.aimPoint = pos.worldPosition.clone();
        }
        else {
            const initialTargetPos = this.target.getWorldCoords().clone();
            game.afterTick(() => {
                const targetMovement = this.target.getWorldCoords().clone().sub(initialTargetPos);
                const targetMoved = targetMovement.length() > Coords.LEPTONS_PER_TILE;
                let aimPoint = targetMoved
                    ? initialTargetPos
                    : this.target.obj?.isUnit() &&
                        this.target.obj.moveTrait.velocity.length() &&
                        isFinite(this.maxSpeed!)
                        ? this.computeAimPointVersusMovingTarget(this.target.obj, this.maxSpeed!, this.position.worldPosition, game.map)
                        : this.target.getWorldCoords().clone();
                this.aimPoint = aimPoint;
                this.snapToTarget = !targetMoved &&
                    isFinite(this.maxSpeed!) &&
                    !this.fromWeapon.warhead.rules.sonic;
                if (this.rules.inaccurate || this.rules.flakScatter) {
                    this.adjustAimForBallisticScatter(game, aimPoint);
                    this.snapToTarget = false;
                }
                if (!targetMoved && this.rules.arcing) {
                    if (this.rules.inaccurate) {
                        this.overshootTiles = this.calculateInaccurateBallisticOvershoot(game);
                        this.snapToTarget = false;
                    }
                    else if (this.target.obj?.isVehicle() &&
                        this.target.obj.moveTrait.isMoving()) {
                        this.overshootTiles = this.calculateBallisticOvershootVsMoving(game, this.target.obj);
                        if (this.overshootTiles) {
                            this.snapToTarget = false;
                        }
                    }
                }
                const toTarget = aimPoint.clone().sub(this.position.worldPosition);
                if (toTarget.length() < this.fromWeapon.speed) {
                    this.update(game);
                }
            });
        }
    }
    private adjustAimForBallisticScatter(game: any, aimPoint: Vector3): void {
        let scatter = game.rules.combatDamage.ballisticScatter;
        let scatterAmount: number;
        if (this.rules.flakScatter) {
            if (this.rules.inviso) {
                scatter *= 2;
            }
            scatterAmount = game.generateRandom() * scatter;
        }
        else {
            scatterAmount = scatter / 2 + game.generateRandom() * (scatter / 2);
        }
        let scatterDistance = scatterAmount * Coords.LEPTONS_PER_TILE;
        if (this.rules.flakScatter) {
            const distanceToTarget = aimPoint.clone().sub(this.initialSelfPosition!).length();
            scatterDistance *= distanceToTarget / (this.fromWeapon.range * Coords.LEPTONS_PER_TILE);
        }
        const scatterVec = geometry.rotateVec2(new Vector2(scatterDistance, 0), game.generateRandomInt(0, 360));
        const scatterTile = Coords.vecWorldToGround(aimPoint)
            .add(scatterVec)
            .multiplyScalar(1 / Coords.LEPTONS_PER_TILE)
            .floor();
        if (game.map.tiles.getByMapCoords(scatterTile.x, scatterTile.y)) {
            aimPoint.add(new Vector3(scatterVec.x, 0, scatterVec.y));
        }
    }
    private calculateBallisticOvershootVsMoving(game: any, target: any): number {
        const toTarget = this.target
            .getWorldCoords()
            .clone()
            .sub(this.initialSelfPosition!);
        const toTargetGround = Coords.vecWorldToGround(toTarget);
        const velocityGround = Coords.vecWorldToGround(target.moveTrait.velocity);
        const angle = geometry.angleDegBetweenVec2(toTargetGround, velocityGround);
        const angleFactor = (angle > 90 ? 180 - angle : angle) / 90;
        const distance = toTarget.length() / Coords.LEPTONS_PER_TILE;
        const overshootChance = (angleFactor * distance) / 5;
        return game.generateRandom() <= overshootChance ? 2 * Math.min(1, distance / 5) : 0;
    }
    private calculateInaccurateBallisticOvershoot(game: any): number {
        return game.generateRandom() <= 0.5 ? 2 : 0;
    }
    update(game: any): void {
        if (this.maxSpeed === undefined)
            return;
        super.update(game);
        if (this.state === ProjectileState.Impact) {
            if (this.detonationTimer > 0) {
                this.detonationTimer--;
            }
            else {
                this.detonate(game, this.collisionType);
            }
            return;
        }
        const oldVelocity = this.velocity.clone();
        const oldPosition = this.position.clone();
        this.velocity.set(0, 0, 0);
        if (this.fromWeapon.rules.limboLaunch) {
            if (!this.fromObject) {
                throw new Error("Limbo launch projectile must be fired from a unit");
            }
            if (this.fromObject.isDestroyed) {
                game.destroyObject(this);
                return;
            }
        }
        const currentSpeed = this.updateSpeed(this.maxSpeed);
        this.speed = currentSpeed;
        let targetPos = this.target.getWorldCoords();
        if (this.lastTargetLockPosition &&
            (this.targetLockLost ||
                targetPos.clone().sub(this.lastTargetLockPosition).length() >= Coords.LEPTONS_PER_TILE)) {
            targetPos = this.lastTargetLockPosition;
            this.targetLockLost = true;
        }
        else {
            this.lastTargetLockPosition = targetPos.clone();
        }
        if (this.isHoming()) {
            if (this.target.obj?.isUnit() &&
                (this.target.obj.isDestroyed ||
                    this.target.obj.isCrashing ||
                    !this.target.obj.isSpawned) &&
                (this.fromWeapon.rules.limboLaunch ||
                    this.homingTravelDistance >= 2 * Coords.LEPTONS_PER_TILE)) {
                this.detonate(game);
                return;
            }
            if (!this.homingMoveDir) {
                const facingCoords = FacingUtil.toMapCoords(this.direction);
                this.homingMoveDir = new Vector3(facingCoords.x, 0, facingCoords.y);
                if (this.fromObject?.isAircraft()) {
                    this.homingMoveDir.y = -9999999;
                    this.homingMoveDir.normalize();
                }
            }
            if (this.fromWeapon.rules.limboLaunch) {
                if (!this.targetLockLost) {
                    if (this.limboTravelTicks > 10) {
                        this.position.moveToLeptons(this.target.obj.position.getMapPosition());
                        this.position.tileElevation = this.target.obj.position.tileElevation;
                        this.detonate(game);
                        return;
                    }
                    this.limboTravelTicks++;
                }
            }
            else if (!this.isInHomingRange(targetPos, game)) {
                this.detonate(game);
                return;
            }
            const rangeHelper = new RangeHelper(this.tileOccupation);
            const tileDistance = Math.floor(rangeHelper.distance2(targetPos, this as any) / Coords.LEPTONS_PER_TILE);
            const shouldTurn = tileDistance > 2 && this.iniRot > 1;
            const toTarget = targetPos.clone().sub(this.position.worldPosition);
            let verticalAdjustment = 0;
            if (this.homingTravelTicks >= this.rules.courseLockDuration) {
                if (shouldTurn) {
                    geometry.rotateVec3Towards(this.homingMoveDir, new Vector3(toTarget.x, this.homingMoveDir.y, toTarget.z), this.rot);
                    if (!this.rules.level) {
                        const targetElevation = clamp(Math.floor(this.initialTileDistToTarget!) - 1, 0, 2) + clamp(tileDistance - 2, 0, 3);
                        const bridgeElevation = this.tileOccupation.getBridgeOnTile(this.tile)?.tileElevation ?? 0;
                        const elevationDiff = targetElevation - (this.position.tileElevation - bridgeElevation);
                        if (elevationDiff) {
                            const maxElevationChange = 0.25 + (6 / this.iniRot) * 0.1;
                            verticalAdjustment = Coords.tileHeightToWorld(Math.sign(elevationDiff) * Math.min(Math.abs(elevationDiff), maxElevationChange));
                        }
                    }
                }
                else {
                    geometry.rotateVec3Towards(this.homingMoveDir, toTarget, this.rot);
                }
            }
            this.direction = FacingUtil.fromMapCoords(new Vector2(this.homingMoveDir.x, this.homingMoveDir.z));
            const distanceToTarget = toTarget.length();
            const moveDistance = Math.min(distanceToTarget, currentSpeed);
            this.homingTravelDistance += moveDistance;
            this.homingTravelTicks++;
            let shouldDetonate = false;
            let collisionType = CollisionType.None;
            let collisionTarget: any;
            if (moveDistance >= 1) {
                const moveVector = this.homingMoveDir.clone().setLength(moveDistance);
                if (verticalAdjustment) {
                    moveVector.y += verticalAdjustment;
                }
                if (moveDistance === currentSpeed) {
                    this.velocity.copy(moveVector);
                }
                const newPos = moveVector.clone().add(this.position.worldPosition);
                if (game.map.mapBounds.isWithinHardBounds(newPos)) {
                    this.position.moveByLeptons3(moveVector);
                }
                else {
                    shouldDetonate = true;
                }
                const collision = this.checkObstacles(oldPosition, game);
                collisionType = collision.type;
                collisionTarget = collision.target;
                if (collisionType || moveDistance < currentSpeed) {
                    shouldDetonate = true;
                }
            }
            else {
                this.position.moveByLeptons3(toTarget);
                shouldDetonate = true;
            }
            if (shouldDetonate) {
                if (collisionTarget && collisionType === CollisionType.Wall) {
                    const wallPos = collisionTarget.position.worldPosition;
                    this.position.moveByLeptons3(wallPos.clone().sub(this.position.worldPosition));
                }
                this.collisionType = collisionType;
                this.detonate(game, collisionType);
            }
        }
        else {
            const toAimPoint = this.aimPoint!
                .clone()
                .sub(this.position.worldPosition);
            if (!this.rules.vertical) {
                this.direction = FacingUtil.fromMapCoords(new Vector2(toAimPoint.x, toAimPoint.z));
            }
            if (this.rules.arcing) {
                toAimPoint.y = 0;
            }
            const moveDistance = Math.min(toAimPoint.length(), currentSpeed);
            toAimPoint.setLength(moveDistance);
            if (this.rules.arcing) {
                const currentOffset = Coords.vecWorldToGround(this.position.worldPosition
                    .clone()
                    .sub(this.initialSelfPosition!)
                    .add(toAimPoint));
                const totalOffset = this.aimPoint!
                    .clone()
                    .sub(this.initialSelfPosition!);
                const currentDistance = currentOffset.length();
                const totalDistance = Coords.vecWorldToGround(totalOffset).length();
                const targetHeight = totalOffset.y;
                const gravity = game.rules.audioVisual.gravity;
                toAimPoint.y =
                    (((targetHeight / totalDistance) * currentSpeed + ((gravity / 2) * totalDistance) / currentSpeed) * currentDistance) / currentSpeed -
                        (gravity * (currentDistance / currentSpeed) * (currentDistance / currentSpeed)) / 2 +
                        this.initialSelfPosition!.y -
                        this.position.worldPosition.y;
            }
            let shouldDetonate = false;
            const newPos = toAimPoint.clone().add(this.position.worldPosition);
            if (game.map.isWithinHardBounds(newPos)) {
                this.position.moveByLeptons3(toAimPoint);
            }
            else {
                shouldDetonate = true;
            }
            let collisionType = CollisionType.None;
            let collisionTarget: any;
            if (moveDistance >= 1) {
                if (moveDistance !== currentSpeed && !this.overshootTiles) {
                }
                else {
                    this.velocity.copy(toAimPoint);
                }
                const collision = this.checkObstacles(oldPosition, game);
                collisionType = collision.type;
                collisionTarget = collision.target;
                if (collisionType || moveDistance < currentSpeed) {
                    shouldDetonate = true;
                }
            }
            else {
                shouldDetonate = true;
            }
            if (shouldDetonate) {
                if (collisionType) {
                    if (collisionTarget && collisionType === CollisionType.Wall) {
                        const wallPos = collisionTarget.isBuilding()
                            ? Coords.tile3dToWorld(collisionTarget.tile.rx + 0.5, collisionTarget.tile.ry + 0.5, collisionTarget.tile.z)
                            : collisionTarget.position.worldPosition;
                        this.position.moveByLeptons3(wallPos.clone().sub(this.position.worldPosition));
                    }
                }
                else if (this.overshootTiles) {
                    const overshootVec = Coords.vecWorldToGround(oldVelocity).setLength(this.overshootTiles * Coords.LEPTONS_PER_TILE);
                    geometry.rotateVec2(overshootVec, game.generateRandomInt(-45, 45));
                    const overshootPos = Coords.vecGroundToWorld(overshootVec).add(this.position.worldPosition);
                    if (!game.map.isWithinHardBounds(overshootPos)) {
                        game.unspawnObject(this);
                        return;
                    }
                    this.position.moveByLeptons(overshootVec.x, overshootVec.y);
                }
                else if (this.snapToTarget && !this.targetLockLost) {
                    if (!game.map.isWithinHardBounds(targetPos)) {
                        game.unspawnObject(this);
                        return;
                    }
                    this.position.moveByLeptons3(targetPos.clone().sub(this.position.worldPosition));
                }
                this.collisionType = collisionType;
                if (this.isNuke) {
                    this.state = ProjectileState.Impact;
                    this.detonationTimer = 2.5 * GameSpeed.BASE_TICKS_PER_SECOND;
                }
                else {
                    this.detonate(game, collisionType);
                }
            }
        }
        const warhead = this.fromWeapon.warhead;
        if (this.isWaveWeapon() && this.fromWeapon.rules.ambientDamage !== 0) {
            const sonicRadius = (11 / 30) * Coords.LEPTONS_PER_TILE;
            const waveDirection = this.velocity.lengthSq() > 0
                ? this.velocity.clone()
                : this.target.getWorldCoords().clone().sub(this.position.worldPosition);
            const sonicPos = this.position.worldPosition
                .clone()
                .add(waveDirection.lengthSq() > 0 ? waveDirection.setLength(sonicRadius) : waveDirection);
            const sonicTile = Coords.vecWorldToGround(sonicPos)
                .multiplyScalar(1 / Coords.LEPTONS_PER_TILE)
                .floor();
            const tile = game.map.tiles.getByMapCoords(sonicTile.x, sonicTile.y);
            if (tile && tile !== this.fromObject?.tile) {
                const tileZone = game.map.getTileZone(tile);
                for (const obj of game.map.getGroundObjectsOnTile(tile)) {
                    if ((!obj.isUnit() || !obj.onBridge) &&
                        (!obj.isTechno() ||
                            !obj.rules.typeImmune ||
                            obj.owner !== this.fromPlayer ||
                            obj.name !== this.fromObject?.name) &&
                        (!obj.isAircraft() || !obj.rules.spawned) &&
                        warhead.canDamage(obj, tile, tileZone)) {
                        let visitedTiles = this.sonicVisitedObjects.get(obj) ?? new Set();
                        visitedTiles.add(tile);
                        this.sonicVisitedObjects.set(obj, visitedTiles);
                    }
                }
            }
            for (const [obj, tiles] of this.sonicVisitedObjects) {
                for (const visitedTile of tiles) {
                    if (game.map.tileOccupation.isTileOccupiedBy(visitedTile, obj) &&
                        obj.isSpawned) {
                        let damage = this.fromWeapon.rules.ambientDamage *
                            this.veteranDamageMult *
                            this.baseDamageMultiplier;
                        damage = warhead.computeDamage(damage, obj, game);
                        warhead.inflictDamage(damage, obj, {
                            player: this.fromPlayer,
                            weapon: this.fromWeapon,
                            obj: this.fromObject,
                        }, game, obj !== this.target.obj);
                    }
                }
            }
        }
    }
    private isWaveWeapon(): boolean {
        const weaponRules = this.fromWeapon.rules;
        return weaponRules.isSonic ||
            weaponRules.isMagBeam ||
            weaponRules.aresWeaponVisuals?.waveIsLaser ||
            weaponRules.aresWeaponVisuals?.waveIsBigLaser;
    }
    private isHoming(): boolean {
        return !!this.rot && !this.rules.arcing;
    }
    private isInHomingRange(targetPos: Vector3, game: any): boolean {
        let inRange = true;
        const targetObj = this.target.obj;
        if (targetObj?.isUnit() && this.fromObject) {
            const rangeHelper = new RangeHelper(this.tileOccupation);
            const weaponRange = rangeHelper.computeWeaponRangeVsTarget(this.fromObject, targetObj, this.fromWeapon, game.rules).range;
            if (this.fromWeapon.rules.limboLaunch) {
                inRange = rangeHelper.isInRange3(this.initialSelfPosition!, targetPos, 0, weaponRange + 0.5);
            }
            else {
                const targetSpeed = targetObj.moveTrait.velocity.length();
                if (targetSpeed) {
                    if (this.fromObject.rules.movementZone === MovementZone.Fly) {
                        if (this.speed! / targetSpeed > 5) {
                            inRange = rangeHelper.isInRange2(this.initialSelfPosition!, this.position.worldPosition, 0, weaponRange);
                        }
                    }
                    else if (isFinite(this.fromWeapon.speed) &&
                        this.fromWeapon.speed / targetObj.rules.speed > 3.5) {
                        inRange = rangeHelper.isInRange3(this.initialSelfPosition!, this.position.worldPosition, 0, weaponRange);
                    }
                }
            }
        }
        return inRange;
    }
    private updateSpeed(maxSpeed: number): number {
        let speed: number;
        if (this.isHoming() || this.rules.vertical) {
            if (this.speed === undefined) {
                speed = Math.min(maxSpeed, this.rules.acceleration);
            }
            else {
                speed = Math.min(maxSpeed, this.speed + this.rules.acceleration);
            }
        }
        else {
            speed = maxSpeed;
        }
        return speed;
    }
    private computeMaxSpeed(weaponSpeed: number, tileDistance: number, gravity: number): number {
        let maxSpeed = weaponSpeed;
        if (this.rules.arcing) {
            maxSpeed *= (1 + gravity / 6) / 2;
            const floorDistance = Math.floor(tileDistance);
            maxSpeed *= floorDistance <= 8 ? 1 : 1 + (floorDistance / 8) * 0.5;
        }
        if (this.fromWeapon.warhead.rules.sonic) {
            maxSpeed = Math.ceil((tileDistance * Coords.LEPTONS_PER_TILE) / 21);
        }
        return maxSpeed;
    }
    private checkObstacles(oldPosition: any, game: any): {
        type: CollisionType;
        target?: any;
    } {
        if (this.fromWeapon.rules.limboLaunch) {
            return { type: CollisionType.None };
        }
        return this.collisionHelper.checkCollisions(this.position, oldPosition, {
            cliffs: this.rules.subjectToCliffs,
            ground: this.isHoming(),
            shore: this.rules.level,
            walls: this.rules.subjectToWalls,
            firestorm: this.rules.subjectToFirestorm
                ? (object: any) => isAresActiveFirestormWall(object, this.fromPlayer)
                : undefined,
            units: !this.rules.inaccurate &&
                ((owner: any) => this.fromPlayer !== owner &&
                    !game.alliances.areAllied(this.fromPlayer, owner)),
        });
    }
    private isPrismSupportBeam(game: any): boolean {
        const prismType = game.rules.general.prism.type;
        return !!prismType &&
            this.fromWeapon.type === WeaponType.Secondary &&
            !!this.fromObject?.isBuilding() &&
            this.fromObject.name === prismType;
    }

    private computeBaseDamage(game: any): number {
        const weapon = this.fromWeapon;
        const warhead = weapon.warhead;
        let damage = weapon.rules.damage;
        if (weapon.type === WeaponType.DeathWeapon && warhead.rules.ivanBomb) {
            damage = game.rules.combatDamage.ivanDamage;
        }
        let totalDamage = damage * this.baseDamageMultiplier;
        if (weapon.type === WeaponType.DeathWeapon && this.fromObject) {
            totalDamage *= this.fromObject.rules.deathWeaponDamageModifier;
        }
        totalDamage *= this.veteranDamageMult;
        return totalDamage;
    }
    /**
     * Applies the optional generic Urban Combat building rule before ordinary
     * warhead damage. The optional data is deliberately read from the live
     * building rules so vanilla buildings and buildings without an Ares
     * definition retain the existing warhead path.
     */
    private applyAresUrbanCombatOccupantHit(
        game: any,
        targetObj: any,
        warhead: Warhead,
        weapon: any,
        damage: number,
    ): boolean {
        if (!targetObj?.isBuilding?.() || !targetObj.rules?.aresUrbanCombat) return false;
        const garrisonTrait = targetObj.garrisonTrait;
        const occupants = garrisonTrait?.units;
        if (!Array.isArray(occupants) || occupants.length === 0) return false;
        if (typeof game.generateRandom !== "function" || typeof game.generateRandomInt !== "function") return false;

        const urbanRules = targetObj.rules.aresUrbanCombat;
        // ProjectileRules predates this optional Ares field. Missing means the
        // documented SubjectToTrenches=yes default, while an explicit false
        // remains a generic projectile-side override.
        const projectileUrbanRules = {
            subjectToTrenches: (this.rules as any)?.subjectToTrenches !== false,
        };
        const passThroughRoll = game.generateRandom();
        const passThroughChance = getAresUrbanCombatPassThroughChance(
            urbanRules,
            projectileUrbanRules,
            true,
        );
        if (passThroughRoll >= passThroughChance) return false;

        const occupantIndex = game.generateRandomInt(0, occupants.length - 1);
        const occupant = occupants[Math.max(0, Math.min(occupants.length - 1, occupantIndex))];
        if (!occupant?.healthTrait) return false;

        const decision = resolveAresUrbanCombatHit(
            urbanRules,
            projectileUrbanRules,
            {
                hasOccupants: true,
                passThroughRoll,
                fatalRoll: game.generateRandom(),
                weaponDamage: damage,
            },
        );
        if (decision.kind === "building") return false;

        const weaponInfo = {
            player: this.fromPlayer,
            weapon,
            obj: this.fromObject,
        };
        if (decision.kind === "occupant-fatal") {
            warhead.inflictDamage(Number.POSITIVE_INFINITY, occupant, weaponInfo, game, true);
        }
        else {
            const occupantDamage = warhead.computeDamage(decision.damage, occupant, game);
            warhead.inflictDamage(occupantDamage, occupant, weaponInfo, game, true);
        }

        if (occupant.isDestroyed || occupant.healthTrait.health <= 0) {
            const index = occupants.indexOf(occupant);
            if (index >= 0) occupants.splice(index, 1);
        }
        return true;
    }
    private detonate(game: any, collisionType: CollisionType = CollisionType.None): void {
        const weapon = this.fromWeapon;
        let warhead = weapon.warhead;
        const detonationZone = this.zone = this.collisionHelper.computeDetonationZone(this.tile, this.tileElevation, collisionType);
        const detonationTile = this.tile;
        if (weapon.type === WeaponType.DeathWeapon && warhead.rules.ivanBomb) {
            warhead = new Warhead(game.rules.getWarhead(game.rules.combatDamage.ivanWarhead));
        }
        const damage = this.computeBaseDamage(game);
        game.destroyObject(this);
        this.state = ProjectileState.Detonation;

        // Antares replaces ordinary detonation for Airburst/Splits bullets:
        // the configured AirburstWeapon projectiles carry the actual warhead.
        // Keep this before the vanilla warhead path so the outer projectile
        // cannot apply its placeholder damage as well.
        if (hasAresProjectileSplitBehavior(this.rules)) {
            this.spawnAresProjectileChildren(game, detonationTile);
            return;
        }

        const targetObj = this.target.obj;
        let parasiteSuccess = false;
        // Flag for a parasite warhead instantly killing infantry (distinct from vehicle parasitism; after an infantry kill the attacking unit must return to the map)
        let parasiteInfantryKill = false;
        if (warhead.rules.parasite &&
            targetObj?.isUnit() &&
            detonationTile === targetObj.tile &&
            warhead.canDamage(targetObj, detonationTile, detonationZone)) {
            if (targetObj.isInfantry()) {
                // Attack dog and Terror Drone parasite warheads deal infinite damage to infantry for an instant kill
                const infiniteDamage = Number.POSITIVE_INFINITY;
                warhead.inflictDamage(infiniteDamage, targetObj, {
                    player: this.fromPlayer,
                    weapon: weapon,
                    obj: this.fromObject,
                }, game, true);
                // Do not set parasiteSuccess, so the attacking unit can return to the map from limbo
                parasiteInfantryKill = true;
            }
            else if (targetObj.parasiteableTrait && this.fromObject?.isUnit()) {
                if (!(this.fromWeapon instanceof Weapon)) {
                    throw new Error("Projectile with parasite warhead must have a weapon reference");
                }
                targetObj.parasiteableTrait.infest(this.fromObject, this.fromWeapon);
                parasiteSuccess = true;
            }
        }
        let shouldDetonate = true;
        // Skip normal warhead detonation after a successful vehicle infestation or an infantry instant kill
        if (parasiteSuccess || parasiteInfantryKill) {
            shouldDetonate = false;
        }
        if (warhead.rules.sonic) {
            shouldDetonate = false;
        }
        if (warhead.rules.ivanBomb) {
            shouldDetonate = false;
            if (targetObj?.isTechno() &&
                targetObj.tntChargeTrait &&
                !targetObj.tntChargeTrait.hasCharge() &&
                !targetObj.isDestroyed &&
                !targetObj.warpedOutTrait.isInvulnerable()) {
                const delay = game.rules.combatDamage.ivanTimedDelay;
                targetObj.tntChargeTrait.setCharge(delay, game.currentTick, {
                    player: this.fromPlayer,
                });
            }
        }
        if (warhead.rules.bombDisarm) {
            shouldDetonate = false;
            if (targetObj?.isTechno() &&
                targetObj.tntChargeTrait?.hasCharge() &&
                !targetObj.isDestroyed) {
                targetObj.tntChargeTrait.removeCharge();
            }
        }
        if (warhead.rules.mindControl) {
            shouldDetonate = false;
            if (this.fromObject &&
                !this.fromObject.isDestroyed &&
                targetObj?.isTechno() &&
                targetObj.mindControllableTrait &&
                !targetObj.mindControllableTrait?.isActive() &&
                !game.areFriendly(targetObj, this.fromObject) &&
                warhead.canDamage(targetObj, detonationTile, detonationZone) &&
                !targetObj.invulnerableTrait.isActive()) {
                this.fromObject.mindControllerTrait.control(targetObj, game);
            }
        }
        if (warhead.rules.isLocomotor) {
            // Magnetron beam: no detonation — the vehicle is held suspended
            // for as long as the beam keeps refreshing it.
            shouldDetonate = false;
            if (targetObj?.isVehicle() &&
                !targetObj.isDestroyed &&
                targetObj.magnetizedTrait &&
                warhead.canDamage(targetObj, detonationTile, detonationZone) &&
                !targetObj.invulnerableTrait.isActive()) {
                targetObj.magnetizedTrait.refresh(targetObj, game, this.fromObject);
            }
        }
        if (warhead.rules.airstrike) {
            shouldDetonate = false;
            if (this.fromObject &&
                !this.fromObject.isDestroyed &&
                this.fromObject.airstrikeTrait &&
                targetObj?.isBuilding() &&
                !targetObj.isDestroyed &&
                !game.areFriendly(targetObj, this.fromObject)) {
                this.fromObject.airstrikeTrait.launchStrike(this.fromObject, targetObj, game);
            }
        }
        if (warhead.rules.psychedelic) {
            shouldDetonate = false;
            // Berserk gas: no health damage; instead all vehicles/infantry in the
            // spread go berserk. Vanilla YR derives the berserk duration (in ticks)
            // from the verses-adjusted warhead damage.
            const cellSpread = Math.max(warhead.rules.cellSpread, 0.5);
            const rangeHelper = new RangeHelper(game.map.tileOccupation);
            const affected = new Set<any>();
            const tileFinder = new RadialTileFinder(game.map.tiles, game.map.mapBounds, detonationTile, { width: 1, height: 1 }, 0, Math.ceil(cellSpread), () => true);
            let gasTile: any;
            while ((gasTile = tileFinder.getNextTile())) {
                for (const obj of game.map.getObjectsOnTile(gasTile)) {
                    if (affected.has(obj))
                        continue;
                    if (!obj.isVehicle() && !obj.isInfantry())
                        continue;
                    // The gas source is immune to its own cloud
                    if (obj === this.fromObject)
                        continue;
                    if (!obj.berserkTrait)
                        continue;
                    if (!warhead.canDamage(obj, gasTile, detonationZone))
                        continue;
                    const distance = rangeHelper.distance3(obj, this.position.worldPosition) / Coords.LEPTONS_PER_TILE;
                    if (distance > cellSpread)
                        continue;
                    affected.add(obj);
                    let duration = warhead.computeDamage(damage, obj, game);
                    if (duration > 0) {
                        duration = lerp(duration, warhead.rules.percentAtMax * duration, Math.min(1, distance / cellSpread));
                    }
                    if (duration > 0) {
                        obj.berserkTrait.refresh(duration, game);
                    }
                }
            }
            // Normal detonation is skipped, so play the gas anim manually
            if (warhead.rules.animList.length) {
                game.events.dispatch(new TriggerAnimEvent(warhead.rules.animList[0], detonationTile));
            }
        }
        if (warhead.rules.temporal) {
            shouldDetonate = false;
            if (this.fromObject &&
                !this.fromObject.isDestroyed &&
                targetObj?.isTechno() &&
                warhead.canDamage(targetObj, detonationTile, detonationZone) &&
                !targetObj.invulnerableTrait.isActive()) {
                warhead.inflictDamage(0, targetObj, {
                    player: this.fromPlayer,
                    weapon: weapon,
                    obj: this.fromObject,
                }, game);
                this.fromObject.temporalTrait.updateTarget(targetObj, weapon, game);
            }
        }
        if (warhead.rules.makesDisguise) {
            shouldDetonate = false;
            if (this.fromObject &&
                !this.fromObject.isDestroyed &&
                (this.fromObject.isInfantry() || this.fromObject.isVehicle()) &&
                targetObj?.isUnit() &&
                targetObj.type === this.fromObject.type) {
                this.fromObject.disguiseTrait?.disguiseAs(targetObj, this.fromObject, game);
            }
        }
        if (warhead.rules.electricAssault) {
            if (this.fromObject?.isUnit() &&
                !this.fromObject.isDestroyed &&
                targetObj?.isBuilding() &&
                !targetObj.isDestroyed &&
                targetObj.overpoweredTrait &&
                targetObj.owner === this.fromPlayer) {
                targetObj.overpoweredTrait.chargeFrom(this.fromObject);
            }
            shouldDetonate = false;
        }
        if (this.isPrismSupportBeam(game)) {
            shouldDetonate = false;
        }
        if (shouldDetonate) {
            const occupantHit = this.applyAresUrbanCombatOccupantHit(
                game,
                targetObj,
                warhead,
                weapon,
                damage,
            );
            if (!occupantHit) {
                warhead.detonate(game, damage, detonationTile, this.tileElevation, this.position.worldPosition, detonationZone, collisionType, this.target, {
                    player: this.fromPlayer,
                    weapon: weapon,
                    obj: this.fromObject,
                }, this.isShrapnel, this.impactAnim, undefined, false, (object: any) => {
                    if (!isAresActiveFirestormWall(object, this.fromPlayer)) return true;
                    const coefficient = game.rules.general.damageToFirestormDamageCoefficient ?? 1;
                    applyAresFirestormWallDamage(
                        object,
                        warhead.computeDamage(damage, object, game),
                        coefficient,
                    );
                    return false;
                });
            }
        }
        if (warhead.rules.nukeMaker) {
            let nukeProjectile: Projectile;
            if (this.fromObject) {
                const nukeWeapon = Weapon.factory(Weapon.NUKE_PAYLOAD_NAME, WeaponType.Primary, this.fromObject, game.rules);
                nukeProjectile = game.createProjectile(nukeWeapon.projectileRules.name, this.fromObject, nukeWeapon, this.target, false);
            }
            else {
                nukeProjectile = game.createLooseProjectile(Weapon.NUKE_PAYLOAD_NAME, this.fromPlayer, this.target);
            }
            nukeProjectile.isNuke = true;
            nukeProjectile.impactAnim = "NUKEBALL";
            const nukeTile = this.target.tile;
            nukeProjectile.position.moveToTileCoords(nukeTile.rx + 0.5, nukeTile.ry + 0.5);
            nukeProjectile.position.tileElevation = this.position.tileElevation;
            game.spawnObject(nukeProjectile, nukeTile);
        }
        if (this.rules.shrapnelCount &&
            this.rules.shrapnelWeapon &&
            ((this.target.obj
                ? !this.target.obj.isBuilding()
                : game.map
                    .getGroundObjectsOnTile(this.target.tile)
                    .some((obj: any) => obj.isTerrain()) &&
                    !weapon.projectileRules.isAntiAir) ||
                this.isShrapnel)) {
            const shrapnelWeapon = game.rules.getWeapon(this.rules.shrapnelWeapon);
            const shrapnelProjectile = game.rules.getProjectile(shrapnelWeapon.projectile);
            let shrapnelCount = this.rules.shrapnelCount;
            const rangeHelper = new RangeHelper(game.map.tileOccupation);
            const tileFinder = new RadialTileFinder(game.map.tiles, game.map.mapBounds, detonationTile, { width: 1, height: 1 }, 1, shrapnelWeapon.range, (tile: any) => rangeHelper.isInTileRange(detonationTile, tile, shrapnelWeapon.minimumRange, shrapnelWeapon.range));
            const shrapnelTargets = new Set<any>();
            while (Math.floor(shrapnelCount) > 0) {
                const tile = tileFinder.getNextTile();
                if (!tile)
                    break;
                const objects = game.map.tileOccupation
                    .getObjectsOnTileByLayer(tile, shrapnelProjectile.isAntiAir ? LayerType.Air : LayerType.Ground)
                    .filter((obj: any) => game.isValidTarget(obj) &&
                    (obj.isTerrain() ||
                        (obj.isTechno() &&
                            obj.owner !== this.fromPlayer &&
                            !game.alliances.areAllied(obj.owner, this.fromPlayer) &&
                            !(obj.isInfantry() && obj.stance === StanceType.Paradrop))));
                for (const obj of objects) {
                    if (!shrapnelTargets.has(obj)) {
                        shrapnelTargets.add(obj);
                        shrapnelCount = Math.max(0, shrapnelCount - 1 - (obj.isTechno() ? 0.5 : 0));
                        if (Math.floor(shrapnelCount) <= 0)
                            break;
                    }
                }
            }
            for (const target of shrapnelTargets) {
                const shrapnelTarget = game.createTarget(target.isTerrain() ? undefined : target, target.tile);
                this.createShrapnel(game, shrapnelTarget, shrapnelWeapon.name);
            }
            shrapnelCount = Math.floor(shrapnelCount);
            const randomTileFinder = new RandomTileFinder(game.map.tiles, game.map.mapBounds, detonationTile, shrapnelWeapon.range, game, (tile: any) => rangeHelper.isInTileRange(detonationTile, tile, shrapnelWeapon.minimumRange, shrapnelWeapon.range));
            for (let i = 0; i < shrapnelCount; i++) {
                const tile = randomTileFinder.getNextTile();
                if (!tile)
                    break;
                const target = game.createTarget(undefined, tile);
                this.createShrapnel(game, target, shrapnelWeapon.name);
            }
        }
        if (weapon.rules.limboLaunch && !parasiteSuccess && this.fromObject?.isUnit()) {
            const unit = this.fromObject;
            if (warhead.rules.parasite &&
                (this.target.obj.isVehicle() || this.target.obj?.isAircraft()) &&
                this.target.obj.parasiteableTrait) {
                this.target.obj.parasiteableTrait.beingBoarded = false;
            }
            let returnTile: any;
            let onBridge: boolean;
            const isAircraft = unit.rules.movementZone === MovementZone.Fly;
            if (isAircraft) {
                returnTile = detonationTile;
                onBridge = false;
            }
            else {
                const targetBridge = this.target.obj.isUnit() &&
                    this.target.obj.tile.onBridgeLandType &&
                    !this.target.obj.onBridge
                    ? undefined
                    : game.map.tileOccupation.getBridgeOnTile(detonationTile);
                const moveHelper = new MovePositionHelper(game.map);
                const returnTileFinder = new RadialTileFinder(game.map.tiles, game.map.mapBounds, detonationTile, { width: 1, height: 1 }, 0, 1, (tile: any) => {
                    const tileBridge = game.map.tileOccupation.getBridgeOnTile(tile);
                    return (game.map.terrain.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), !!tileBridge) > 0 &&
                        moveHelper.isEligibleTile(tile, tileBridge, targetBridge, detonationTile) &&
                        (tile === detonationTile ||
                            !game.map.terrain.findObstacles({ tile: tile, onBridge: targetBridge }, unit).length));
                });
                returnTile = returnTileFinder.getNextTile();
                onBridge = !!returnTile?.onBridgeLandType;
            }
            if (returnTile) {
                if (!isAircraft && this.target.obj.isUnit()) {
                    unit.onBridge = onBridge;
                    unit.position.tileElevation = onBridge
                        ? (game.map.tileOccupation.getBridgeOnTile(returnTile)?.tileElevation ?? 0)
                        : 0;
                }
                game.unlimboObject(unit, returnTile);
                if (unit.isInfantry()) {
                    unit.position.subCell = this.target.obj.position.subCell;
                }
                unit.direction = this.direction;
            }
            else {
                unit.owner.removeOwnedObject(unit);
            }
        }
    }
    private createShrapnel(game: any, target: any, weaponName: string): void {
        const shrapnel = game.createLooseProjectile(weaponName, this.fromPlayer, target);
        shrapnel.isShrapnel = true;
        shrapnel.veteranDamageMult = this.veteranDamageMult;
        shrapnel.position.moveToLeptons(this.position.getMapPosition());
        shrapnel.position.tileElevation = this.position.tileElevation;
        game.spawnObject(shrapnel, shrapnel.position.tile);
    }

    private spawnAresProjectileChildren(game: any, detonationTile: any): void {
        const rules = this.rules;
        const airburstWeaponName = rules.airburstWeapon;
        if (!airburstWeaponName) return;

        const airburstWeaponRules = game.rules.getWeapon(airburstWeaponName);
        const airburstProjectileRules = game.rules.getProjectile(airburstWeaponRules.projectile);
        const aroundTarget = rules.aroundTarget ?? rules.splits;
        const anchorTile = aroundTarget ? (this.target?.tile ?? detonationTile) : detonationTile;
        if (!anchorTile) return;

        if (!rules.splits) {
            for (const offset of getAresAirburstCellOffsets(rules.airburstSpread)) {
                const tile = game.map.tiles.getByMapCoords(anchorTile.rx + offset.x, anchorTile.ry + offset.y);
                if (tile) {
                    this.createAresProjectileChild(game, airburstWeaponName, game.createTarget(undefined, tile));
                }
            }
            return;
        }

        const targetPool = this.collectAresSplitTargets(
            game,
            airburstProjectileRules,
            airburstWeaponRules.warhead,
            aroundTarget && this.target
                ? this.target.getWorldCoords()
                : this.position.worldPosition,
            anchorTile,
        );
        const cluster = Math.max(0, rules.cluster);
        const targetRadius = 3;
        let randomFillAttempts = 0;
        while (targetPool.length < cluster && randomFillAttempts++ < cluster * 16 + 16) {
            const tile = game.map.tiles.getByMapCoords(
                anchorTile.rx + game.generateRandomInt(-targetRadius, targetRadius),
                anchorTile.ry + game.generateRandomInt(-targetRadius, targetRadius),
            );
            if (tile) targetPool.push(game.createTarget(undefined, tile));
        }
        while (targetPool.length < cluster) {
            targetPool.push(game.createTarget(undefined, anchorTile));
        }

        for (let i = 0; i < cluster; i++) {
            let target = this.target;
            if (shouldRetargetAresSplit(!!target, rules.retargetAccuracy, game.generateRandom())) {
                const index = chooseAresSplitTargetIndex(targetPool.length, game.generateRandom());
                if (index >= 0) {
                    target = targetPool.splice(index, 1)[0];
                    // Antares gives a self-selected target one deterministic
                    // re-roll opportunity instead of making RetargetSelf a
                    // hard exclusion from the random cell pool.
                    if (target?.obj === this.fromObject && game.generateRandom() > 0.5 && targetPool.length) {
                        const retryIndex = chooseAresSplitTargetIndex(targetPool.length, game.generateRandom());
                        target = targetPool.splice(retryIndex, 1)[0];
                    }
                }
            }
            if (target) {
                this.createAresProjectileChild(game, airburstWeaponName, target);
            }
        }
    }

    private collectAresSplitTargets(
        game: any,
        airburstProjectileRules: any,
        airburstWarheadName: string,
        anchor: any,
        anchorTile: any,
    ): any[] {
        const warhead = new Warhead(game.rules.getWarhead(airburstWarheadName));
        const range = 5;
        const candidates = sortAresSplitCandidates(game.map.technosByTile?.queryRange?.(
            new Box2(
                new Vector2(anchorTile.rx - range, anchorTile.ry - range),
                new Vector2(anchorTile.rx + range + 1, anchorTile.ry + range + 1),
            ),
        ) ?? []);
        const rangeHelper = new RangeHelper(this.tileOccupation);
        const sourceOwner = this.fromPlayer;
        const source = this.fromObject ?? { owner: sourceOwner };
        const targets: any[] = [];

        for (const object of candidates) {
            if (!object?.isSpawned || object.isDestroyed || object.isCrashing || object.healthTrait?.health <= 0) continue;
            if (!this.rules.retargetSelf && object === this.fromObject) continue;
            if (!airburstProjectileRules.isAntiAir && object.isUnit?.() && object.zone === ZoneType.Air) continue;

            const objectZone = object.zone ?? game.map.getTileZone(object.tile);
            if (!warhead.canDamage(object, object.tile, objectZone)) continue;
            if (sourceOwner && object.owner) {
                const friendly = object.owner === sourceOwner || game.alliances.areAllied(object.owner, sourceOwner);
                if ((friendly && warhead.rules.affectsAllies === false) ||
                    (!friendly && warhead.rules.affectsEnemies === false)) continue;
            }
            if (rangeHelper.distance3(anchor, object) / Coords.LEPTONS_PER_TILE >= range) continue;
            targets.push(game.createTarget(object, object.tile));
        }
        return targets;
    }

    private createAresProjectileChild(game: any, weaponName: string, target: any): void {
        let child: any;
        if (this.fromObject) {
            const weapon = Weapon.factory(weaponName, WeaponType.Primary, this.fromObject, game.rules);
            child = game.createProjectile(weapon.projectileRules.name, this.fromObject, weapon, target, false);
        }
        else {
            child = game.createLooseProjectile(weaponName, this.fromPlayer, target);
        }
        child.position.moveToLeptons(this.position.getMapPosition());
        child.position.tileElevation = this.position.tileElevation;
        child.direction = game.generateRandomInt(0, 359);
        game.spawnObject(child, child.position.tile);
    }
    private computeAimPointVersusMovingTarget(target: any, projectileSpeed: number, projectilePos: Vector3, map: any): Vector3 {
        const targetPos = target.position.worldPosition;
        const aimPoint = targetPos.clone();
        const targetSpeed = target.moveTrait.velocity.length();
        if (projectileSpeed < 3 * targetSpeed) {
            return targetPos.clone();
        }
        const interceptPoint = TargetUtil.computeInterceptPoint(projectilePos, projectileSpeed, targetPos, target.moveTrait.velocity);
        if (interceptPoint.length()) {
            const toIntercept = interceptPoint.clone().sub(targetPos);
            const distance = toIntercept.length();
            const travelTime = targetSpeed ? Math.ceil(distance / targetSpeed) : 0;
            const finalIntercept = targetPos.clone().add(toIntercept.setLength(travelTime * targetSpeed));
            if (map.isWithinHardBounds(finalIntercept)) {
                if (target.zone !== ZoneType.Air) {
                    finalIntercept.multiplyScalar(1 / Coords.LEPTONS_PER_TILE);
                    const pos = target.position.clone();
                    pos.moveToTileCoords(finalIntercept.x, finalIntercept.z);
                    return pos.worldPosition;
                }
                else {
                    return finalIntercept;
                }
            }
            else {
                return targetPos;
            }
        }
        return aimPoint.clone();
    }
}
