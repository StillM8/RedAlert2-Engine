import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { QueueStatus } from "@/game/player/production/ProductionQueue";
import { SuperWeaponStatus } from "@/game/SuperWeapon";
import { EventType } from "@/game/event/EventType";
import { TriggerActionType } from "@/data/map/trigger/TriggerActionType";
import { TriggerExecutorFactory } from "@/game/trigger/TriggerExecutorFactory";
import { Rules } from "@/game/rules/Rules";
import { Game } from "@/game/Game";

function action(type: TriggerActionType, params: any[] = []): any {
    return { type, params, triggerId: "T", index: 0 };
}

function player(name: string, country = "Alpha"): any {
    return { name, country: { id: country, name: country }, startLocation: 0 };
}

describe("YR trigger action factory", () => {
    test("creates every requested YR action", () => {
        const factory = new TriggerExecutorFactory();
        const requested = [
            1, 2, 3, 4, 5, 6, 7, 8, 13, 20, 37, 38, 41, 46, 47, 48,
            74, 75, 80, 106, 114, 115, 119, 125, 132, 134, 137,
        ];
        for (const type of requested) {
            expect(factory.create(action(type, [0, "Alpha", 0, 0, 0, 0, 0]), {
                id: "T",
                name: "T",
                houseName: "Alpha",
            })).toBeDefined();
        }
    });

    test("Win, Lose, and ForceEnd end Game rather than Trigger", () => {
        const factory = new TriggerExecutorFactory();
        const target = player("Target");
        let ends = 0;
        const context: any = {
            getAllPlayers: () => [target],
            getPlayerNumber: () => 0,
            end: () => ends++,
        };
        const trigger = { id: "T", name: "T", houseName: "Alpha" };
        factory.create(action(TriggerActionType.Win, [0, "Alpha"]), trigger).execute(context);
        factory.create(action(TriggerActionType.Lose, [0, "Alpha"]), trigger).execute(context);
        factory.create(action(TriggerActionType.ForceEnd), trigger).execute(context);
        expect(ends).toBe(3);
        expect(context.triggerOutcome.outcome).toBe("lost");
    });

    test("ProductionBegins releases held queues", () => {
        const target = player("Target");
        const queue = { status: QueueStatus.OnHold };
        target.production = { getAllQueues: () => [queue] };
        const context = { getAllPlayers: () => [target] };
        new TriggerExecutorFactory().create(
            action(TriggerActionType.ProductionBegins, [0, "Alpha"]),
            { houseName: "Alpha" },
        ).execute(context);
        expect(target.productionEnabled).toBe(true);
        expect(queue.status).toBe(QueueStatus.Active);
    });

    test("MakeAlly and MakeEnemy update alliance state", () => {
        const source = player("Source");
        const target = player("Target", "Beta");
        const entries: any[] = [];
        const alliances = {
            alliances: entries,
            findByPlayers: (first: any, second: any) => entries.find((entry) =>
                entry.players.equals({ first, second })),
            setAlliance: () => {
                throw new Error("forced campaign alliance");
            },
            breakAlliance: (first: any, second: any) => {
                const index = entries.findIndex((entry) =>
                    entry.players.equals({ first, second }));
                entries.splice(index, 1);
            },
        };
        let changes = 0;
        const context: any = {
            getAllPlayers: () => [source, target],
            alliances,
            onAllianceChange: () => changes++,
            events: { dispatch: () => {} },
        };
        const trigger = { houseName: "Alpha" };
        const factory = new TriggerExecutorFactory();
        factory.create(action(TriggerActionType.MakeAlly, [0, "Beta"]), trigger).execute(context);
        expect(entries).toHaveLength(1);
        factory.create(action(TriggerActionType.MakeEnemy, [0, "Beta"]), trigger).execute(context);
        expect(entries).toHaveLength(0);
        expect(changes).toBe(2);
    });

    test("text and music actions dispatch presentation events", () => {
        const events: any[] = [];
        const context = { events: { dispatch: (event: any) => events.push(event) } };
        const factory = new TriggerExecutorFactory();
        const trigger = { houseName: "Alpha" };
        factory.create(action(TriggerActionType.TextTrigger, [4, "Mission:Text"]), trigger)
            .execute(context);
        factory.create(action(TriggerActionType.PlayMusicTheme, [8, "Ambient"]), trigger)
            .execute(context);
        expect(events.map((event) => event.type)).toEqual([EventType.TriggerText, "TriggerMusic"]);
        expect(events.map((event) => event.label ?? event.theme)).toEqual([
            "Mission:Text",
            "Ambient",
        ]);
    });

    test("generic team reinforcement creates the task force at its team waypoint", () => {
        const mapFile = new IniFile();
        mapFile.getOrCreateSection("TeamTypes").set("0", "TEAM");
        const team = mapFile.getOrCreateSection("TEAM");
        team.set("TaskForce", "TF");
        team.set("House", "Alpha");
        team.set("Waypoint", "5");
        mapFile.getOrCreateSection("TaskForces").set("0", "TF");
        const taskForce = mapFile.getOrCreateSection("TF");
        taskForce.set("0", "2,E1");
        taskForce.set("1", "1,JEEP");
        const rulesByName: Record<string, any> = {
            E1: { name: "E1", type: ObjectType.Infantry },
            JEEP: { name: "JEEP", type: ObjectType.Vehicle },
        };
        const target = player("Owner");
        const spawned: any[] = [];
        const events: any[] = [];
        const tiles: Record<number, any> = { 5: { rx: 5, ry: 5 }, 26: { rx: 26, ry: 26 } };
        const context: any = {
            map: {
                mapFile,
                getTileAtWaypoint: (id: number) => tiles[id],
            },
            rules: {
                hasObject: (name: string) => !!rulesByName[name],
                getObject: (name: string) => rulesByName[name],
                getIni: () => new IniFile(),
            },
            getAllPlayers: () => [target],
            createUnitForPlayer: (rules: any, owner: any) => ({
                name: rules.name,
                rules,
                owner,
                isUnit: () => true,
            }),
            spawnObject: (unit: any, tile: any) => spawned.push({ unit, tile }),
            events: { dispatch: (event: any) => events.push(event) },
        };
        const trigger = { houseName: "Alpha" };
        const factory = new TriggerExecutorFactory();
        factory.create(action(TriggerActionType.Reinforcement, [1, "0", 0, 0, 0, 0, 0]), trigger)
            .execute(context);
        expect(spawned.map(({ unit }) => unit.name)).toEqual(["E1", "E1", "JEEP"]);
        expect(spawned.every(({ tile }) => tile === tiles[5])).toBe(true);
        expect(events[0].soundId).toBe("EVA_ReinforcementsHaveArrived");

        spawned.length = 0;
        factory.create(action(TriggerActionType.ReinforcementAtWaypoint, [1, "0", 0, 0, 0, 0, 26]), trigger)
            .execute(context);
        expect(spawned.every(({ tile }) => tile === tiles[26])).toBe(true);
    });

    test("base center, destroy all, create building, and superweapon actions are executable", () => {
        const target = player("Owner");
        const tile = { rx: 26, ry: 26 };
        const object = { isDestroyed: false, isDisposed: false };
        target.getOwnedObjects = () => [object];
        const weapon: any = {
            chargeTicks: 900,
            status: SuperWeaponStatus.Charging,
            shotsFired: 2,
        };
        target.superWeaponsTrait = { get: () => weapon };
        const building: any = {
            name: "FACT",
            isBuilding: () => true,
            isTechno: () => true,
        };
        const spawned: any[] = [];
        const context: any = {
            getAllPlayers: () => [target],
            map: { getTileAtWaypoint: () => tile },
            rules: {
                general: {},
                hasObject: () => true,
            },
            destroyObject: () => {
                object.isDestroyed = true;
            },
            createObject: () => building,
            changeObjectOwner: () => {},
            spawnObject: (created: any) => spawned.push(created),
            end: () => {},
        };
        const factory = new TriggerExecutorFactory();
        const trigger = { houseName: "Alpha" };
        factory.create(action(TriggerActionType.SetBaseCenterCell, [0, 0, 0, 0, 0, 0, 26]), trigger)
            .execute(context);
        expect(target.triggerBaseCenter).toEqual({ x: 26, y: 26 });
        factory.create(action(TriggerActionType.DestroyAll, [0, "Alpha"]), trigger)
            .execute(context);
        expect(object.isDestroyed).toBe(true);
        factory.create(action(TriggerActionType.CreateBuildingAt, [10, "FACT", 0, 0, 0, 0, 26]), trigger)
            .execute(context);
        expect(spawned).toEqual([building]);
        factory.create(action(TriggerActionType.SuperweaponSetRechargeTime, [11, "SW", 0, 0, 0, 0, 300]), trigger)
            .execute(context);
        expect(weapon.rechargeTicks).toBe(300);
        factory.create(action(TriggerActionType.SuperweaponReset, [0, "SW"]), trigger)
            .execute(context);
        expect(weapon.status).toBe(SuperWeaponStatus.Ready);
        expect(weapon.chargeTicks).toBe(0);
        expect(weapon.shotsFired).toBe(0);
    });

    test("SetObjectTechLevel applies validated canonical overrides atomically", () => {
        const infantry = { name: "E1", type: ObjectType.Infantry, techLevel: 5 };
        const duplicateBuilding = { name: "DUPLICATE", type: ObjectType.Building, techLevel: 1 };
        const duplicateVehicle = { name: "DUPLICATE", type: ObjectType.Vehicle, techLevel: 1 };
        const rules = Object.create(Rules.prototype) as any;
        rules.buildingRules = new Map([[duplicateBuilding.name, duplicateBuilding]]);
        rules.infantryRules = new Map([[infantry.name, infantry]]);
        rules.vehicleRules = new Map([[duplicateVehicle.name, duplicateVehicle]]);
        rules.aircraftRules = new Map();
        rules.objectTechLevelOverrides = new Map();
        const context = { rules, setObjectTechLevel: Game.prototype.setObjectTechLevel };
        const trigger = { houseName: "Alpha" };
        const factory = new TriggerExecutorFactory();

        factory.create(action(TriggerActionType.SetObjectTechLevel, [9, "E1", 0, 0, 0, 0, 0]), trigger)
            .execute(context);
        expect(rules.getEffectiveObjectTechLevel(infantry)).toBe(0);
        expect(infantry.techLevel).toBe(5);
        const before = rules.captureObjectTechLevelOverrideState();

        const invalid = [
            [[8, "E1", 0, 0, 0, 0, 1], /object marker/],
            [[9, "UNKNOWN", 0, 0, 0, 0, 1], /Unknown object type/],
            [[9, "DUPLICATE", 0, 0, 0, 0, 1], /Ambiguous object type/],
            [[9, "E1", 0, 0, 0, 0, -2], /P7 tech level/],
            [[9, "E1", 0, 0, 0, 0, 1.5], /P7 tech level/],
        ] as const;
        for (const [params, expected] of invalid) {
            expect(() => factory.create(
                action(TriggerActionType.SetObjectTechLevel, params as any),
                trigger,
            ).execute(context)).toThrow(expected);
            expect(rules.captureObjectTechLevelOverrideState()).toEqual(before);
        }
    });
});
