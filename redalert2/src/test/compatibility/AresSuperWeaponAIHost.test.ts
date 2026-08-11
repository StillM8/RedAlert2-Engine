import { describe, expect, test } from "bun:test";
import { LandType } from "@/game/type/LandType";
import { ObjectType } from "@/engine/type/ObjectType";
import { SuperWeaponStatus } from "@/game/SuperWeapon";
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
}) {
    const ownStart = options.ownStart ?? { x: 5, y: 5 };
    const enemyStart = options.enemyStart ?? { x: 40, y: 40 };
    const units = options.units ?? [];
    const actions: any[] = [];
    const byId = new Map(units.map((item) => [item.id, item]));
    const game: any = {
        getCurrentTick: () => 75,
        getAllSuperWeaponData: () => [{ playerName: "AI", ...options.superWeapon }],
        getPlayers: () => ["AI", "Enemy"],
        getPlayerData: (name: string) => ({
            name,
            isCombatant: true,
            isAi: name === "AI",
            startLocation: name === "AI" ? ownStart : enemyStart,
            power: { isLowPower: false },
        }),
        areAlliedPlayers: () => false,
        getVisibleUnits: (playerName: string, relation: string, filter = () => true) => units
            .filter((item) => {
                if (!filter(item.rules)) return false;
                if (relation === "self") return item.owner === playerName;
                if (relation === "enemy") return item.owner !== playerName;
                return true;
            })
            .map((item) => item.id),
        getUnitData: (id: string) => byId.get(id),
        generateRandomInt: () => 0,
        mapApi: {
            getTile: (x: number, y: number) => ({ x, y, rx: x, ry: y, landType: LandType.Clear }),
            getObjectsOnTile: () => [],
        },
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
});
