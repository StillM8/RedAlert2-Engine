import { describe, expect, test } from "bun:test";
import { Production } from "@/game/player/production/Production";
import {
    ProductionQueue,
    QueueStatus,
    QueueType,
} from "@/game/player/production/ProductionQueue";
import { ProductionTrait } from "@/game/trait/ProductionTrait";
import { FactoryType } from "@/game/rules/TechnoRules";
import { ObjectType } from "@/engine/type/ObjectType";
import { Player } from "@/game/Player";

const infantry = { name: "InfantryA", type: 1, cost: 100, buildTimeMultiplier: 1 };
const vehicle = { name: "VehicleB", type: 2, cost: 200, buildTimeMultiplier: 1 };

function queue(): ProductionQueue {
    return new ProductionQueue(QueueType.Infantry, 10, 10);
}

function queueWith(item: any, quantity = 1): ProductionQueue {
    const result = queue();
    result.push(item, quantity, item.cost);
    return result;
}

describe("production queue deterministic state", () => {
    test("hashes ordered items and every mutable progress field", () => {
        const orderedAB = queue();
        orderedAB.push(infantry, 1, 100);
        orderedAB.push(vehicle, 1, 200);
        const orderedBA = queue();
        orderedBA.push(vehicle, 1, 200);
        orderedBA.push(infantry, 1, 100);
        expect(orderedAB.getHash()).not.toBe(orderedBA.getHash());

        const variants = [
            (value: ProductionQueue) => { value.status = QueueStatus.OnHold; },
            (value: ProductionQueue) => { (value.getFirst() as any).quantity = 2; (value as any).size = 2; },
            (value: ProductionQueue) => { (value.getFirst() as any).creditsSpent = 1; },
            (value: ProductionQueue) => { (value.getFirst() as any).creditsSpentLeftover = 0.25; },
            (value: ProductionQueue) => { (value.getFirst() as any).progress = 0.5; },
        ];
        for (const mutate of variants) {
            const baseline = queueWith(infantry);
            const variant = queueWith(infantry);
            mutate(variant);
            expect(variant.getHash()).not.toBe(baseline.getHash());
        }
    });

    test("round-trips rules by authored TechnoType identity and preserves order", () => {
        const source = queue();
        source.push(infantry, 2, 100);
        source.push(vehicle, 1, 200);
        (source.getFirst() as any).creditsSpent = 37;
        (source.getFirst() as any).creditsSpentLeftover = 0.625;
        (source.getFirst() as any).progress = 0.37;
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const restored = queue();
        restored.restoreState(snapshot, {
            strict: true,
            resolveRules: name => ({ InfantryA: infantry, VehicleB: vehicle } as any)[name],
        });
        expect(restored.captureState()).toEqual(snapshot);
        expect(restored.getAll().map(item => item.rules)).toEqual([infantry, vehicle]);
        expect(restored.getHash()).toBe(source.getHash());
    });

    test("full Production state restores queues and Ares extension state transactionally", () => {
        const source = new Production({}, 9, {}, {}, []);
        (source as any).buildSpeedModifier = 0.5;
        const sourceQueue = queue();
        sourceQueue.push(infantry, 2, 100);
        source.addQueue(QueueType.Infantry, sourceQueue);
        source.addStolenTech(2);
        source.addReverseEngineeredPlan("VehicleB");
        const snapshot = JSON.parse(JSON.stringify(source.captureState()));

        const destination = new Production({}, 9, {}, {}, []);
        const destinationQueue = queueWith(vehicle);
        destination.addQueue(QueueType.Infantry, destinationQueue);
        destination.restoreDeterministicState(snapshot, {
            strict: true,
            resolveRules: name => ({ InfantryA: infantry, VehicleB: vehicle } as any)[name],
        });
        expect(destination.captureState()).toEqual(snapshot);
        expect(destination.getHash()).toBe(source.getHash());

        const before = destination.captureState();
        const invalid = structuredClone(snapshot) as any;
        invalid.queues[0].items[0].technoTypeName = "MissingType";
        expect(() => destination.restoreDeterministicState(invalid, {
            strict: true,
            resolveRules: name => name === "MissingType" ? undefined : infantry,
        })).toThrow(/unresolved/);
        expect(destination.captureState()).toEqual(before);
    });

    test("hashes and restores infiltration-granted veteran factory types", () => {
        const withoutInfiltration = new Production({}, 9, {}, {}, []);
        const withInfiltration = new Production({}, 9, {}, {}, []);
        withInfiltration.addVeteranType(FactoryType.UnitType);
        expect(withInfiltration.getHash()).not.toBe(withoutInfiltration.getHash());

        const productionPlayer: any = {
            production: withInfiltration,
            country: { hasVeteranUnit: () => false },
        };
        const vehicle = {
            name: "FutureTank",
            type: ObjectType.Vehicle,
            owner: productionPlayer,
            buildLimit: 0,
        };
        expect(Player.prototype.canProduceVeteran.call(productionPlayer, vehicle as any)).toBe(true);

        const snapshot = JSON.parse(JSON.stringify(withInfiltration.captureState()));
        const restored = new Production({}, 9, {}, {}, []);
        restored.restoreDeterministicState(snapshot, { strict: true });
        expect(restored.hasVeteranType(FactoryType.UnitType)).toBe(true);
        expect(restored.getHash()).toBe(withInfiltration.getHash());

        const before = restored.captureState();
        const invalid = structuredClone(snapshot) as any;
        invalid.veteranFactoryTypes = [999];
        expect(() => restored.restoreDeterministicState(invalid)).toThrow(/veteranFactoryTypes/);
        expect(restored.captureState()).toEqual(before);
    });

    test("rebuilds factory counts and primary selection from canonical object IDs", () => {
        const first = { id: 20, name: "WarFactoryB", rules: { factory: FactoryType.UnitType } };
        const second = { id: 10, name: "WarFactoryA", rules: { factory: FactoryType.UnitType } };
        const barracks = { id: 30, name: "Barracks", rules: { factory: FactoryType.InfantryType } };
        const player: any = { buildings: new Set([first, second, barracks]) };
        const production = new Production(player, 9, {}, {}, []);

        production.rebuildFactoryDerivedState();

        expect(production.getFactoryCount(FactoryType.UnitType)).toBe(2);
        expect(production.getFactoryCount(FactoryType.InfantryType)).toBe(1);
        expect(production.getPrimaryFactory(FactoryType.UnitType)).toBe(second);
        expect(production.getPrimaryFactory(FactoryType.InfantryType)).toBe(barracks);
        expect(production.hasAnyFactory()).toBe(true);

        player.buildings.delete(second);
        production.rebuildFactoryDerivedState();
        expect(production.getFactoryCount(FactoryType.UnitType)).toBe(1);
        expect(production.getPrimaryFactory(FactoryType.UnitType)).toBe(first);
    });

    test("snapshots explicit primary-factory selection separately from derived counts", () => {
        const first = { id: 20, name: "WarFactoryB", rules: { factory: FactoryType.UnitType } };
        const second = { id: 10, name: "WarFactoryA", rules: { factory: FactoryType.UnitType } };
        const sourcePlayer: any = { buildings: new Set([first, second]) };
        const source = new Production(sourcePlayer, 9, {}, {}, []);
        source.setPrimaryFactory(first);
        const defaultSelection = new Production({ buildings: new Set([first, second]) }, 9, {}, {}, []);

        expect(source.getPrimaryFactory(FactoryType.UnitType)).toBe(first);
        expect(source.getHash()).not.toBe(defaultSelection.getHash());

        const snapshot = JSON.parse(JSON.stringify(source.captureState()));
        expect(snapshot.primaryFactoryObjectIds).toEqual([{ factoryType: FactoryType.UnitType, objectId: 20 }]);

        const destinationPlayer: any = { buildings: new Set([first, second]) };
        const destination = new Production(destinationPlayer, 9, {}, {}, []);
        destination.setPrimaryFactory(second);
        destination.restoreDeterministicState(snapshot, {
            strict: true,
            resolveObjectById: id => [first, second].find(factory => factory.id === id),
        });
        expect(destination.getFactoryCount(FactoryType.UnitType)).toBe(2);
        expect(destination.getPrimaryFactory(FactoryType.UnitType)).toBe(first);
        expect(destination.captureState()).toEqual(snapshot);
        expect(destination.getHash()).toBe(source.getHash());

        const before = destination.captureState();
        const unresolved = structuredClone(snapshot) as any;
        unresolved.primaryFactoryObjectIds[0].objectId = 999;
        expect(() => destination.restoreDeterministicState(unresolved, {
            strict: true,
            resolveObjectById: () => undefined,
        })).toThrow(/primary factory/);
        expect(destination.captureState()).toEqual(before);

        const foreignFactory = { id: 20, name: "EnemyWarFactory", rules: { factory: FactoryType.UnitType } };
        expect(() => destination.restoreDeterministicState(snapshot, {
            strict: true,
            resolveObjectById: () => foreignFactory,
        })).toThrow(/not owned by the restoring player/);
        expect(destination.captureState()).toEqual(before);
    });

    test("rejects impossible queue status and per-type quantity combinations transactionally", () => {
        const source = queueWith(infantry);
        const restored = queueWith(vehicle);
        const before = restored.captureState();

        const idleWithItems = structuredClone(source.captureState()) as any;
        idleWithItems.status = QueueStatus.Idle;
        expect(() => restored.restoreState(idleWithItems, { strict: true, resolveRules: () => infantry }))
            .toThrow(/non-empty queue cannot be idle/);
        expect(restored.captureState()).toEqual(before);

        const readyWithoutCompletion = structuredClone(source.captureState()) as any;
        readyWithoutCompletion.status = QueueStatus.Ready;
        readyWithoutCompletion.items[0].progress = 0;
        expect(() => restored.restoreState(readyWithoutCompletion, { strict: true, resolveRules: () => infantry }))
            .toThrow(/ready queue/);
        expect(restored.captureState()).toEqual(before);

        const perTypeOverflow = structuredClone(source.captureState()) as any;
        perTypeOverflow.maxSize = 20;
        perTypeOverflow.maxItemQuantity = 1;
        perTypeOverflow.size = 2;
        perTypeOverflow.items = [
            { ...perTypeOverflow.items[0], quantity: 1 },
            { ...perTypeOverflow.items[0], quantity: 1 },
        ];
        expect(() => restored.restoreState(perTypeOverflow, { strict: true, resolveRules: () => infantry }))
            .toThrow(/maxItemQuantity/);
        expect(restored.captureState()).toEqual(before);
    });

    test("restored progress continues with identical credits and ready tick", () => {
        const source = queueWith(infantry);
        const restored = queue();
        restored.restoreState(JSON.parse(JSON.stringify(source.captureState())), {
            strict: true,
            resolveRules: name => name === infantry.name ? infantry : undefined,
        });

        const makePlayer = (productionQueue: ProductionQueue) => ({
            credits: 150,
            production: {
                getFactoryTypeForQueueType: () => 0,
                hasOperationalFactory: () => true,
                getFactoryCount: () => 1,
                buildSpeedModifier: 1,
                getQueue: () => productionQueue,
            },
        });
        const sourcePlayer: any = makePlayer(source);
        const restoredPlayer: any = makePlayer(restored);
        const trait: any = Object.create(ProductionTrait.prototype);
        trait.baseBuildSpeed = 1;
        trait.speedCheat = { value: false };
        trait.rules = {
            general: { multipleFactory: 1, wallBuildSpeedCoefficient: 1 },
        };
        const gameState: any = { events: { dispatch: () => { } }, rules: trait.rules };
        let readyTick: number | undefined;
        for (let tick = 1; tick <= 110; tick++) {
            trait.tickQueue(source, sourcePlayer, gameState);
            trait.tickQueue(restored, restoredPlayer, gameState);
            expect(restored.captureState()).toEqual(source.captureState());
            expect(restoredPlayer.credits).toBe(sourcePlayer.credits);
            if (source.status === QueueStatus.Ready && readyTick === undefined) {
                readyTick = tick;
                expect(restored.status).toBe(QueueStatus.Ready);
            }
        }
        expect(readyTick).toBe(54);
    });
});
