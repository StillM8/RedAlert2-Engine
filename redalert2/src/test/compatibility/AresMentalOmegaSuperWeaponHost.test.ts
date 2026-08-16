import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { ObjectType } from "@/engine/type/ObjectType";
import { IniFile, IniSection } from "@/data/IniFile";
import { ActivateSuperWeaponAction } from "@/game/action/ActivateSuperWeaponAction";
import { SuperWeapon, SuperWeaponStatus } from "@/game/SuperWeapon";
import { SuperWeaponRules } from "@/game/rules/SuperWeaponRules";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";
import { NotifyTick } from "@/game/trait/interface/NotifyTick";
import { Warhead } from "@/game/Warhead";
import { SpeedType } from "@/game/type/SpeedType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

/*
 * The two first definitions are read from the installed Mental Omega map-mode
 * file.  The fallback contains the same host-relevant fields from that file,
 * so this test remains runnable when the optional local MO installation is not
 * mounted in CI.  The other representative IDs are MIX-backed in MO; their
 * host-relevant fields are retained below from the effective MO requirement
 * inventory rather than inventing unit-specific runtime behavior.
 */
const MO_NO_RUSH = "/home/ra2 android/RA2 MO/INI/Map Code/No Rush.ini";
const MO_NO_RUSH_FALLBACK = `
[CeasefireSpawn]
Name=Ceasefire Spawn
IsPowered=false
RechargeTime=.1
Type=UnitDelivery
Action=Custom
SW.RequiresTarget=land
SW.FireIntoShroud=yes
SW.InitialReady=yes
SW.ManualFire=false
SW.AutoFire=true
SW.Deferment=0
Deliver.Types=CACEAS
Deliver.Owner=Special
SW.Shots=1

[CeasefireSpecial]
Name=Ceasefire Special
IsPowered=false
RechargeTime=.16
Type=GenericWarhead
Action=Custom
SW.RequiresTarget=land
SW.FireIntoShroud=yes
SW.InitialReady=yes
SW.ManualFire=false
SW.AutoFire=true
SW.Warhead=CeasekillWH
SW.AffectsHouse=enemies
SW.Damage=100
SW.Deferment=0
SW.MaxCount=1
SW.Shots=42
`;

const moNoRushText = existsSync(MO_NO_RUSH)
    ? readFileSync(MO_NO_RUSH, "utf8")
    : MO_NO_RUSH_FALLBACK;

const MO_MIX_BACKED_FIXTURES: Record<string, string> = {
    NuclearPathSpecial: `
[NuclearPathSpecial]
Name=Nuclear Path
RechargeTime=1
Type=EMPulse
SW.InitialReady=yes
SW.ManualFire=yes
SW.RangeMaximum=20
SW.MaxCount=1
EMPulse.Cannons=MOEMPCannon
EMPulse.TargetSelf=yes
EMPulse.PulseDelay=0
`,
    SonarPulseSpecial: `
[SonarPulseSpecial]
Name=Sonar Pulse
RechargeTime=1
Type=SonarPulse
SW.InitialReady=yes
SW.ManualFire=yes
SW.Range=10
SW.AffectsHouse=Enemies
SW.AffectsTarget=Water
SonarPulse.Delay=0
`,
    DropPodSpawn1: `
[DropPodSpawn1]
Name=Drop Pod Spawn 1
RechargeTime=1
Type=DropPod
SW.InitialReady=yes
SW.ManualFire=yes
DropPod.Types=MODropInfantry
DropPod.Minimum=1
DropPod.Maximum=1
DropPod.Veterancy=2
`,
    HunterSeekerSpecial: `
[HunterSeekerSpecial]
Name=Hunter Seeker
RechargeTime=1
Type=HunterSeeker
SW.InitialReady=yes
SW.ManualFire=yes
SW.MaxCount=1
HunterSeeker.Buildings=MOHSLauncher
HunterSeeker.Type=MOHunterSeeker
HunterSeeker.RandomOnly=yes
`,
    PsychicFlashSpecial: `
[PsychicFlashSpecial]
Name=Psychic Flash
RechargeTime=1
Type=Battery
SW.InitialReady=yes
SW.ManualFire=yes
SW.ChargeToDrainRatio=1
Battery.Power=100
Battery.Overpower=MOBatteryBuilding
`,
    BlasticadeSpecial: `
[BlasticadeSpecial]
Name=Blasticade
RechargeTime=1
Type=Firestorm
SW.InitialReady=yes
SW.ManualFire=yes
SW.ChargeToDrainRatio=1
`,
    CWarpCloneSpecial: `
[CWarpCloneSpecial]
Name=Chrono Warp Clone
Type=ChronoWarp
SW.AllowAI=no
NoCursor=yes
`,
};

function sectionFromSource(name: string): IniSection {
    const section = new IniFile(moNoRushText).getSection(name);
    if (!section) throw new Error(`Mental Omega source is missing [${name}]`);
    return section;
}

function sectionFromFixture(name: string): IniSection {
    const section = new IniFile(MO_MIX_BACKED_FIXTURES[name]).getSection(name);
    if (!section) throw new Error(`MO fixture is missing [${name}]`);
    return section;
}

interface HostObjectOptions {
    type: ObjectType;
    zone?: ZoneType;
    owner?: any;
}

function tile(rx: number, ry: number, zone: ZoneType = ZoneType.Ground): any {
    return { rx, ry, dx: rx, dy: ry, z: 0, zone };
}

function makeHostObject(name: string, options: HostObjectOptions): any {
    const foundation = { width: 1, height: 1, cells: [{ x: 0, y: 0 }] };
    const object: any = {
        id: `${name}-${options.type}`,
        name,
        type: options.type,
        owner: options.owner,
        zone: options.zone ?? ZoneType.Ground,
        rules: {
            name,
            type: options.type,
            speedType: SpeedType.Track,
            flightLevel: 7,
        },
        art: { foundation, foundationCenter: { x: 0, y: 0 } },
        position: { desiredSubCell: 0, subCell: 0, tileElevation: 0 },
        veteranLevel: 0,
        isSpawned: false,
        isDestroyed: false,
        isDisposed: false,
        isCrashing: false,
        tile: tile(5, 5, options.zone ?? ZoneType.Ground),
        centerTile: tile(5, 5, options.zone ?? ZoneType.Ground),
        isTechno: () => true,
        isBuilding: () => options.type === ObjectType.Building,
        isInfantry: () => options.type === ObjectType.Infantry,
        isVehicle: () => options.type === ObjectType.Vehicle,
        isAircraft: () => options.type === ObjectType.Aircraft,
        isUnit: () => options.type !== ObjectType.Building,
        getFoundation: () => foundation,
        addTrait(trait: any) {
            this.attachedTraits ??= [];
            this.attachedTraits.push(trait);
        },
        dispose() {
            this.isDisposed = true;
        },
    };
    return object;
}

interface HostFixture {
    game: any;
    owner: any;
    enemy: any;
    weapon: SuperWeapon;
    trait: SuperWeaponsTrait;
    spawned: any[];
    detonations: any[];
    events: any[];
    batteryActivations: any[];
    batteryDeactivations: any[];
}

function makeHost(
    section: IniSection,
    index: number,
    objectDefinitions: Record<string, ObjectType> = {},
): HostFixture {
    const rules = new SuperWeaponRules(index).readIni(section);
    const definitions = new Map(Object.entries(objectDefinitions));
    const spawned: any[] = [];
    const detonations: any[] = [];
    const events: any[] = [];
    const batteryActivations: any[] = [];
    const batteryDeactivations: any[] = [];

    const makePlayer = (id: string, isAi = false): any => {
        const player: any = {
            id,
            isAi,
            credits: 100000,
            country: { id, name: id, sideId: id },
            buildings: [],
            owned: [],
            powerTrait: {
                isLowPower: () => false,
                activateAresBattery: (definition: any) => batteryActivations.push({ player, definition }),
                deactivateAresBattery: (definition: any) => batteryDeactivations.push({ player, definition }),
            },
            addOwnedObject(object: any) {
                if (!this.owned.includes(object)) this.owned.push(object);
                object.owner = this;
            },
            removeOwnedObject(object: any) {
                this.owned = this.owned.filter((candidate: any) => candidate !== object);
            },
        };
        return player;
    };

    const owner = makePlayer("Europeans", section.getBool("SW.AutoFire") === true);
    const enemy = makePlayer("Epsilon");
    const special = makePlayer("Special");
    const civilian = makePlayer("Civilian");
    const neutral = makePlayer("Neutral");

    const playerTrait = {
        getAll: () => [weapon],
        get: (name: string) => name === rules.name ? weapon : undefined,
        getAresShotsFired: () => 0,
        recordAresSuperWeaponShot: () => undefined,
        add: () => undefined,
        remove: () => undefined,
        has: () => false,
    };
    owner.superWeaponsTrait = playerTrait;

    const weapon = new SuperWeapon(rules.name, rules, owner);
    weapon.status = SuperWeaponStatus.Ready;
    weapon.chargeTicks = 0;
    const superWeaponsTrait = new SuperWeaponsTrait();

    const allPlayers = [owner, enemy, special, civilian, neutral];
    const map = {
        tiles: { getByMapCoords: (x: number, y: number) => tile(x, y) },
        mapBounds: { isWithinBounds: () => true },
        getTileZone: (target: any) => target?.zone ?? ZoneType.Ground,
        getGroundObjectsOnTile: (target: any) => spawned.filter(object => object.tile?.rx === target.rx && object.tile?.ry === target.ry),
        tileOccupation: {
            getBridgeOnTile: () => undefined,
            calculateTilesForGameObject: (target: any) => [target],
        },
        terrain: {
            getPassableSpeed: () => 1,
            findObstacles: () => [],
        },
    };

    const game: any = {
        currentTick: 0,
        rules: {
            getSuperWeaponByIndex: (candidate: number) => candidate === index ? rules : undefined,
            getWarhead: (name: string) => ({ name }),
            hasObject: (name: string, type: ObjectType) => definitions.get(name) === type,
            getObject: (name: string, type: ObjectType) => {
                if (definitions.get(name) !== type) throw new Error(`missing object ${name}`);
                return { name, type, speedType: SpeedType.Track, flightLevel: 7 };
            },
            general: {
                flightLevel: 7,
                dropPodTypes: ["MODropInfantry"],
                dropPodMinimum: 1,
                dropPodMaximum: 1,
                veteran: { veteranCap: 2 },
            },
        },
        map,
        alliances: { areAllied: () => false },
        mapShroudTrait: {
            getPlayerShroud: () => ({ getShroudType: () => 2 }),
        },
        traits: {
            get: (type: any) => type === SuperWeaponsTrait ? superWeaponsTrait : undefined,
            filter: () => [],
            find: () => undefined,
        },
        events: { dispatch: (event: any) => events.push(event) },
        getCombatants: () => [],
        getAllPlayers: () => allPlayers,
        getCivilianPlayer: () => civilian,
        getWorld: () => ({ getAllObjects: () => spawned }),
        createTarget: (object: any, targetTile: any) => ({ object, targetTile }),
        createObject: (type: ObjectType, name: string) => makeHostObject(name, { type }),
        createUnitForPlayer: (objectRules: any, player: any) => {
            const object = makeHostObject(objectRules.name, { type: objectRules.type, owner: player });
            player.addOwnedObject(object);
            return object;
        },
        addObjectTrait: (object: any, objectTrait: any) => object.addTrait(objectTrait),
        changeObjectOwner: (object: any, player: any) => player.addOwnedObject(object),
        spawnObject: (object: any, target: any) => {
            object.tile = target;
            object.centerTile = target;
            object.isSpawned = true;
            spawned.push(object);
        },
        generateRandomInt: (minimum: number) => minimum,
    };

    owner.buildings = [];
    // Host activation must pass the same availability/provider gate as a
    // live house.  This generic provider is deliberately not an MO unit
    // special case; it represents the building slot that granted the SW.
    const provider = makeHostObject("MO_PROVIDER", { type: ObjectType.Building, owner });
    provider.rules.superWeapon = rules.name;
    owner.buildings.push(provider);
    for (const auxiliary of rules.ares?.auxBuildings ?? []) {
        const aux = makeHostObject(auxiliary, { type: ObjectType.Building, owner });
        owner.buildings.push(aux);
    }
    enemy.buildings = [];
    return {
        game,
        owner,
        enemy,
        weapon,
        trait: superWeaponsTrait,
        spawned,
        detonations,
        events,
        batteryActivations,
        batteryDeactivations,
    };
}

function activateThroughHost(host: HostFixture, index: number, x = 5, y = 5): void {
    const action = new ActivateSuperWeaponAction(host.game);
    (action as any).player = host.owner;
    (action as any).superWeaponType = index;
    (action as any).tile = { x, y };
    action.process();
}

function tickHost(host: HostFixture): void {
    host.trait[NotifyTick.onTick](host.game);
}

describe("Mental Omega Ares superweapon host certification", () => {
    test("reaches GenericWarhead through the real MO CeasefireSpecial action path", () => {
        const host = makeHost(sectionFromSource("CeasefireSpecial"), 0);
        const originalDetonate = Warhead.prototype.detonate;
        (Warhead.prototype as any).detonate = function (...args: any[]) {
            host.detonations.push(args);
        };

        try {
            activateThroughHost(host, 0);
            tickHost(host);
        }
        finally {
            Warhead.prototype.detonate = originalDetonate;
        }

        expect(host.weapon.rules.ares?.extensionType).toBe("GenericWarhead");
        expect(host.detonations).toHaveLength(1);
        expect(host.detonations[0][1]).toBe(100);
        expect(host.detonations[0][2]).toMatchObject({ rx: 5, ry: 5 });
        expect(host.events).toHaveLength(1);
    });

    test("reaches UnitDelivery through the real MO CeasefireSpawn action path", () => {
        const host = makeHost(sectionFromSource("CeasefireSpawn"), 1, {
            CACEAS: ObjectType.Infantry,
        });

        activateThroughHost(host, 1);
        tickHost(host);

        expect(host.weapon.rules.ares?.extensionType).toBe("UnitDelivery");
        expect(host.spawned).toHaveLength(1);
        expect(host.spawned[0].name).toBe("CACEAS");
        expect(host.spawned[0].owner.country.id).toBe("Special");
        expect(host.events).toHaveLength(1);
    });

    test("reaches EMPulse and detonates a configured MO cannon through the host", () => {
        const host = makeHost(sectionFromFixture("NuclearPathSpecial"), 2, {
            MOEMPCannon: ObjectType.Building,
        });
        const cannon = makeHostObject("MOEMPCannon", { type: ObjectType.Building, owner: host.owner });
        cannon.isSpawned = true;
        cannon.tile = tile(5, 5);
        cannon.centerTile = cannon.tile;
        cannon.primaryWeapon = {
            rules: { damage: 1, minimumRange: 0, range: 20 },
            warhead: { detonate: (...args: any[]) => host.detonations.push(args) },
        };
        host.owner.buildings.push(cannon);

        activateThroughHost(host, 2);
        tickHost(host);

        expect(host.weapon.rules.ares?.extensionType).toBe("EMPulse");
        expect(host.detonations).toHaveLength(1);
        expect(host.detonations[0][2]).toBe(cannon.tile);
        expect(host.events).toHaveLength(1);
    });

    test("reaches SonarPulse and applies the host effect to an enemy water target", () => {
        const host = makeHost(sectionFromFixture("SonarPulseSpecial"), 3);
        const target = makeHostObject("MOEnemyShip", {
            type: ObjectType.Vehicle,
            owner: host.enemy,
            zone: ZoneType.Water,
        });
        target.tile = tile(6, 5, ZoneType.Water);
        target.centerTile = target.tile;
        let uncloakCalls = 0;
        target.cloakableTrait = {
            forceUncloak: () => { uncloakCalls++; },
            getCloakSkipTimeLeft: () => 0,
        };
        host.spawned.push(target);

        activateThroughHost(host, 3);
        tickHost(host);

        expect(host.weapon.rules.ares?.extensionType).toBe("SonarPulse");
        expect(uncloakCalls).toBe(1);
        expect(host.events).toHaveLength(1);
    });

    test("reaches DropPod and materializes deterministic MO infantry through the host", () => {
        const host = makeHost(sectionFromFixture("DropPodSpawn1"), 4, {
            MODropInfantry: ObjectType.Infantry,
        });

        activateThroughHost(host, 4);
        tickHost(host);

        expect(host.weapon.rules.ares?.extensionType).toBe("DropPod");
        expect(host.spawned).toHaveLength(1);
        expect(host.spawned[0].name).toBe("MODropInfantry");
        expect(host.spawned[0].dropPodState).toEqual({ phase: "landed", target: { rx: 5, ry: 5 } });
        expect(host.events).toHaveLength(2);
        expect(host.events.some((event: any) => event.name === "SMOKEY")).toBe(true);
    });

    test("reaches HunterSeeker and launches from the configured MO building through the host", () => {
        const host = makeHost(sectionFromFixture("HunterSeekerSpecial"), 5, {
            MOHSLauncher: ObjectType.Building,
            MOHunterSeeker: ObjectType.Aircraft,
        });
        const launcher = makeHostObject("MOHSLauncher", { type: ObjectType.Building, owner: host.owner });
        launcher.isSpawned = true;
        launcher.tile = tile(5, 5);
        launcher.centerTile = launcher.tile;
        host.owner.buildings.push(launcher);

        activateThroughHost(host, 5);
        tickHost(host);

        expect(host.weapon.rules.ares?.extensionType).toBe("HunterSeeker");
        expect(host.spawned).toHaveLength(1);
        expect(host.spawned[0].name).toBe("MOHunterSeeker");
        expect(host.spawned[0].hunterSeekerLaunchBuilding).toBe("MOHSLauncher");
        expect(host.spawned[0].attachedTraits).toHaveLength(1);
        expect(host.events).toHaveLength(1);
    });

    test("reaches Battery and Firestorm charge/drain handlers through the actual action", () => {
        const battery = makeHost(sectionFromFixture("PsychicFlashSpecial"), 6, {
            MOBatteryBuilding: ObjectType.Building,
        });
        activateThroughHost(battery, 6);
        expect(battery.weapon.rules.ares?.extensionType).toBe("Battery");
        expect(battery.weapon.isChargeDrainActive()).toBe(true);
        expect(battery.batteryActivations).toHaveLength(1);
        expect(battery.trait.deactivateSuperWeapon(6, battery.owner)).toBe(true);
        expect(battery.batteryDeactivations).toHaveLength(1);

        const firestorm = makeHost(sectionFromFixture("BlasticadeSpecial"), 7);
        activateThroughHost(firestorm, 7);
        expect(firestorm.weapon.rules.ares?.extensionType).toBe("Firestorm");
        expect(firestorm.weapon.isChargeDrainActive()).toBe(true);
        expect(firestorm.owner.aresFirestormActive).toBe(true);
        expect(firestorm.trait.deactivateSuperWeapon(7, firestorm.owner)).toBe(true);
        expect(firestorm.owner.aresFirestormActive).toBe(false);
    });

    test("documents ChronoWarp as host-reachable target selection without a direct custom effect", () => {
        const host = makeHost(sectionFromFixture("CWarpCloneSpecial"), 8);

        // Ares uses ChronoWarp as the second-stage target marker for a
        // ChronoSphere.  It does not have a standalone detonation effect;
        // direct custom ChronoWarp activation currently reaches the host,
        // consumes its charge, and dispatches activation without queuing an
        // effect.  Keep this explicit until the dependent ChronoSphere host
        // flow is certified.
        activateThroughHost(host, 8);

        expect(host.weapon.rules.ares?.extensionType).toBe("ChronoWarp");
        expect(host.events).toHaveLength(1);
        expect((host.trait as any).effects).toHaveLength(0);
    });
});
