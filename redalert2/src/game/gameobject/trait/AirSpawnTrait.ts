import { Coords } from "@/game/Coords";
import { ObjectType } from "@/engine/type/ObjectType";
import { Warhead } from "@/game/Warhead";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { MoveTask } from "@/game/gameobject/task/move/MoveTask";
import { CallbackTask } from "@/game/gameobject/task/system/CallbackTask";
import { TaskGroup } from "@/game/gameobject/task/system/TaskGroup";
import { FacingUtil } from "@/game/gameobject/unit/FacingUtil";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { NotifyOwnerChange } from "@/game/gameobject/trait/interface/NotifyOwnerChange";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";
import { NotifyTeleport } from "@/game/gameobject/trait/interface/NotifyTeleport";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { NotifyUnspawn } from "@/game/gameobject/trait/interface/NotifyUnspawn";
import { NotifyWarpChange } from "@/game/gameobject/trait/interface/NotifyWarpChange";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { resolveAresCustomMissilePayload } from "@/extensions/ares/AresCustomMissiles";
interface MissileLaunch {
    missile: any;
    targetTile: any;
    targetBridge: any;
    targetWorldPos: any;
    target: any;
    warhead: Warhead;
    damage: number;
    weapon?: any;
    missileRules: any;
    pauseFrames?: number;
    takeOffAnimPlayed?: boolean;
}
export class AirSpawnTrait implements NotifyDestroy, NotifyOwnerChange, NotifySpawn, NotifyTeleport, NotifyTick, NotifyUnspawn, NotifyWarpChange {
    private spawns: any[] = [];
    private storage: any[] = [];
    private missileLaunches: MissileLaunch[] = [];
    private nextRegenTicks: number[] = [];
    private nextReloadTicks?: number;
    get availableSpawns(): number {
        return this.storage.length;
    }
    debugSetStorage(unit: any, count: number): void {
        this.storage.length = count;
        this.storage.fill(unit, 0, count);
    }
    isLaunchingMissiles(): boolean {
        return this.missileLaunches.length > 0;
    }
    /**
     * Ares crashes visible spawned aircraft when their parent spawner is
     * EMP-disabled. Stored/landed spawns remain in the manager and are
     * reloaded after the EMP outage.
     */
    onEmp(source?: any): void {
        for (const spawn of this.spawns) {
            if (spawn.isSpawned &&
                !spawn.isDestroyed &&
                !spawn.rules.missileSpawn &&
                spawn.crashableTrait?.crash) {
                spawn.crashableTrait.crash(source);
            }
        }
    }
    [NotifySpawn.onSpawn](gameObject: any, world: any): void {
        const aircraftType = world.rules.getObject(gameObject.rules.spawns, ObjectType.Aircraft);
        for (let i = 0; i < gameObject.rules.spawnsNumber; i++) {
            this.pushNewSpawn(aircraftType, world, gameObject);
        }
    }
    [NotifyUnspawn.onUnspawn](gameObject: any, world: any): void {
        this.destroySpawns(gameObject, world, undefined, undefined);
    }
    [NotifyDestroy.onDestroy](gameObject: any, world: any, damageSource: any, warhead: any): void {
        this.destroySpawns(gameObject, world, damageSource, warhead);
    }
    private getMissileRules(aircraftType: any, world: any): any {
        return aircraftType.aresCustomMissile?.custom
            ? aircraftType.aresCustomMissile
            : world.rules.general.getMissileRules(aircraftType.name);
    }
    private pushNewSpawn(aircraftType: any, world: any, parent: any): void {
        const spawn = world.createUnitForPlayer(aircraftType, parent.owner);
        spawn.limboData = { selected: false, controlGroup: undefined };
        if (aircraftType.missileSpawn) {
            spawn.pitch = 90 * this.getMissileRules(aircraftType, world).pitchInitial;
        }
        this.spawns.push(spawn);
        this.storage.push(spawn);
    }
    private destroySpawns(gameObject: any, world: any, damageSource?: any, warhead?: any): void {
        for (const spawn of this.spawns) {
            if (!spawn.isDestroyed) {
                if (spawn.isSpawned && !spawn.rules.missileSpawn && spawn.crashableTrait) {
                    spawn.crashableTrait.crash(damageSource);
                }
                else {
                    if (!spawn.isSpawned) {
                        if (spawn.armedTrait) {
                            spawn.armedTrait.deathWeapon = undefined;
                        }
                        spawn.position.tileElevation = gameObject.position.tileElevation;
                        spawn.zone = gameObject.isUnit() ? gameObject.zone : ZoneType.Ground;
                        spawn.onBridge = !!gameObject.isUnit() && gameObject.onBridge;
                        spawn.position.tile = gameObject.tile;
                    }
                    world.destroyObject(spawn, damageSource, warhead);
                }
            }
        }
        this.spawns.length = 0;
        this.storage.length = 0;
        this.missileLaunches.length = 0;
    }
    [NotifyTick.onTick](gameObject: any, world: any): void {
        this.spawns = this.spawns.filter(spawn => !spawn.isDestroyed);
        this.missileLaunches = this.missileLaunches.filter(launch => !launch.missile.isDestroyed);
        // Ares suspends spawn regeneration, reload and pending launch work
        // while the parent Techno is EMP-disabled. Visible aircraft are
        // handled when the EMP is applied; this prevents replacement work
        // during the outage.
        if (gameObject.empTrait?.isUnderEMP?.()) {
            return;
        }
        if (this.spawns.length < gameObject.rules.spawnsNumber) {
            const missingCount = gameObject.rules.spawnsNumber - this.spawns.length;
            const aircraftType = world.rules.getObject(gameObject.rules.spawns, ObjectType.Aircraft);
            for (let i = 0; i < missingCount; i++) {
                if (aircraftType.missileSpawn && i > 0 && this.nextRegenTicks[i] === undefined) {
                    this.nextRegenTicks[i] = this.nextRegenTicks[0];
                }
                else {
                    this.nextRegenTicks[i] ??= gameObject.rules.spawnRegenRate;
                    if (this.nextRegenTicks[i] > 0) {
                        this.nextRegenTicks[i]--;
                    }
                }
                if (this.nextRegenTicks[i] <= 0) {
                    this.pushNewSpawn(aircraftType, world, gameObject);
                }
            }
            this.nextRegenTicks = this.nextRegenTicks.filter(ticks => ticks > 0);
        }
        if (this.storage.length > 0) {
            this.nextReloadTicks ??= gameObject.rules.spawnReloadRate;
            if (this.nextReloadTicks > 0) {
                this.nextReloadTicks--;
            }
            if (this.nextReloadTicks <= 0) {
                for (const spawn of this.storage) {
                    if (spawn.ammoTrait && spawn.ammoTrait.ammo < spawn.ammoTrait.maxAmmo) {
                        spawn.ammoTrait.ammo++;
                    }
                }
                this.nextReloadTicks = gameObject.rules.spawnReloadRate;
            }
        }
        else {
            this.nextReloadTicks = undefined;
        }
        for (const launch of this.missileLaunches.slice()) {
            const missileRules = launch.missileRules;
            launch.pauseFrames ??= missileRules.pauseFrames;
            if (launch.pauseFrames > 0) {
                launch.pauseFrames--;
            }
            if (launch.pauseFrames <= 0) {
                const missile = launch.missile;
                if (!launch.takeOffAnimPlayed) {
                    launch.takeOffAnimPlayed = true;
                    const takeOffAnim = missile.rules.aresCustomMissile?.takeOffAnim;
                    if (takeOffAnim && missile.tile) {
                        world.events.dispatch(new TriggerAnimEvent(
                            takeOffAnim, missile.tile, undefined, missile.owner, missile,
                        ));
                    }
                }
                const finalPitch = 90 * missileRules.pitchFinal;
                const tiltFrames = Math.max(0, missileRules.tiltFrames ?? 0);
                const pitchIncrement = tiltFrames > 0
                    ? (90 * (missileRules.pitchFinal - missileRules.pitchInitial)) / tiltFrames
                    : Number.POSITIVE_INFINITY;
                if (missile.pitch < finalPitch) {
                    if ((missileRules.raiseRate ?? 0) > 0) {
                        missile.position.worldPosition.y += missileRules.raiseRate;
                    }
                    missile.pitch = tiltFrames > 0
                        ? Math.min(finalPitch, missile.pitch + pitchIncrement)
                        : finalPitch;
                }
                else {
                    missile.unitOrderTrait.addTask(new TaskGroup(new MoveTask(world, launch.targetTile, !!launch.targetBridge), new CallbackTask(() => {
                        if (!missile.isDestroyed) {
                            world.unspawnObject(missile);
                            missile.dispose();
                            const offset = Coords.vecGroundToWorld(FacingUtil.toMapCoords(missile.direction).multiplyScalar(1));
                            const detonationPos = launch.targetWorldPos.clone().add(offset);
                            const targetZone = world.map.getTileZone(launch.targetTile);
                            launch.warhead.detonate(world, launch.damage, launch.targetTile, launch.targetBridge?.tileElevation ?? 0, detonationPos, targetZone, launch.targetBridge ? CollisionType.OnBridge : CollisionType.None, launch.target, { player: missile.owner, obj: missile, weapon: launch.weapon, aresAttribution: { spawner: gameObject } } as any, false, undefined, undefined);
                        }
                    })).setCancellable(false));
                    const missileIndex = this.spawns.indexOf(missile);
                    if (missileIndex === -1) {
                        throw new Error("Missile not found in spawns list");
                    }
                    this.spawns.splice(missileIndex, 1);
                    this.missileLaunches.splice(this.missileLaunches.indexOf(launch), 1);
                }
            }
        }
    }
    [NotifyOwnerChange.onChange](gameObject: any, oldOwner: any, world: any): void {
        for (const spawn of this.spawns) {
            if (!spawn.isDestroyed) {
                world.changeObjectOwner(spawn, gameObject.owner);
            }
        }
    }
    [NotifyWarpChange.onChange](gameObject: any, world: any, isWarping: boolean): void {
        if (isWarping) {
            this.removeMissileLaunches(world);
        }
    }
    [NotifyTeleport.onBeforeTeleport](gameObject: any, world: any, targetTile: any, keepSpawns: boolean): void {
        if (!keepSpawns) {
            this.removeMissileLaunches(world);
        }
    }
    private removeMissileLaunches(world: any): void {
        if (this.missileLaunches.length > 0) {
            for (const launch of this.missileLaunches) {
                world.unspawnObject(launch.missile);
                launch.missile.dispose();
                const missileIndex = this.spawns.indexOf(launch.missile);
                if (missileIndex === -1) {
                    throw new Error("Missile not found in spawns list");
                }
                this.spawns.splice(missileIndex, 1);
            }
            this.missileLaunches.length = 0;
        }
    }
    prepareLaunch(launcher: any, target: any, world: any): any {
        if (this.storage.length > 0) {
            const spawn = this.storage[0];
            if (!spawn.ammo)
                return;
            this.storage.shift();
            if (spawn.missileSpawnTrait) {
                let warheadType: string | undefined;
                let damage: number;
                let payloadWeapon: any;
                const isElite = launcher.veteranTrait?.isElite() === true;
                const rules = world.rules;
                const customMissile = spawn.rules.aresCustomMissile?.custom
                    ? spawn.rules.aresCustomMissile
                    : undefined;
                if (customMissile) {
                    const payload = resolveAresCustomMissilePayload(customMissile, isElite);
                    damage = payload.damage;
                    warheadType = payload.warhead;
                    if (payload.weapon) {
                        payloadWeapon = rules.getWeapon(payload.weapon);
                        damage = payloadWeapon.damage;
                        warheadType = payloadWeapon.warhead;
                    }
                    if (!warheadType) {
                        throw new Error(`Custom missile "${spawn.name}" requires Missile.Warhead or Missile.Weapon`);
                    }
                }
                else if (launcher.rules.spawns === rules.general.v3Rocket.type) {
                    warheadType = isElite ? rules.combatDamage.v3EliteWarhead : rules.combatDamage.v3Warhead;
                    damage = isElite ? rules.general.v3Rocket.eliteDamage : rules.general.v3Rocket.damage;
                }
                else if (launcher.rules.spawns === rules.general.dMisl.type) {
                    warheadType = isElite ? rules.combatDamage.dMislEliteWarhead : rules.combatDamage.dMislWarhead;
                    damage = isElite ? rules.general.dMisl.eliteDamage : rules.general.dMisl.damage;
                }
                else {
                    throw new Error(`Unhandled missile type "${launcher.rules.spawns}"`);
                }
                const missileRules = this.getMissileRules(spawn.rules, world);
                const warhead = new Warhead(world.rules.getWarhead(warheadType));
                spawn.missileSpawnTrait.setDamage(damage).setWarhead(warhead).setLauncher(launcher);
                this.missileLaunches.push({
                    missile: spawn,
                    targetTile: (target.obj?.isUnit() ? target.obj : target).tile,
                    targetBridge: target.getBridge(),
                    targetWorldPos: target.getWorldCoords().clone(),
                    target: target,
                    warhead: warhead,
                    damage: damage,
                    weapon: payloadWeapon,
                    missileRules,
                    pauseFrames: undefined
                });
            }
            else {
                if (!spawn.spawnLinkTrait) {
                    throw new Error(`Aircraft "${spawn.name}" must have Spawned=yes to be launchable`);
                }
                spawn.spawnLinkTrait.setParent(launcher);
            }
            return spawn;
        }
    }
    storeAircraft(aircraft: any, world: any): void {
        if (!this.spawns.includes(aircraft)) {
            throw new Error(`Object "${aircraft.name}#${aircraft.id}" not found in list of linked spawns`);
        }
        if (aircraft.limboData) {
            throw new Error(`Object "${aircraft.name}#${aircraft.id}" is already in limbo`);
        }
        world.limboObject(aircraft, { selected: false, controlGroup: undefined });
        this.storage.push(aircraft);
    }
}
