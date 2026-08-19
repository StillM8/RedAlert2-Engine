import { DeathType } from "@/game/gameobject/common/DeathType";
import { StanceType } from "@/game/gameobject/infantry/StanceType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { CallbackTask } from "@/game/gameobject/task/system/CallbackTask";
import { ScatterTask } from "@/game/gameobject/task/ScatterTask";
import { BridgeOverlayTypes, OverlayBridgeType } from "@/game/map/BridgeOverlayTypes";
import { NotifyAttack } from "@/game/trait/interface/NotifyAttack";
import { ArmorType } from "@/game/type/ArmorType";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { RangeHelper } from "@/game/gameobject/unit/RangeHelper";
import { RadialTileFinder } from "@/game/map/tileFinder/RadialTileFinder";
import { Coords } from "@/game/Coords";
import * as MathUtils from "@/util/math";
import { FacingUtil } from "@/game/gameobject/unit/FacingUtil";
import { ObjectType } from "@/engine/type/ObjectType";
import { WarheadDetonateEvent } from "@/game/event/WarheadDetonateEvent";
import { WeaponType } from "@/game/WeaponType";
import { WeaponRules } from "@/game/rules/WeaponRules";
import { IniSection } from "@/data/IniSection";
import { ProjectileRules } from "@/game/rules/ProjectileRules";
import { AnimTerrainEffect } from "@/game/gameobject/common/AnimTerrainEffect";
import { ObjectAttackedEvent } from "@/game/event/ObjectAttackedEvent";
import { aresEmpThresholdExceeded, isAresEmpTypeImmune } from "@/extensions/ares/AresEMP";
import { applyAresKillDriver } from "@/extensions/ares/AresKillingDrivers";
import {
    resolveAresAttachEffectCombat,
    type AresAttachEffectAggregateInput,
} from "@/extensions/ares/AresAttachEffectCombat";
import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import type { AresAttachEffectApplyResult } from "@/extensions/ares/AresAttachEffectRuntime";
import { resolveAresLightningRodDamage } from "@/extensions/ares/AresLightningRods";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import { CloakableTrait } from "@/game/gameobject/trait/CloakableTrait";
import { applyAresChronoPrison } from "@/extensions/ares/AresChronoPrisonIntegration";
interface GameObject {
    isSpawned: boolean;
    isDisposed: boolean;
    isDestroyed: boolean;
    isCrashing: boolean;
    healthTrait?: HealthTrait;
    rules: GameObjectRules;
    position: Position;
    direction: number;
    owner: Player;
    name: string;
    zone?: ZoneType;
    overlayId?: number;
    tileElevation: number;
    onBridge?: boolean;
    isTechno(): boolean;
    isUnit(): boolean;
    isBuilding(): boolean;
    isInfantry(): boolean;
    isAircraft(): boolean;
    isVehicle(): boolean;
    isOverlay(): boolean;
    isTerrain(): boolean;
    isBridge(): boolean;
    onAttack(source: GameObject, weaponInfo?: WeaponInfo): void;
    applyRocking(direction: number, intensity: number): void;
    getBridge?(): GameObject;
}
interface TechnoObject extends GameObject {
    warpedOutTrait: WarpedOutTrait;
    invulnerableTrait: InvulnerableTrait;
    cloakableTrait?: CloakableTrait;
    veteranTrait?: VeteranTrait;
    aresAttachEffectTrait?: {
        getAggregateMultipliers(): AresAttachEffectAggregateInput;
        apply(
            effectId: string,
            definition: AresAttachEffectDefinition,
            options?: {
                protectedByIronCurtainOrForceShield?: boolean;
                context?: GameWorld;
                sourcePlayer?: Player;
            },
        ): AresAttachEffectApplyResult;
    };
    traits?: { add(trait: unknown): void };
    addTrait?(trait: unknown): void;
    moveTrait: MoveTrait;
    unitOrderTrait: UnitOrderTrait;
    suppressionTrait?: SuppressionTrait;
    missileSpawnTrait?: MissileSpawnTrait;
    crashableTrait?: CrashableTrait;
    submergibleTrait?: SubmergibleTrait;
    delayedKillTrait?: DelayedKillTrait;
    transportTrait?: {
        units: GameObject[];
        getMaxCapacity(): number;
        getOccupiedCapacity(): number;
    };
    empTrait?: {
        isUnderEMP(): boolean;
        getRemainingFrames?(): number;
        apply(duration: number, cap: number, modifier?: number): boolean;
    };
}
interface UnitObject extends TechnoObject {
    crateBonuses: CrateBonuses;
}
interface InfantryObject extends UnitObject {
    stance: StanceType;
    isPanicked: boolean;
    infDeathType: DeathType;
}
interface HealthTrait {
    health: number;
    getHitPoints(): number;
    inflictDamage(amount: number, weaponInfo?: WeaponInfo, gameWorld?: GameWorld): void;
    healBy(amount: number, healer: GameObject, gameWorld: GameWorld): void;
}
interface GameObjectRules {
    armor: ArmorType;
    warpable: boolean;
    immune: boolean;
    immuneToRadiation: boolean;
    immuneToPsionics: boolean;
    invisibleInGame: boolean;
    fraidycat: boolean;
    insignificant: boolean;
    typeImmune: boolean;
    immuneToEMP?: boolean;
    empModifier?: number;
    empThreshold?: number;
    wall: boolean;
    lightningRod?: boolean;
    lightningRodModifier?: number;
}
interface WarheadRules {
    aresAttachEffect?: AresAttachEffectDefinition;
    temporal: boolean;
    radiation: boolean;
    psychicDamage: boolean;
    proneDamage: number;
    killDriver: boolean;
    killDriverBelowPercent: number;
    killDriverChance: number;
    killDriverOwner: string;
    killDriverRemoveVeterancy: boolean;
    verses: Map<ArmorType, number>;
    wallAbsoluteDestroyer: boolean;
    wall: boolean;
    wood: boolean;
    infDeath: DeathType;
    affectsAllies: boolean;
    affectsEnemies?: boolean;
    affectsOwner?: boolean;
    allowZeroDamage?: boolean;
    malicious?: boolean;
    preventScatter?: boolean;
    effectsRequireDamage: boolean;
    effectsRequireVerses: boolean;
    causesDelayKill: boolean;
    delayKillAtMax: number;
    delayKillFrames: number;
    rocker: boolean;
    conventional: boolean;
    emEffect: boolean;
    empDuration: number;
    empCap: number;
    animList: string[];
    name: string;
    cellSpread: number;
    percentAtMax: number;
    radLevel: number;
}
interface WeaponInfo {
    minRange: number;
    range: number;
    speed: number;
    type: WeaponType;
    rules: WeaponRules;
    projectileRules: ProjectileRules;
    warhead: Warhead;
    weapon?: WeaponRules;
    obj?: GameObject;
    player?: Player;
}
interface GameWorld {
    map: GameMap;
    alliances: AllianceManager;
    traits: TraitContainer;
    events: EventDispatcher;
    rules: GameRules;
    gameOpts: GameOptions;
    mapRadiationTrait: MapRadiationTrait;
    destroyObject(obj: GameObject, source?: WeaponInfo, cause?: any, isDirectHit?: boolean): void;
    generateRandomInt(min: number, max: number): number;
    generateRandom?(): number;
    changeObjectOwner?(obj: GameObject, newOwner: Player): void;
    limboObject(obj: GameObject, limboData: { selected: boolean; controlGroup?: number; inTransport: boolean }): void;
    getUnitSelection?(): {
        isSelected?(obj: GameObject): boolean;
        getOrCreateSelectionModel?(obj: GameObject): { getControlGroupNumber?(): number | undefined };
    };
    getCivilianPlayer?(): Player | undefined;
    getAllPlayers?(): Player[];
    areAllied?(player1: Player, player2: Player): boolean;
    unlimboObject?(obj: GameObject, tile: Position, skipSelection?: boolean): void;
    addObjectTrait?(obj: GameObject, trait: unknown): void;
}
interface GameMap {
    tiles: Tile[][];
    mapBounds: Rectangle;
    tileOccupation: TileOccupation;
    getObjectsOnTile(tile: Position): GameObject[];
}
interface Player {
    isCombatant(): boolean;
}
interface Position {
    getMapPosition(): Vector3;
    clone(): Position;
    sub(other: Vector3): Position;
}
interface Vector3 {
    x: number;
    y: number;
    z: number;
}
interface Rectangle {
    width: number;
    height: number;
}
interface WarpedOutTrait {
    isInvulnerable(): boolean;
}
interface InvulnerableTrait {
    isActive(): boolean;
}
interface VeteranTrait {
    getVeteranArmorMultiplier(): number;
}
interface MoveTrait {
    reservedPathNodes: PathNode[];
    isIdle(): boolean;
}
interface PathNode {
    tile: Position;
}
interface UnitOrderTrait {
    hasTasks(): boolean;
    addTask(task: any): void;
}
interface SuppressionTrait {
    isSuppressed(): boolean;
    suppress(): void;
}
interface MissileSpawnTrait {
}
interface CrashableTrait {
    crash(source?: WeaponInfo): void;
}
interface SubmergibleTrait {
}
interface DelayedKillTrait {
    isActive(): boolean;
    activate(frames: number, weaponInfo: WeaponInfo): void;
}
interface CrateBonuses {
    armor: number;
}
interface TraitContainer {
    filter(trait: any): any[];
}
interface EventDispatcher {
    dispatch(event: any): void;
}
interface GameRules {
    general: { cloakDelay: number };
    audioVisual: AudioVisualRules;
    combatDamage: CombatDamageRules;
}
interface AudioVisualRules {
    weaponNullifyAnim: string;
    weatherConBoltExplosion: string;
}
interface CombatDamageRules {
    splashList: string[];
    c4Warhead: string;
}
interface GameOptions {
    destroyableBridges: boolean;
}
interface MapRadiationTrait {
    createRadSite(position: Position, level: number, radius: number): void;
}
interface AllianceManager {
    areAllied(player1: Player, player2: Player): boolean;
}
interface Tile {
}
interface TileOccupation {
}
export class Warhead {
    static readonly SPECIAL_WARHEAD_NAME = "Special";
    static readonly HE_WARHEAD_NAME = "HE";
    constructor(public rules: WarheadRules) { }
    canDamage(obj: GameObject, tile: Position, zone: ZoneType): boolean {
        if (!obj.isSpawned || obj.isDisposed || obj.isDestroyed || obj.isCrashing) {
            return false;
        }
        if (obj.isTechno() && (obj as TechnoObject).warpedOutTrait.isInvulnerable() && !this.rules.temporal) {
            return false;
        }
        if (obj.isUnit()) {
            const unitObj = obj as UnitObject;
            if (unitObj.moveTrait.reservedPathNodes.find(node => node.tile === tile)) {
                return false;
            }
        }
        if (!obj.healthTrait) {
            return false;
        }
        if (obj.isUnit() && obj.zone === ZoneType.Air && zone !== ZoneType.Air) {
            return false;
        }
        if (!obj.isUnit() && zone === ZoneType.Air) {
            return false;
        }
        if (obj.isBuilding() && obj.rules.invisibleInGame) {
            return false;
        }
        if ((obj.isTechno() || obj.isTerrain()) && obj.rules.immune && !this.rules.temporal) {
            return false;
        }
        if (obj.isTechno() && !obj.rules.warpable && this.rules.temporal) {
            return false;
        }
        if (this.rules.radiation && (!obj.isUnit() || obj.rules.immuneToRadiation)) {
            return false;
        }
        if (this.rules.psychicDamage && !obj.isInfantry()) {
            return false;
        }
        if (obj.isOverlay() && BridgeOverlayTypes.isLowBridgeHead(obj.overlayId!)) {
            return false;
        }
        return true;
    }
    computeDamage(baseDamage: number, target: GameObject, gameWorld: GameWorld, isWeatherStorm = false, ignoreLightningRod = false): number {
        let damage = baseDamage;
        if (damage > 0 && target.isTechno() && (target as TechnoObject).invulnerableTrait.isActive()) {
            return 0;
        }
        if (target.isAircraft()) {
            const aircraft = target as TechnoObject;
            if (aircraft.missileSpawnTrait && target.zone !== ZoneType.Air) {
                return 0;
            }
        }
        if (!gameWorld.gameOpts.destroyableBridges && target.isOverlay() && target.isBridge()) {
            return 0;
        }
        if (!this.rules.radiation && !this.rules.temporal && target.isInfantry()) {
            const infantry = target as InfantryObject;
            if (infantry.stance === StanceType.Prone) {
                damage *= this.rules.proneDamage;
            }
        }
        if (target.isTechno() || target.isOverlay() || target.isTerrain()) {
            let armorType = target.isTerrain() ? ArmorType.Wood : target.rules.armor;
            if (target.isOverlay() && target.isBridge()) {
                const bridgeType = BridgeOverlayTypes.getOverlayBridgeType(target.overlayId!);
                if (bridgeType === OverlayBridgeType.Wood) {
                    armorType = ArmorType.Wood;
                }
                else if (bridgeType === OverlayBridgeType.Concrete) {
                    armorType = ArmorType.Concrete;
                }
            }
            if (!(isWeatherStorm && target.isOverlay() && (target.isBridge() || target.rules.wall))) {
                damage *= this.rules.verses.get(armorType) ?? 1;
            }
            if (damage > 0 && target.isTechno()) {
                const techno = target as TechnoObject;
                if (techno.veteranTrait) {
                    damage /= techno.veteranTrait.getVeteranArmorMultiplier();
                }
                damage /= resolveAresAttachEffectCombat(
                    { armor: 1 },
                    techno.aresAttachEffectTrait?.getAggregateMultipliers(),
                ).effective.armor;
            }
            if (damage > 0 && target.isUnit()) {
                const unit = target as UnitObject;
                damage /= unit.crateBonuses.armor;
            }
        }
        if ((target.isOverlay() || target.isBuilding()) && target.rules.wall) {
            if (this.rules.wallAbsoluteDestroyer) {
                damage = Number.POSITIVE_INFINITY;
            }
            else if (!this.rules.wall && !(this.rules.wood && target.rules.armor === ArmorType.Wood)) {
                damage = 0;
            }
        }
        if (target.isOverlay() && target.isBridge() && !this.rules.wall) {
            damage = 0;
        }
        damage = resolveAresLightningRodDamage(damage, target, isWeatherStorm, ignoreLightningRod);
        return damage > 0 ? Math.floor(damage) : Math.ceil(damage);
    }
    inflictDamage(damage: number, target: GameObject, weaponInfo: WeaponInfo | undefined, gameWorld: GameWorld, isDirectHit = false): boolean {
        // A projectile/effect can retain a target reference after another
        // impact in the same simulation tick has removed that object.  The
        // retail engine treats that as a stale hit, not as a second death.
        // Keep direct callers safe as well as the normal canDamage path.
        if (target.isDestroyed || target.isDisposed || target.isCrashing || !target.healthTrait) {
            return false;
        }
        const healthTrait = target.healthTrait;
        if (damage === Number.POSITIVE_INFINITY) {
            damage = healthTrait.getHitPoints();
        }
        healthTrait.inflictDamage(damage, weaponInfo, gameWorld);
        gameWorld.traits.filter(NotifyAttack).forEach((trait: any) => {
            trait[NotifyAttack.onAttack](target, weaponInfo?.obj, gameWorld, this.rules);
        });
        target.onAttack(gameWorld as any, weaponInfo);
        gameWorld.events.dispatch(new ObjectAttackedEvent(target, weaponInfo, isDirectHit));
        if (target.isTechno() && !this.rules.temporal && !this.rules.preventScatter) {
            this.suppressOrScatterTarget(target as TechnoObject, gameWorld);
        }
        if (!healthTrait.health) {
            if (target.isInfantry()) {
                (target as InfantryObject).infDeathType = this.rules.infDeath;
            }
            if (this.rules.temporal) {
                (target as any).deathType = DeathType.Temporal;
            }
            if (target.isUnit() && (target as TechnoObject).crashableTrait && target.zone === ZoneType.Air && !this.rules.temporal) {
                (target as TechnoObject).crashableTrait!.crash(weaponInfo);
            }
            else {
                gameWorld.destroyObject(target, weaponInfo, undefined, isDirectHit);
            }
            return true;
        }
        return false;
    }
    private suppressOrScatterTarget(target: TechnoObject, gameWorld: GameWorld): void {
        if (target.rules.fraidycat || (target.isVehicle() && !target.owner.isCombatant() && target.rules.insignificant)) {
            if (!target.unitOrderTrait.hasTasks()) {
                if (target.isInfantry()) {
                    (target as InfantryObject).isPanicked = true;
                }
                target.unitOrderTrait.addTask(new ScatterTask(gameWorld, undefined as any, undefined as any));
                if (target.isInfantry()) {
                    target.unitOrderTrait.addTask(new CallbackTask(() => (target as InfantryObject).isPanicked = false).setCancellable(false));
                }
            }
        }
        else if (target.isInfantry()) {
            const infantry = target as InfantryObject;
            if ((infantry.moveTrait.isIdle() || infantry.suppressionTrait?.isSuppressed()) && infantry.suppressionTrait) {
                infantry.suppressionTrait.suppress();
            }
        }
    }
    createDummyWeaponInfo(): WeaponInfo {
        return {
            minRange: 0,
            range: 0,
            speed: Number.POSITIVE_INFINITY,
            type: WeaponType.Primary,
            rules: new WeaponRules(new IniSection("Dummy")),
            projectileRules: new ProjectileRules(ObjectType.Projectile, new IniSection("Dummy")),
            warhead: this
        };
    }
    detonate(gameWorld: GameWorld, baseDamage: number, centerTile: Position, elevation: number, centerCoords: Vector3, zone: ZoneType, collisionType: CollisionType | undefined, target: {
        obj?: GameObject;
        getBridge?(): GameObject;
    }, weaponInfo: WeaponInfo | undefined, friendly: boolean, areaEffectSmudge: string | undefined, customSpread?: number, isWeatherStorm = false, targetFilter?: (object: GameObject, tile: Position) => boolean, areaDetonation = false): void {
        const weapon = weaponInfo?.weapon ?? this.createDummyWeaponInfo() as any;
        const sourceObj = weaponInfo?.obj;
        const sourcePlayer = weaponInfo?.player;
        const cellSpread = customSpread ? customSpread / Coords.LEPTONS_PER_TILE : this.rules.cellSpread;
        const percentAtMax = this.rules.percentAtMax;
        const processedObjects = new Set<GameObject>();
        const objectDistances = new Map<GameObject, number[]>();
        const rangeHelper = new RangeHelper(gameWorld.map.tileOccupation as any);
        const tileFinder = new RadialTileFinder(gameWorld.map.tiles as any, gameWorld.map.mapBounds as any, centerTile as any, { width: 1, height: 1 }, 0, Math.ceil(cellSpread), () => true);
        let currentTile: any;
        while ((currentTile = tileFinder.getNextTile())) {
            for (const obj of gameWorld.map.getObjectsOnTile(currentTile)) {
                if (processedObjects.has(obj) && !obj.isBuilding())
                    continue;
                if (targetFilter && !targetFilter(obj, currentTile))
                    continue;
                if (collisionType === CollisionType.UnderBridge && obj.isUnit() && (obj as UnitObject).onBridge)
                    continue;
                if (sourceObj && obj.isTechno() && obj.rules.typeImmune && obj.owner === sourcePlayer && obj.name === sourceObj.name)
                    continue;
                if (!this.canDamage(obj, currentTile, zone))
                    continue;
                if (obj.isOverlay()) {
                    if ((!collisionType && Math.abs(obj.tileElevation - elevation) > 0.1) ||
                        (collisionType === CollisionType.OnBridge && !obj.isBridge())) {
                        continue;
                    }
                }
                let distance: number;
                if (obj.isBuilding()) {
                    distance = currentTile === centerTile ? 0 : rangeHelper.distance3(currentTile as any, centerCoords) / Coords.LEPTONS_PER_TILE;
                }
                else if (obj.isTerrain() || obj.isOverlay()) {
                    distance = rangeHelper.distance3(currentTile as any, centerTile as any) / Coords.LEPTONS_PER_TILE;
                }
                else {
                    distance = rangeHelper.distance3(obj as any, centerCoords) / Coords.LEPTONS_PER_TILE;
                }
                if (distance < 0.001)
                    distance = 0;
                if (friendly && obj.isInfantry() && sourcePlayer) {
                    if (obj.owner === sourcePlayer || gameWorld.alliances.areAllied(obj.owner, sourcePlayer)) {
                        continue;
                    }
                }
                if (!cellSpread) {
                    if (obj.isTerrain()) {
                        if (currentTile !== centerTile || !this.rules.wall)
                            continue;
                    }
                    else if (!friendly && (currentTile !== centerTile || (!areaDetonation && !obj.isBuilding() && obj !== (target.obj || target.getBridge?.())))) {
                        continue;
                    }
                }
                if (cellSpread && distance > cellSpread)
                    continue;
                processedObjects.add(obj);
                const distances = obj.isBuilding() ? (objectDistances.get(obj) || []).concat(distance) : [distance];
                objectDistances.set(obj, distances);
            }
        }
        let hasInvulnerableHit = false;
        let directHitTarget: GameObject | undefined;
        for (const obj of processedObjects) {
            if (obj.isDestroyed || obj.isCrashing)
                continue;
            let damage = this.computeDamage(
                baseDamage, obj, gameWorld, isWeatherStorm,
                (weaponInfo as any)?.aresIgnoreLightningRod === true,
            );
            if (baseDamage > 0 && obj.isTechno() && sourcePlayer) {
                const isOwner = obj.owner === sourcePlayer;
                const isFriendly = gameWorld.alliances.areAllied(obj.owner, sourcePlayer) || isOwner;
                if ((isFriendly && !this.rules.affectsAllies) ||
                    (isOwner && !this.rules.affectsOwner) ||
                    (!isFriendly && this.rules.affectsEnemies === false)) {
                    damage = 0;
                }
            }
            const verses = obj.isTechno() ? (this.rules.verses.get(obj.rules.armor) ?? 1) : 1;
            const aresEffectsAllowed = (!this.rules.effectsRequireVerses || verses !== 0) &&
                (!this.rules.effectsRequireDamage || damage > 0);
            if (aresEffectsAllowed && sourceObj && sourceObj !== obj && obj.isUnit() &&
                (sourceObj as TechnoObject).transportTrait) {
                const chronoDecision = applyAresChronoPrison(
                    sourceObj,
                    obj,
                    weapon,
                    gameWorld as any,
                    {
                        warheadIsTemporal: this.rules.temporal,
                        warheadCanAffect: true,
                    },
                );
                if (chronoDecision.eligible) {
                    if (obj === target.obj) {
                        directHitTarget = obj;
                    }
                    continue;
                }
                // Temporal abductors are completed by TemporalTrait at the
                // erase point; they must not fall through to conventional
                // detonation while waiting for that lifecycle.
                if (chronoDecision.waitForTemporalErasure) {
                    continue;
                }
            }
            const empApplied = this.applyEmp(obj, weaponInfo, gameWorld);
            if (empApplied && obj.isTechno() && !obj.isAircraft() &&
                obj.rules.empThreshold !== undefined &&
                aresEmpThresholdExceeded(
                    obj.rules.empThreshold,
                    (obj as TechnoObject).empTrait?.getRemainingFrames?.() ?? 0,
                    obj.zone === ZoneType.Air,
                    !!(obj as any).isParachuting?.() || !!(obj as any).parachuting,
                )) {
                gameWorld.destroyObject(obj, weaponInfo);
                continue;
            }
            const attachEffectApplied = this.applyAresAttachEffect(obj, gameWorld, sourcePlayer);
            const killDriverApplied = aresEffectsAllowed && this.rules.killDriver && obj.isTechno() &&
                sourceObj &&
                applyAresKillDriver(obj as any, sourceObj, gameWorld as any, {
                    killDriver: this.rules.killDriver,
                    killDriverBelowPercent: this.rules.killDriverBelowPercent,
                    killDriverChance: this.rules.killDriverChance,
                    killDriverOwner: this.rules.killDriverOwner,
                    killDriverRemoveVeterancy: this.rules.killDriverRemoveVeterancy,
                    affectsAllies: this.rules.affectsAllies,
                    affectsEnemies: this.rules.affectsEnemies,
                });
            if (killDriverApplied) {
                if (obj === target.obj) {
                    directHitTarget = obj;
                }
                continue;
            }
            // AllowZeroDamage lets a zero-damage warhead still pass through the
            // remaining damage/notification path (e.g. so Malicious=no or
            // attack notifications still apply). Without it, zero-damage hits
            // are skipped after effects have been attempted.
            if (!damage && !empApplied && !attachEffectApplied && !this.rules.allowZeroDamage)
                continue;
            for (const distance of damage ? objectDistances.get(obj)! : []) {
                let finalDamage = damage;
                if (cellSpread > 0 && Number.isFinite(finalDamage)) {
                    finalDamage = MathUtils.lerp(finalDamage, percentAtMax * finalDamage, distance / cellSpread);
                }
                if (Math.abs(finalDamage) < 1 && (!cellSpread || finalDamage / damage >= 0.25)) {
                    finalDamage = Math.sign(finalDamage);
                }
                finalDamage = finalDamage > 0 ? Math.floor(finalDamage) : Math.ceil(finalDamage);
                if (!finalDamage)
                    continue;
                const healthTrait = obj.healthTrait!;
                if (finalDamage < 0) {
                    // Target-cell effects such as Ares GenericWarhead can
                    // intentionally heal without an attacking TechnoType.
                    // HealthTrait/parasite cleanup already accepts an absent
                    // healer, so do not turn a valid area heal into a match
                    // crash merely because there is no source object.
                    healthTrait.healBy(-finalDamage, sourceObj as any, gameWorld);
                    if (healthTrait.health === 100)
                        break;
                }
                else {
                    if (obj === target.obj && distance < 1) {
                        directHitTarget = obj;
                    }
                    if (this.rules.causesDelayKill && obj.isBuilding() && (obj as any).delayedKillTrait) {
                        const currentHP = healthTrait.getHitPoints();
                        if (finalDamage >= currentHP) {
                            finalDamage = currentHP - 1;
                            const delayedKill = (obj as any).delayedKillTrait;
                            if (!delayedKill.isActive()) {
                                const maxDelay = this.rules.delayKillAtMax;
                                let delayFrames = this.rules.delayKillFrames;
                                delayFrames = MathUtils.lerp(delayFrames, maxDelay * delayFrames, distance / cellSpread);
                                delayedKill.activate(delayFrames, weaponInfo);
                            }
                        }
                    }
                    if (this.inflictDamage(finalDamage, obj, weaponInfo, gameWorld, !directHitTarget)) {
                        break;
                    }
                    if (obj.isVehicle() && this.rules.rocker) {
                        const rockIntensity = MathUtils.clamp(damage / 300, 0, 1);
                        if (rockIntensity > 0) {
                            const rockDirection = FacingUtil.fromMapCoords((obj.position.getMapPosition() as any).clone().sub(Coords.vecWorldToGround(centerCoords as any) as any) as any) - obj.direction;
                            obj.applyRocking(rockDirection, rockIntensity);
                        }
                    }
                }
            }
            if (obj.isTechno() && (obj as TechnoObject).invulnerableTrait.isActive()) {
                hasInvulnerableHit = true;
            }
        }
        const radLevel = (weapon as any).rules.radLevel;
        if (radLevel && cellSpread) {
            gameWorld.mapRadiationTrait.createRadSite(centerTile, radLevel, cellSpread + 1);
        }
        const animation = isWeatherStorm ? undefined :
            hasInvulnerableHit ? gameWorld.rules.audioVisual.weaponNullifyAnim :
                this.pickExplodeAnim(baseDamage, directHitTarget, zone, gameWorld, isWeatherStorm);
        if (!hasInvulnerableHit && zone === ZoneType.Ground) {
            const terrainEffect = new AnimTerrainEffect();
            if (animation)
                terrainEffect.destroyOre(animation, centerTile, gameWorld);
            if (areaEffectSmudge)
                terrainEffect.spawnSmudges(areaEffectSmudge, centerTile, gameWorld);
            if (animation)
                terrainEffect.spawnSmudges(animation, centerTile, gameWorld);
        }
        gameWorld.events.dispatch(new WarheadDetonateEvent(
            this,
            centerCoords,
            animation,
            isWeatherStorm,
            centerTile,
            elevation,
            zone,
            sourcePlayer,
            sourceObj,
        ));
    }

    /** Apply a Warhead-owned AttachEffect through the target's live trait. */
    private applyAresAttachEffect(
        target: GameObject,
        gameWorld: GameWorld,
        sourcePlayer?: Player,
    ): AresAttachEffectApplyResult | undefined {
        const definition = this.rules.aresAttachEffect;
        if (!definition || !target.isTechno() || target.isDestroyed || target.isCrashing) {
            return undefined;
        }

        const techno = target as TechnoObject;
        const verses = this.rules.verses.get(target.rules.armor) ?? 1;
        if (verses === 0) {
            return undefined;
        }

        // Warhead-owned AttachEffects are valid on every TechnoType.  The
        // trait is created lazily so ordinary retail units do not pay an
        // idle per-tick cost when the loaded rules contain no AttachEffect.
        if (definition.cloakable && !techno.cloakableTrait) {
            techno.cloakableTrait = new CloakableTrait(
                techno,
                gameWorld.rules.general.cloakDelay,
                false,
            );
            if (gameWorld.addObjectTrait) {
                gameWorld.addObjectTrait(techno, techno.cloakableTrait);
            }
            else if (techno.addTrait) {
                techno.addTrait(techno.cloakableTrait);
            }
            else {
                techno.traits?.add(techno.cloakableTrait);
            }
        }
        if (!techno.aresAttachEffectTrait) {
            const trait = new AresAttachEffectTrait({ gameObject: techno });
            techno.aresAttachEffectTrait = trait;
            if (gameWorld.addObjectTrait) {
                gameWorld.addObjectTrait(techno, trait);
            }
            else if (techno.addTrait) {
                techno.addTrait(trait);
            }
            else {
                techno.traits?.add(trait);
            }
        }

        const result = techno.aresAttachEffectTrait.apply(
            this.rules.name,
            definition,
            {
                protectedByIronCurtainOrForceShield: techno.invulnerableTrait.isActive(),
                context: gameWorld,
                sourcePlayer,
            },
        );
        if (result.forceDecloak) {
            (techno as any).cloakableTrait?.uncloak?.(gameWorld);
        }
        return result;
    }
    /**
     * Ares delivers EMP independently from ordinary weapon damage.  In
     * particular, a warhead may paralyze a target while its Damage/Verses
     * calculation produces zero; only a 0% Verses entry suppresses the EMP.
     */
    private applyEmp(target: GameObject, weaponInfo: WeaponInfo | undefined, gameWorld: GameWorld): boolean {
        if (!this.rules.empDuration || !target.isTechno()) {
            return false;
        }
        const techno = target as TechnoObject;
        const sourcePlayer = weaponInfo?.player ?? weaponInfo?.obj?.owner;
        if (!techno.empTrait || techno.rules.immuneToEMP || isAresEmpTypeImmune(techno, sourcePlayer)) {
            return false;
        }
        const verses = this.rules.verses.get(target.rules.armor);
        if (verses === 0) {
            return false;
        }

        if (sourcePlayer) {
            const isFriendly = target.owner === sourcePlayer || gameWorld.alliances.areAllied(target.owner, sourcePlayer);
            if ((isFriendly && !this.rules.affectsAllies) ||
                (!isFriendly && this.rules.affectsEnemies === false)) {
                return false;
            }
        }

        return techno.empTrait.apply(
            this.rules.empDuration,
            this.rules.empCap,
            techno.rules.empModifier ?? 1,
        );
    }
    private pickExplodeAnim(damage: number, directHitTarget: GameObject | undefined, zone: ZoneType, gameWorld: GameWorld, isWeatherStorm: boolean): string | undefined {
        if (!damage)
            return undefined;
        if (isWeatherStorm) {
            return gameWorld.rules.audioVisual.weatherConBoltExplosion;
        }
        if (this.rules.conventional && zone === ZoneType.Water) {
            if (!directHitTarget || directHitTarget.isBuilding() ||
                (directHitTarget.isVehicle() && (directHitTarget as TechnoObject).submergibleTrait)) {
                const splashList = gameWorld.rules.combatDamage.splashList;
                const index = MathUtils.clamp(Math.floor(damage / 50), 0, splashList.length - 1);
                return splashList[index];
            }
        }
        const animCount = this.rules.animList.length;
        if (!animCount)
            return undefined;
        let animIndex: number;
        if (gameWorld.rules.combatDamage.c4Warhead === this.rules.name) {
            animIndex = animCount - 1;
        }
        else if (this.rules.emEffect) {
            animIndex = gameWorld.generateRandomInt(0, animCount - 1);
        }
        else {
            animIndex = MathUtils.clamp(Math.floor(damage / 25), 0, animCount - 1);
        }
        return this.rules.animList[animIndex];
    }
}
