import { describe, expect, test } from "bun:test";
import {
    applyAresVehicleHijack,
    AresVehicleHijackerTrait,
} from "@/extensions/ares/AresVehicleThief";
import { AresDriverTrait } from "@/extensions/ares/AresKillingDrivers";
import { MindControllableTrait } from "@/game/gameobject/trait/MindControllableTrait";
import { MindControllerTrait } from "@/game/gameobject/trait/MindControllerTrait";
import { EnterRecyclerTask } from "@/game/gameobject/task/EnterRecyclerTask";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";

function player(name: string, neutral = false): any {
    return {
        name,
        isNeutral: neutral,
        defeated: false,
        credits: 0,
        addOwnedObject(object: any) { object.owner = this; },
        removeOwnedObject() { },
    };
}

function driver(owner: any, rules: Record<string, any> = {}): any {
    return {
        name: "HIJACKER",
        owner,
        isInfantry: () => true,
        isSpawned: true,
        isDestroyed: false,
        isCrashing: false,
        rules: {
            vehicleThief: true,
            canDrive: false,
            hijackerBreakMindControl: true,
            hijackerOneTime: false,
            ...rules,
        },
        position: { tile: { rx: 4, ry: 4 } },
        healthTrait: { health: 81 },
    };
}

function vehicle(owner: any, rules: Record<string, any> = {}): any {
    return {
        name: "TARGETVEHICLE",
        owner,
        isVehicle: () => true,
        isAircraft: () => false,
        isSpawned: true,
        isDestroyed: false,
        isCrashing: false,
        zone: 0,
        rules: {
            hijackerAllowed: true,
            operator: [],
            operatorAny: false,
            ...rules,
        },
        position: { tile: { rx: 4, ry: 4 } },
        aresDriverTrait: new AresDriverTrait(),
        transportTrait: { units: [] },
        unitOrderTrait: { clearOrders() { }, cancelAllTasks() { } },
        moveTrait: { disabled: true, setDisabled(value: boolean) { this.disabled = value; } },
        attackTrait: { disabled: true, setDisabled(value: boolean) { this.disabled = value; } },
    };
}

function gameFor(): any {
    return {
        areAllied: () => false,
        changeObjectOwner(object: any, owner: any) { object.owner = owner; },
        limboObject(object: any, data: any) {
            object.limboData = data;
            object.isSpawned = false;
        },
        unlimboObject(object: any, tile: any) {
            object.limboData = undefined;
            object.position.tile = tile;
            object.isSpawned = true;
        },
        destroyObject(object: any) {
            object.isDestroyed = true;
            object.isSpawned = false;
        },
    };
}

function control(controller: any, target: any, game: any): void {
    controller.mindControllerTrait ??= new MindControllerTrait(controller as any, 8);
    target.mindControllableTrait = new MindControllableTrait(target as any);
    controller.mindControllerTrait.control(target as any, game as any);
}

describe("VehicleThief and mind-control lifecycle", () => {
    test("uses the hijacker's original owner and removes its stale controller link", () => {
        const originalOwner = player("Original");
        const controllerOwner = player("Controller");
        const enemyOwner = player("Enemy");
        const game = gameFor();
        const controller = { name: "CONTROLLER", owner: controllerOwner };
        const hijacker = driver(originalOwner);
        const target = vehicle(enemyOwner);
        control(controller, hijacker, game);

        expect(hijacker.owner).toBe(controllerOwner);
        expect(applyAresVehicleHijack(hijacker, target, game)).toBe(true);
        expect(target.owner).toBe(originalOwner);
        expect(controller.mindControllerTrait.getTargets()).toEqual([]);
        expect(hijacker.mindControllableTrait.isActive()).toBe(false);
    });

    test("cleans a captured vehicle's controller and transfers a hijacker controller when possible", () => {
        const hijackerOwner = player("Hijacker");
        const enemyOwner = player("Enemy");
        const targetControllerOwner = player("TargetController");
        const game = gameFor();
        const targetController = { name: "TARGET_CONTROLLER", owner: targetControllerOwner };
        const hijacker = driver(hijackerOwner);
        const target = vehicle(enemyOwner);
        control(targetController, target, game);

        expect(applyAresVehicleHijack(hijacker, target, game)).toBe(true);
        expect(targetController.mindControllerTrait.getTargets()).toEqual([]);
        expect(target.mindControllableTrait.isActive()).toBe(false);
        expect(target.owner).toBe(hijackerOwner);

        const mindControlledHijacker = driver(hijackerOwner);
        const hijackerController = { name: "HIJACKER_CONTROLLER", owner: targetControllerOwner };
        control(hijackerController, mindControlledHijacker, game);
        const secondTarget = vehicle(enemyOwner);
        secondTarget.mindControllableTrait = new MindControllableTrait(secondTarget as any);

        expect(applyAresVehicleHijack(mindControlledHijacker, secondTarget, game)).toBe(true);
        expect(hijackerController.mindControllerTrait.getTargets()).toEqual([secondTarget]);
        expect(secondTarget.mindControllableTrait.getController()).toBe(hijackerController);
    });

    test("plays leave sound and restores the saved veterancy on recovery", () => {
        const trait = new AresVehicleHijackerTrait();
        const hijacker = driver(player("Hijacker"), {
            vehicleThief: true,
            hijackerLeaveSound: "HijackerLeave",
        });
        hijacker.limboData = { inTransport: true };
        hijacker.isSpawned = false;
        hijacker.veteranTrait = { veteranLevel: 2 };
        trait.remember(hijacker, hijacker.rules);
        hijacker.veteranTrait.veteranLevel = 0;
        const stolenVehicle = vehicle(player("Enemy"));
        const sounds: string[] = [];
        const game = {
            unlimboObject(object: any, tile: any) {
                object.limboData = undefined;
                object.position.tile = tile;
                object.isSpawned = true;
            },
            playSoundAt(sound: string) { sounds.push(sound); },
        };

        trait[NotifyDestroy.onDestroy](stolenVehicle, game);

        expect(hijacker.healthTrait.health).toBe(40);
        expect(hijacker.veteranTrait.veteranLevel).toBe(2);
        expect(sounds).toEqual(["HijackerLeave"]);
    });

    test("reimburses a stored hijacker through the grinder entry path", () => {
        const grinderOwner = player("Grinder");
        const vehicleOwner = player("VehicleOwner");
        const hijacker = driver(player("Hijacker"), { hijackerOneTime: true });
        const target = vehicle(vehicleOwner);
        const trait = new AresVehicleHijackerTrait();
        target.aresVehicleHijackerTrait = trait;
        trait.remember(hijacker, hijacker.rules);
        const sold: any[] = [];
        const grinder = { owner: grinderOwner };
        const game = {
            sellTrait: {
                computeRefundValue: () => 37,
                sell(object: any) { sold.push(object); },
            },
            events: { dispatch() { } },
        };

        new EnterRecyclerTask(game, grinder).onEnter(target);

        expect(grinderOwner.credits).toBe(37);
        expect(sold).toEqual([target]);
        expect(trait.hasHijacker()).toBe(false);
    });
});
