import { describe, expect, test } from "bun:test";
import { EnterTransportOrder } from "@/game/order/EnterTransportOrder";
import { EnterTransportTask } from "@/game/gameobject/task/EnterTransportTask";
import { TransportTrait } from "@/game/gameobject/trait/TransportTrait";
import {
    registerAresPassengerRules,
} from "@/extensions/ares/AresPassengers";

/**
 * Proves the LIVE boarding path (player order -> entry task -> shared
 * TransportTrait hold) consumes the Ares Specific Passengers gates, not just
 * the normalized helpers in isolation.
 *
 * The order and task objects here are the real production classes; only the
 * game world around them is stubbed, mirroring how order-layer regression
 * tests exercise these classes.
 */

function iniSection(entries: Record<string, string>): { entries: Map<string, string | string[]> } {
    return { entries: new Map(Object.entries(entries)) };
}

interface StubUnitOptions {
    name: string;
    size?: number;
    friendly?: boolean;
    inAir?: boolean;
    mindControlled?: boolean;
}

function stubUnit(options: StubUnitOptions): any {
    const unit: any = {
        name: options.name,
        rules: {
            name: options.name,
            size: options.size ?? 1,
            speedType: "Foot",
        },
        tile: { rx: 5, ry: 5, z: 0 },
        onBridge: false,
        zone: options.inAir ? "Air" : "Ground",
        isVehicle: () => false,
        isInfantry: () => true,
        moveTrait: { moveState: 0, isDisabled: () => false },
        warpedOutTrait: { isActive: () => false },
        mindControllableTrait: { isActive: () => options.mindControlled === true },
        mindControllerTrait: { isActive: () => false },
        unitOrderTrait: {
            tasks: [],
            addTask(task: any): void {
                this.tasks.push(task);
            },
        },
    };
    return unit;
}

function stubTransport(rulesIni: Record<string, string>): any {
    const rulesObject: any = { name: "STGN", passengers: 3, sizeLimit: 3 };
    const section = iniSection(rulesIni);
    const extension = registerAresPassengerRules(rulesObject, section);
    void extension;
    const transport: any = {
        name: "STGN",
        rules: rulesObject,
        tile: { rx: 5, ry: 5, z: 0 },
        onBridge: false,
        zone: "Ground",
        direction: 0,
        isDestroyed: false,
        isCrashing: false,
        isVehicle: () => true,
        isInfantry: () => false,
        moveTrait: { moveState: 0 },
        warpedOutTrait: { isActive: () => false },
    };
    transport.transportTrait = new TransportTrait(transport);
    return transport;
}

function stubGame(friendly: boolean): any {
    return {
        map: {
            tileOccupation: { isTileOccupiedBy: () => true },
            terrain: { getPassableSpeed: () => 1 },
        },
        areFriendly: () => friendly,
        getUnitSelection: () => ({
            getOrCreateSelectionModel: () => ({ getControlGroupNumber: () => undefined }),
        }),
        events: { dispatch: () => undefined },
        limboObject: (unit: any, data: any) => {
            unit.limboData = data;
        },
    };
}

describe("Ares Specific Passengers live boarding path", () => {
    test("EnterTransportOrder refuses a disallowed passenger type at order time", () => {
        const transport = stubTransport({
            "Passengers.Allowed": "E1",
        });
        const outsider = stubUnit({ name: "GI" });
        const game = stubGame(true);

        const order = new EnterTransportOrder(game);
        order.sourceObject = outsider;
        order.target = { obj: transport };

        // The order-level cursor gate must reject before any task exists.
        expect(order.isValid()).toBe(true);
        expect(order.isAllowed()).toBe(false);

        // And the task's final-entry guard agrees independently.
        const task = new EnterTransportTask(game, transport);
        expect(task.isAllowed(outsider)).toBe(false);
    });

    test("EnterTransportOrder admits an allowed type through order and task", () => {
        const transport = stubTransport({
            "Passengers.Allowed": "E1,GGI",
        });
        const insider = stubUnit({ name: "GGI" });
        const game = stubGame(true);

        const order = new EnterTransportOrder(game);
        order.sourceObject = insider;
        order.target = { obj: transport };

        expect(order.isAllowed()).toBe(true);
        const task = new EnterTransportTask(game, transport);
        expect(task.isAllowed(insider)).toBe(true);
    });

    test("Disallowed wins over Allowed on the live path", () => {
        const transport = stubTransport({
            "Passengers.Allowed": "E1,TANY",
            "Passengers.Disallowed": "TANY",
        });
        const tanya = stubUnit({ name: "TANY" });
        const game = stubGame(true);

        const task = new EnterTransportTask(game, transport);
        expect(task.isAllowed(tanya)).toBe(false);
    });

    test("an oversized passenger is refused even when its type is allowed", () => {
        const transport = stubTransport({
            "Passengers.Allowed": "TRUCK,BIGRIG",
            SizeLimit: "2",
        });
        (transport.rules as any).sizeLimit = 2;
        const big = stubUnit({ name: "BIGRIG", size: 4 });

        const game = stubGame(true);
        const task = new EnterTransportTask(game, transport);
        expect(task.isAllowed(big)).toBe(false);
    });

    test("boarding through the task limbos the passenger into the shared hold", () => {
        const transport = stubTransport({});
        const rider = stubUnit({ name: "E1" });
        const game = stubGame(true);

        // Drive the production flow: the ORDER creates the task that boards.
        const order = new EnterTransportOrder(game);
        order.sourceObject = rider;
        order.target = { obj: transport };
        expect(order.isAllowed()).toBe(true);
        const tasks = order.process();
        expect(tasks).toHaveLength(1);
        const task = tasks[0];
        expect(task).toBeInstanceOf(EnterTransportTask);

        // Simulate MoveInside completion: the passenger is co-located with the
        // transport on the same layer, then the task's enter state runs.
        (rider as any).movePerformed = true;
        task.onStart(rider);
        task.onTick(rider);
        // The task requested the enter transition; a second tick performs it.
        task.onTick(rider);
        expect(rider.limboData?.inTransport).toBe(true);
        expect(transport.transportTrait.units).toContain(rider);
    });

    test("a full hold refuses further passengers at both gates", () => {
        const transport = stubTransport({ "Passengers.BySize": "no" });
        (transport.rules as any).passengers = 1;
        const game = stubGame(true);
        const first = stubUnit({ name: "E1" });
        const second = stubUnit({ name: "E2" });

        first.limboData = { selected: false, inTransport: true };
        transport.transportTrait.units.push(first);

        const order = new EnterTransportOrder(game);
        order.sourceObject = second;
        order.target = { obj: transport };
        expect(order.isAllowed()).toBe(false);

        // The task's final-entry guard independently refuses as well.
        const task = new EnterTransportTask(game, transport);
        expect(task.isAllowed(second)).toBe(false);
    });
});
