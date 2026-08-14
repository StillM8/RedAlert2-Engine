import { describe, expect, test } from "bun:test";
import { LandType } from "@/game/type/LandType";
import { ObjectType } from "@/engine/type/ObjectType";
import { SuperWeaponStatus } from "@/game/SuperWeapon";
import { SuperWeaponType } from "@/game/type/SuperWeaponType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { SuperweaponOfficer } from "@/game/ai/thirdpartbot/builtIn/bot/logic/superweapons";

function unit(
    id: string,
    owner: string,
    type: ObjectType,
    rx: number,
    ry: number,
    rules: Record<string, unknown> = {},
): any {
    return {
        id,
        owner,
        type,
        name: String(rules.name ?? id),
        tile: { rx, ry },
        maxHitPoints: 100,
        purchaseValue: 100,
        rules: { name: id, cost: 100, ...rules },
        primaryWeapon: undefined,
    };
}

function host(options: {
    superWeapon: any;
    units?: any[];
    ownStart?: { x: number; y: number };
    enemyStart?: { x: number; y: number };
    rally?: { x: number; y: number };
    alliedPlayers?: string[];
    tileZones?: Map<string, ZoneType>;
    mapSize?: { width: number; height: number };
    activeSuperWeaponType?: number;
}) {
    const ownStart = options.ownStart ?? { x: 5, y: 5 };
    const enemyStart = options.enemyStart ?? { x: 40, y: 40 };
    const units = options.units ?? [];
    const actions: any[] = [];
    const byId = new Map(units.map((item) => [item.id, item]));
    const game: any = {
        getCurrentTick: () => 75,
        getAllSuperWeaponData: () => [{ playerName: "AI", ...options.superWeapon }],
        getPlayers: () => ["AI", "Enemy", ...(options.alliedPlayers ?? [])],
        getPlayerData: (name: string) => ({
            name,
            isCombatant: true,
            isAi: name === "AI",
            startLocation: name === "AI" ? ownStart : enemyStart,
            power: { isLowPower: false },
        }),
        areAlliedPlayers: (first: string, second: string) =>
            (options.alliedPlayers ?? []).includes(first === "AI" ? second : first),
        getVisibleUnits: (playerName: string, relation: string, filter = () => true) => units
            .filter((item) => {
                if (!filter(item.rules)) return false;
                if (relation === "self") return item.owner === playerName;
                const isAlly = (options.alliedPlayers ?? []).includes(
                    playerName === "AI" ? item.owner : playerName,
                );
                if (relation === "enemy") return item.owner !== playerName && !isAlly;
                if (relation === "allied") return item.owner === playerName || isAlly;
                return true;
            })
            .map((item) => item.id),
        getUnitData: (id: string) => byId.get(id),
        generateRandomInt: () => 0,
        mapApi: {
            getTile: (x: number, y: number) => ({ x, y, rx: x, ry: y, landType: LandType.Clear }),
            getTileZone: (tile: any) => options.tileZones?.get(`${tile.rx},${tile.ry}`) ?? ZoneType.Ground,
            getObjectsOnTile: () => [],
            getRealMapSize: () => options.mapSize ?? { width: 64, height: 64 },
        },
        isSuperWeaponEffectActive: (type: number) => type === options.activeSuperWeaponType,
    };
    const context: any = {
        game,
        player: {
            name: "AI",
            actions: {
                activateSuperWeapon: (...args: any[]) => actions.push(args),
            },
        },
        matchAwareness: {
            getMainRallyPoint: () => options.rally ?? { x: 2, y: 2 },
        },
    };
    const officer = new SuperweaponOfficer({ difficultyId: "normal" } as any);
    officer.onAiUpdate(context, { getMissions: () => [] } as any, () => undefined);
    return { actions };
}

describe("Ares custom superweapon AI host path", () => {
    test("EMPulse Offensive selects an enemy cluster that an eligible cannon can reach", () => {
        const cannon = unit("CANNON", "AI", ObjectType.Building, 0, 0, {
            empulseCannon: true,
        });
        cannon.primaryWeapon = { minRange: 0, maxRange: 5 };
        const near = unit("near", "Enemy", ObjectType.Vehicle, 4, 0);
        const far = unit("far", "Enemy", ObjectType.Vehicle, 20, 20);

        const { actions } = host({
            units: [cannon, near, far],
            superWeapon: {
                index: 0,
                name: "BlackoutMissileSpecial",
                typeId: "EMPulse",
                status: SuperWeaponStatus.Ready,
                ares: {
                    extensionType: "EMPulse",
                    swAITargeting: "Offensive",
                    empulseCannons: ["CANNON"],
                    swRangeMaximum: 5,
                },
            },
        });

        expect(actions).toHaveLength(1);
        expect(actions[0][1]).toEqual({ rx: 4, ry: 0 });
    });

    test("EMPulse.TargetSelf gets the documented no-target default and uses a cannon cell", () => {
        const cannon = unit("CANNON", "AI", ObjectType.Building, 7, 9, {
            empulseCannon: true,
        });

        const { actions } = host({
            units: [cannon],
            superWeapon: {
                index: 0,
                name: "TimeFreezeSpecial",
                typeId: "EMPulse",
                status: SuperWeaponStatus.Ready,
                ares: {
                    extensionType: "EMPulse",
                    swAITargeting: "NoTarget",
                    empulseTargetSelf: true,
                },
            },
        });

        expect(actions).toHaveLength(1);
        expect(actions[0][1]).toEqual({ rx: 7, ry: 9 });
    });

    test("UnitDelivery default searches near the enemy base for a free delivery area", () => {
        const enemy = unit("enemy", "Enemy", ObjectType.Vehicle, 40, 40);
        const { actions } = host({
            units: [enemy],
            rally: { x: 2, y: 2 },
            superWeapon: {
                index: 0,
                name: "InstantShelterSpecial",
                typeId: "UnitDelivery",
                status: SuperWeaponStatus.Ready,
                ares: {
                    extensionType: "UnitDelivery",
                    deliverTypes: ["ARCH"],
                },
            },
        });

        expect(actions).toHaveLength(1);
        expect(actions[0][1]).toEqual({ rx: 40, ry: 40 });
    });

    test("DropPod keeps its own outer-sector targeter and Firestorm remains excluded", () => {
        const dropPod = host({
            superWeapon: {
                index: 0,
                name: "KnightfallSpawn",
                typeId: "DropPod",
                status: SuperWeaponStatus.Ready,
                ares: { extensionType: "DropPod" },
            },
        });
        expect(dropPod.actions).toHaveLength(1);
        expect(dropPod.actions[0][1]).toEqual({ rx: -7, ry: -7 });

        const firestorm = host({
            superWeapon: {
                index: 0,
                name: "BlasticadeSpecial",
                typeId: "Firestorm",
                status: SuperWeaponStatus.Ready,
                ares: { extensionType: "Firestorm" },
            },
        });
        expect(firestorm.actions).toHaveLength(0);
    });

    test("AIRequiresTarget applies the map cell zone and keeps the chosen cell eligible", () => {
        const ground = unit("ground", "Enemy", ObjectType.Vehicle, 4, 0);
        const ship = unit("ship", "Enemy", ObjectType.Vehicle, 20, 20);
        const { actions } = host({
            units: [ground, ship],
            tileZones: new Map([["20,20", ZoneType.Water]]),
            superWeapon: {
                index: 0,
                name: "WaterStrike",
                typeId: "GenericWarhead",
                status: SuperWeaponStatus.Ready,
                ares: {
                    extensionType: "GenericWarhead",
                    swAITargeting: "Offensive",
                    swAIRequiresTarget: "Water,Units",
                },
            },
        });

        expect(actions).toHaveLength(1);
        expect(actions[0][1]).toEqual({ rx: 20, ry: 20 });
    });

    test("AIRequiresHouse selects allied technos instead of silently forcing enemies", () => {
        const ally = unit("ally-building", "Ally", ObjectType.Building, 8, 8);
        const enemy = unit("enemy-building", "Enemy", ObjectType.Building, 40, 40);
        const { actions } = host({
            units: [ally, enemy],
            alliedPlayers: ["Ally"],
            superWeapon: {
                index: 0,
                name: "AllySupport",
                typeId: "GenericWarhead",
                status: SuperWeaponStatus.Ready,
                ares: {
                    extensionType: "GenericWarhead",
                    swAITargeting: "Offensive",
                    swAIRequiresTarget: "Buildings",
                    swAIRequiresHouse: "Allies",
                },
            },
        });

        expect(actions).toHaveLength(1);
        expect(actions[0][1]).toEqual({ rx: 8, ry: 8 });
    });

    test("MultiMissile uses ThreatPosed rather than cost for its target score", () => {
        const expensive = unit("expensive", "Enemy", ObjectType.Building, 8, 8, {
            cost: 10000,
            threatPosed: 5,
        });
        const dangerous = unit("dangerous", "Enemy", ObjectType.Building, 40, 40, {
            cost: 100,
            threatPosed: 1000,
        });
        const { actions } = host({
            units: [expensive, dangerous],
            superWeapon: {
                index: SuperWeaponType.MultiMissile,
                name: "MultiMissile",
                type: SuperWeaponType.MultiMissile,
                typeId: "MultiMissile",
                status: SuperWeaponStatus.Ready,
                ares: { swAITargeting: "MultiMissile" },
            },
        });

        expect(actions).toHaveLength(1);
        expect(actions[0][1]).toEqual({ rx: 40, ry: 40 });
    });

    test("Iron Curtain and Force Shield do not auto-fire from a ready poll", () => {
        const iron = host({
            superWeapon: {
                index: SuperWeaponType.IronCurtain,
                name: "IronCurtain",
                type: SuperWeaponType.IronCurtain,
                typeId: "IronCurtain",
                status: SuperWeaponStatus.Ready,
                ares: { swAITargeting: "IronCurtain" },
            },
        });
        const shield = host({
            superWeapon: {
                index: SuperWeaponType.ForceShield,
                name: "ForceShield",
                type: SuperWeaponType.ForceShield,
                typeId: "ForceShield",
                status: SuperWeaponStatus.Ready,
                ares: { swAITargeting: "ForceShield" },
            },
        });

        expect(iron.actions).toHaveLength(0);
        expect(shield.actions).toHaveLength(0);
    });

    test("LightningRandom uses the project RNG and HunterSeeker waits for a target house", () => {
        const random = host({
            superWeapon: {
                index: 0,
                name: "RandomStrike",
                typeId: "GenericWarhead",
                status: SuperWeaponStatus.Ready,
                ares: { extensionType: "GenericWarhead", swAITargeting: "LightningRandom" },
            },
            mapSize: { width: 20, height: 30 },
        });
        expect(random.actions).toHaveLength(1);
        expect(random.actions[0][1]).toEqual({ rx: 0, ry: 0 });

        const hunter = host({
            superWeapon: {
                index: 0,
                name: "HunterSeeker",
                typeId: "HunterSeeker",
                status: SuperWeaponStatus.Ready,
                ares: { extensionType: "HunterSeeker", swAITargeting: "HunterSeeker" },
            },
        });
        expect(hunter.actions).toHaveLength(0);
    });

    test("inactive superweapon constraints block a launch while its effect is running", () => {
        const blocked = host({
            activeSuperWeaponType: SuperWeaponType.LightningStorm,
            superWeapon: {
                index: 0,
                name: "StormFollowup",
                typeId: "GenericWarhead",
                status: SuperWeaponStatus.Ready,
                ares: {
                    extensionType: "GenericWarhead",
                    swAITargeting: "Offensive",
                    swAITargetingConstraints: "LightningStorm_Inactive",
                },
            },
        });
        expect(blocked.actions).toHaveLength(0);
    });
});
