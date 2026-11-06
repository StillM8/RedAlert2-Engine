import { describe, expect, test } from "bun:test";
import { Variable } from "@/data/map/Variable";
import { TagRepeatType } from "@/data/map/tag/TagRepeatType";
import { TriggerEventType } from "@/data/map/trigger/TriggerEventType";
import { EventType } from "@/game/event/EventType";
import { DestroyedAllUnitsCondition } from "@/game/trigger/condition/DestroyedAllUnitsCondition";
import { HealthBelowAnyCondition } from "@/game/trigger/condition/HealthBelowAnyCondition";
import { SpyEnteringAsHouseCondition } from "@/game/trigger/condition/SpyEnteringAsHouseCondition";
import { SpyEnteringAsInfantryCondition } from "@/game/trigger/condition/SpyEnteringAsInfantryCondition";
import { TriggerConditionFactory } from "@/game/trigger/TriggerConditionFactory";
import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerManager } from "@/game/trigger/TriggerManager";

function houseContext() {
    const player = {
        name: "Player",
        country: { id: "Alpha", name: "Alpha" },
        startLocation: 0,
        isNeutral: false,
    };
    return {
        player,
        context: {
            getAllPlayers: () => [player],
            rules: {
                getMultiplayerCountries: () => [{ id: "Alpha" }],
            },
        },
    };
}

describe("trigger condition API", () => {
    test("DestroyedAllUnits reads event.params and checks context before events", () => {
        const { player, context } = houseContext();
        player.getOwnedObjectsByType = () => [];
        const event = {
            type: EventType.ObjectDestroy,
            params: [1, "Alpha"],
            target: { isUnit: () => true, owner: player },
        };
        const condition = new DestroyedAllUnitsCondition(event, { houseName: "Alpha" });
        expect(condition.check(context, [event])).toBe(true);
    });

    test("HealthBelowAny checks the event list rather than the context", () => {
        const target = { isTechno: () => true };
        const condition = new HealthBelowAnyCondition(
            { params: [1, 0] },
            { houseName: "Alpha" },
            50,
        );
        condition.setTargets([target]);
        const events = [{
            type: EventType.HealthChange,
            target,
            currentHealth: 49,
            prevHealth: 50,
        }];
        expect(condition.check({}, events)).toEqual([target]);
    });

    test("SpyEnteringAsHouse checks context before events and compares houses canonically", () => {
        const { player, context } = houseContext();
        const target = {};
        const condition = new SpyEnteringAsHouseCondition(
            { params: [1, "0"] },
            { houseName: "Alpha" },
        );
        condition.setTargets([target]);
        const events = [{
            type: EventType.BuildingInfiltration,
            target,
            source: {
                disguiseTrait: { getDisguise: () => ({ owner: player }) },
            },
        }];
        expect(condition.check(context, events)).toEqual([target]);
    });

    test("SpyEnteringAsInfantry checks context before events and reads event.params", () => {
        const target = {};
        const condition = new SpyEnteringAsInfantryCondition(
            { params: [1, "7"] },
            { houseName: "Alpha" },
        );
        condition.setTargets([target]);
        const events = [{
            type: EventType.BuildingInfiltration,
            target,
            source: {
                disguiseTrait: { getDisguise: () => ({ rules: { index: 7 } }) },
            },
        }];
        expect(condition.check({}, events)).toEqual([target]);
    });

    test("factory creates all requested YR event conditions", () => {
        const factory = new TriggerConditionFactory();
        const trigger = { houseName: "Alpha" };
        for (const type of [4, 5, 29, 33, 59, 60, 61]) {
            const event = { type, params: [type === 60 || type === 61 ? 2 : 1, "1", "9"] };
            expect(factory.create(event, trigger)).toBeDefined();
        }
    });

    test("event 29 detects attached destruction but not infiltration", () => {
        const { player, context } = houseContext();
        const target = {};
        const condition = new TriggerConditionFactory().create(
            { type: TriggerEventType.ObjectLost, params: [1, "0"] },
            { houseName: "Alpha" },
        );
        condition.setTargets([target]);
        expect(condition.check(context, [{ type: EventType.ObjectDestroy, target }])).toEqual([target]);
        expect(condition.check(context, [{
            type: EventType.BuildingInfiltration,
            target,
            source: { owner: player },
        }])).toEqual([]);
    });

    test("event 59 accepts ground and overflight entry", () => {
        const { player, context } = houseContext();
        const tile = {};
        const condition = new TriggerConditionFactory().create(
            { type: TriggerEventType.EnteredOrOverflownBy, params: [1, "Alpha"] },
            { houseName: "Alpha" },
        );
        condition.setTargets([tile]);
        expect(condition.check(context, [{
            type: EventType.EnterTile,
            target: tile,
            source: { owner: player, zone: 3 },
        }])).toEqual([tile]);
    });

    test("events 60 and 61 count techno types on the map", () => {
        const target = { rules: { index: 9 } };
        const other = { rules: { index: 10 } };
        const context = { getWorld: () => ({ getAllObjects: () => [target, other] }) };
        const factory = new TriggerConditionFactory();
        const exists = factory.create(
            { type: TriggerEventType.TechTypeExists, params: [2, 1, 9] },
            { houseName: "Alpha" },
        );
        const missing = factory.create(
            { type: TriggerEventType.TechTypeDoesNotExist, params: [2, 0, 8] },
            { houseName: "Alpha" },
        );
        expect(exists.check(context, [])).toBe(true);
        expect(missing.check(context, [])).toBe(true);
    });

    test("canonical house resolver accepts numeric and string references", () => {
        const { player, context } = houseContext();
        for (const reference of [0, "0", "Alpha", "alpha"]) {
            expect(resolveHousePlayer(context, reference)).toBe(player);
        }
    });
});

describe("TriggerManager trigger gates and variable scope", () => {
    test("honors easy, normal, and hard enable flags", () => {
        const manager = new TriggerManager() as any;
        let checks = 0;
        manager.triggerInstances.set("T", {
            trigger: {
                id: "T",
                name: "T",
                disabled: false,
                difficulties: { easy: true, medium: false, hard: true },
                tag: { id: "tag", repeatType: TagRepeatType.Repeat },
                actions: [{ type: 0, params: [] }],
            },
            conditions: [{
                blocking: false,
                check: () => {
                    checks++;
                    return true;
                },
                reset: () => {},
            }],
            targets: [],
            remainingTargets: new Set(),
            disabled: false,
            finished: false,
        });
        manager.update({ difficulty: "easy" });
        manager.update({ difficulty: "normal" });
        manager.update({ difficulty: "hard" });
        expect(checks).toBe(2);
        expect(manager.triggerInstances.get("T").finished).toBe(false);
    });

    test("strict restore rejects incomplete and ambiguous target state transactionally", () => {
        const manager = new TriggerManager() as any;
        const target = { name: "Target", type: 1, rx: 2, ry: 3 };
        manager.triggerInstances.set("T", {
            trigger: { id: "T", name: "T", tag: { id: "tag" } },
            conditions: [],
            targets: [target],
            remainingTargets: new Set([target]),
            disabled: false,
            finished: false,
        });
        const snapshot = manager.captureState();
        const before = JSON.stringify(snapshot);
        const duplicate = {
            ...snapshot,
            instances: [{
                ...snapshot.instances[0],
                remainingTargets: ["Target|1|2|3", "Target|1|2|3"],
            }],
        };
        expect(() => manager.restoreState(duplicate, { strict: true })).toThrow(/duplicate/i);
        expect(JSON.stringify(manager.captureState())).toBe(before);
        expect(() => manager.restoreState({ ...snapshot, instances: [] }, { strict: true }))
            .toThrow(/incomplete/i);
        expect(JSON.stringify(manager.captureState())).toBe(before);
    });

    test("routes scoped variables without using scope as initial truth", () => {
        const manager = new TriggerManager();
        const variables = new Map<number, Variable>([
            [0, new Variable("campaign", false, true)],
            [1, new Variable("mission", false, false)],
        ]);
        manager.init({
            map: {
                getInitialMapObjects: () => ({ technos: [] }),
                getCellTags: () => [],
                getVariables: () => variables,
                getTriggers: () => [],
            },
            events: { subscribe: () => ({ dispose: () => {} }) },
        } as any);
        manager.toggleGlobalVariable("0", true);
        manager.toggleLocalVariable("1", true);
        expect(manager.getGlobalVariable("0")).toBe(true);
        expect(manager.getLocalVariable("1")).toBe(true);
        expect(manager.captureState().globalVariables).toEqual([["0", true]]);
        expect(manager.captureState().localVariables).toEqual([["1", true]]);
    });
});
