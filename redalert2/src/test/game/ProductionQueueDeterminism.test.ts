import { describe, expect, test } from "bun:test";
import { Production } from "@/game/player/production/Production";
import {
    ProductionQueue,
    QueueStatus,
    QueueType,
} from "@/game/player/production/ProductionQueue";
import { ProductionTrait } from "@/game/trait/ProductionTrait";

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
