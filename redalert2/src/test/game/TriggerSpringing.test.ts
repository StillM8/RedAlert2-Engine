import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { TagRepeatType } from "@/data/map/tag/TagRepeatType";
import { TagsReader } from "@/data/map/tag/TagsReader";
import { TriggerReader } from "@/data/map/trigger/TriggerReader";
import { TriggerEventType } from "@/data/map/trigger/TriggerEventType";
import { EventType } from "@/game/event/EventType";
import { GameEventBus } from "@/game/GameEventBus";
import { ObjectType } from "@/engine/type/ObjectType";
import { TriggerManager } from "@/game/trigger/TriggerManager";

function section(name: string, entries: Record<string, string> = {}): IniSection {
    const result = new IniSection(name);
    for (const [key, value] of Object.entries(entries)) {
        result.set(key, value);
    }
    return result;
}

function condition(eventType: number, eventIndex: number, matches: (events: any[]) => boolean) {
    return {
        event: { type: eventType, eventIndex },
        temporal: true,
        rememberable: true,
        blocking: false,
        targets: [] as any[],
        check: (_context: any, events: any[]) => matches(events),
        reset: () => {},
        setTargets(targets: any[]) {
            this.targets = targets;
        },
    };
}

function addInstance(
    manager: TriggerManager,
    lifetime: TagRepeatType,
    conditions: any[],
    targets: any[],
    id = "T",
) {
    const tag = { id: `tag-${id}`, repeatType: lifetime };
    for (const target of targets) {
        target.tag = tag;
    }
    const trigger: any = {
        id,
        name: id,
        disabled: false,
        difficulties: { easy: true, medium: true, hard: true },
        tag,
        events: conditions.map(entry => entry.event),
        actions: [],
    };
    const instance: any = {
        trigger,
        conditions,
        targets: [...targets],
        remainingTargets: new Set(targets),
        disabled: false,
        finished: false,
        eventMarks: new Set<number>(),
        markedForDestruction: false,
    };
    (manager as any).triggerInstances.set(id, instance);
    return { instance, tag, trigger };
}

function observeActions(manager: TriggerManager): any[][] {
    const fired: any[][] = [];
    (manager as any).executeActions = (_trigger: any, targets: any[]) => {
        fired.push(targets);
    };
    return fired;
}

function context() {
    return { difficulty: "normal" } as any;
}

describe("RA2 trigger springing phase one", () => {
    test("uses canonical tag lifetimes and keeps legacy enum aliases", () => {
        expect(TagRepeatType.Volatile).toBe(0);
        expect(TagRepeatType.SemiPersistent).toBe(1);
        expect(TagRepeatType.Persistent).toBe(2);
        expect(TagRepeatType.OnceAny).toBe(TagRepeatType.Volatile);
        expect(TagRepeatType.OnceAll).toBe(TagRepeatType.SemiPersistent);
        expect(TagRepeatType.Repeat).toBe(TagRepeatType.Persistent);
        const tags = new TagsReader().read(section("Tags", {
            a: "0,Volatile,T",
            b: "1,Semi,T",
            c: "2,Persistent,T",
            d: "Empty,<none>",
        }));
        expect(tags.map(tag => tag.lifetime)).toEqual([0, 1, 2, 0]);
        expect(tags.map(tag => tag.repeatType)).toEqual([0, 1, 2, 0]);
        expect(tags[3].name).toBe("Empty");
        expect(tags[3].triggerId).toBe("<none>");
    });

    test("binds static object attachments during initialization", () => {
        const events = new GameEventBus();
        const tag: any = { id: "static-tag", repeatType: TagRepeatType.Persistent };
        const target: any = {
            name: "Vehicle",
            type: ObjectType.Vehicle,
            rx: 0,
            ry: 0,
            tag,
            isTechno: () => true,
        };
        const tile: any = { rx: 0, ry: 0, tag };
        const trigger: any = {
            id: "static-trigger",
            name: "static-trigger",
            houseName: "<none>",
            disabled: false,
            difficulties: { easy: true, medium: true, hard: true },
            tag,
            events: [{
                triggerId: "static-trigger",
                eventIndex: 0,
                type: TriggerEventType.DestroyedByAny,
                params: [0, "0"],
            }],
            actions: [],
        };
        const context: any = {
            difficulty: "normal",
            events,
            map: {
                getInitialMapObjects: () => ({
                    technos: [{ name: "Vehicle", type: ObjectType.Vehicle, rx: 0, ry: 0, tag: "static-tag" }],
                }),
                getCellTags: () => [],
                getTags: () => [tag],
                getVariables: () => new Map(),
                getTriggers: () => [trigger],
                tiles: { getByMapCoords: () => tile },
                getObjectsOnTile: () => [target],
            },
        };
        const manager = new TriggerManager();
        manager.init(context);
        const fired = observeActions(manager);
        events.dispatch({ type: EventType.ObjectDestroy, target });
        manager.update(context);
        expect(fired).toHaveLength(1);
        expect((manager as any).triggerInstances.has("static-trigger")).toBe(true);
        expect(target.tag).toBe(tag);
    });

    test("parses the eighth trigger field as mustTransfer", () => {
        const result = new TriggerReader().read(
            section("Triggers", { T: "Allied,,Test,0,1,1,1,1" }),
            section("Events"),
            section("Actions"),
            [{ id: "tag", triggerId: "T", repeatType: 0, name: "Test" }],
        );
        expect(result.triggers[0].mustTransfer).toBe(true);
    });

    test("remembers temporal events across frames only for persistent tags", () => {
        const eventA = 700;
        const eventB = 701;
        const make = (lifetime: TagRepeatType) => {
            const manager = new TriggerManager();
            const first = condition(eventA, 0, events => events.some(event => event.type === eventA));
            const second = condition(eventB, 1, events => events.some(event => event.type === eventB));
            addInstance(manager, lifetime, [first, second], [{ name: "target", type: 1, rx: 0, ry: 0 }]);
            const fired = observeActions(manager);
            return { manager, fired };
        };
        const persistent = make(TagRepeatType.Persistent);
        (persistent.manager as any).pendingGameEvents.push({ type: eventA });
        persistent.manager.update(context());
        expect(persistent.fired).toHaveLength(0);
        expect([...((persistent.manager as any).triggerInstances.get("T").eventMarks)]).toEqual([0]);
        (persistent.manager as any).pendingGameEvents.push({ type: eventB });
        persistent.manager.update(context());
        expect(persistent.fired).toHaveLength(1);
        (persistent.manager as any).pendingGameEvents.push({});
        persistent.manager.update(context());
        expect(persistent.fired).toHaveLength(2);

        const volatile = make(TagRepeatType.Volatile);
        (volatile.manager as any).pendingGameEvents.push({ type: eventA });
        volatile.manager.update(context());
        (volatile.manager as any).pendingGameEvents.push({ type: eventB });
        volatile.manager.update(context());
        expect(volatile.fired).toHaveLength(0);
    });

    test("applies volatile, semi-persistent, and persistent attachment lifetimes", () => {
        const run = (lifetime: TagRepeatType) => {
            const manager = new TriggerManager();
            const object = { name: "object", type: 1, rx: 0, ry: 0 };
            const cell = { name: "cell", type: 2, rx: 1, ry: 0 };
            const eventCondition = condition(TriggerEventType.DestroyedByAny, 0, events =>
                events.filter(event => event.target === object || event.target === cell).map(event => event.target));
            addInstance(manager, lifetime, [eventCondition], [object, cell]);
            const fired = observeActions(manager);
            (manager as any).pendingGameEvents.push({ type: TriggerEventType.ObjectDestroy, target: object });
            manager.update(context());
            (manager as any).pendingGameEvents.push({ type: TriggerEventType.ObjectDestroy, target: cell });
            manager.update(context());
            (manager as any).pendingGameEvents.push({ type: TriggerEventType.ObjectDestroy, target: cell });
            manager.update(context());
            return { manager, fired, object, cell };
        };

        const volatile = run(TagRepeatType.Volatile);
        expect(volatile.fired).toHaveLength(1);
        expect((volatile.manager as any).triggerInstances.has("T")).toBe(false);
        expect(volatile.object.tag).toBeUndefined();
        expect(volatile.cell.tag).toBeUndefined();

        const semi = run(TagRepeatType.SemiPersistent);
        expect(semi.fired).toHaveLength(1);
        expect((semi.manager as any).triggerInstances.has("T")).toBe(false);
        expect(semi.object.tag).toBeUndefined();
        expect(semi.cell.tag).toBeUndefined();

        const persistent = run(TagRepeatType.Persistent);
        expect(persistent.fired).toHaveLength(3);
        expect((persistent.manager as any).triggerInstances.has("T")).toBe(true);
        expect(persistent.object.tag).toBe((persistent.manager as any).tagRuntimes.get("tag-T")?.tag);
        expect(persistent.cell.tag).toBe((persistent.manager as any).tagRuntimes.get("tag-T")?.tag);
    });

    test("walks a linked trigger chain before deferred tag release", () => {
        const manager = new TriggerManager();
        const target = { name: "target", type: 1, rx: 0, ry: 0 };
        const tag = { id: "chain-tag", repeatType: TagRepeatType.Volatile };
        target.tag = tag;
        const makeTrigger = (id: string, attachedTrigger?: any) => ({
            id,
            name: id,
            disabled: false,
            difficulties: { easy: true, medium: true, hard: true },
            tag,
            attachedTrigger,
            events: [],
            actions: [],
        });
        const firstTrigger = makeTrigger("first");
        const secondTrigger = makeTrigger("second");
        firstTrigger.attachedTrigger = secondTrigger;
        const makeInstance = (id: string, trigger: any, eventIndex: number) => ({
            trigger,
            conditions: [condition(TriggerEventType.DestroyedByAny, eventIndex, events =>
                events.filter(event => event.target === target).map(event => event.target))],
            targets: [target],
            remainingTargets: new Set([target]),
            disabled: false,
            finished: false,
            eventMarks: new Set<number>(),
            markedForDestruction: false,
        });
        (manager as any).triggerInstances.set("first", makeInstance("first", firstTrigger, 0));
        (manager as any).triggerInstances.set("second", makeInstance("second", secondTrigger, 0));
        const fired = observeActions(manager);
        (manager as any).pendingGameEvents.push({ type: TriggerEventType.ObjectDestroy, target });
        manager.update(context());
        expect(fired).toHaveLength(2);
        expect((manager as any).triggerInstances.size).toBe(0);
        expect(target.tag).toBeUndefined();
    });

    test("defers destroyTag until the end of the trigger pass", () => {
        const manager = new TriggerManager();
        const target = { name: "target", type: 1, rx: 0, ry: 0 };
        const eventCondition = condition(TriggerEventType.DestroyedByAny, 0, () => false);
        const { instance } = addInstance(manager, TagRepeatType.Persistent, [eventCondition], [target]);
        manager.destroyTag("tag-T");
        expect((manager as any).triggerInstances.has("T")).toBe(true);
        expect(instance.markedForDestruction).toBe(false);
        manager.update(context());
        expect((manager as any).triggerInstances.has("T")).toBe(false);
        expect(target.tag).toBeUndefined();
    });

    test("force trigger refuses disabled and destruction-marked triggers", () => {
        const manager = new TriggerManager();
        const { instance } = addInstance(manager, TagRepeatType.Persistent, [], []);
        const fired = observeActions(manager);
        instance.disabled = true;
        manager.forceTrigger("T", context());
        expect(fired).toHaveLength(0);
        instance.disabled = false;
        instance.markedForDestruction = true;
        manager.forceTrigger("T", context());
        expect(fired).toHaveLength(0);
    });

    test("round-trips marks, attachment state, and destruction state in snapshots and hashes", () => {
        const source = new TriggerManager();
        const sourceParts = addInstance(source, TagRepeatType.SemiPersistent, [
            condition(TriggerEventType.PickupCrate, 0, () => false),
            condition(TriggerEventType.DestroyedByAny, 1, () => false),
        ], [
            { name: "A", type: 1, rx: 2, ry: 3 },
            { name: "B", type: 1, rx: 5, ry: 6 },
        ]);
        sourceParts.instance.eventMarks.add(1);
        sourceParts.instance.disabled = true;
        sourceParts.instance.markedForDestruction = true;
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const target = new TriggerManager();
        addInstance(target, TagRepeatType.SemiPersistent, [
            condition(TriggerEventType.PickupCrate, 0, () => false),
            condition(TriggerEventType.DestroyedByAny, 1, () => false),
        ], [
            { name: "A", type: 1, rx: 2, ry: 3 },
            { name: "B", type: 1, rx: 5, ry: 6 },
        ]);
        target.restoreState(snapshot, { strict: true });
        expect(target.captureState()).toEqual(source.captureState());
        expect(target.getHash()).toBe(source.getHash());

        const changed = new TriggerManager();
        addInstance(changed, TagRepeatType.Persistent, [
            condition(TriggerEventType.PickupCrate, 0, () => false),
        ], []);
        expect(changed.getHash()).not.toBe(source.getHash());
    });
});
