import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import {
    applyAresVehicleHijack,
    getAresVehicleHijackAction,
    AresVehicleHijackerTrait,
} from "@/extensions/ares/AresVehicleThief";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { TechnoRules } from "@/game/rules/TechnoRules";
import { AresDriverTrait } from "@/extensions/ares/AresKillingDrivers";
import { CaptureOrder } from "@/game/order/CaptureOrder";
import { HijackVehicleTask } from "@/game/gameobject/task/HijackVehicleTask";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";

function player(name: string, neutral = false): any {
    return {
        name,
        isNeutral: neutral,
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
            vehicleThief: false,
            canDrive: false,
            hijackerBreakMindControl: true,
            hijackerOneTime: false,
            ...rules,
        },
        position: { tile: { rx: 4, ry: 4 } },
        healthTrait: { health: 100 },
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

function gameFor(target: any, recovered: any[] = []): any {
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
            recovered.push(object);
        },
        destroyObject(object: any) {
            object.isDestroyed = true;
            object.isSpawned = false;
        },
    };
}

describe("Ares Vehicle Thief", () => {
    test("parses VehicleThief and Antares hijacker extensions", () => {
        const section = new IniSection("Hijacker");
        section.set("VehicleThief", "yes");
        section.set("VehicleThief.EnterSound", "HijackEnter");
        section.set("VehicleThief.LeaveSound", "HijackLeave");
        section.set("VehicleThief.KillPilots", "-1");
        section.set("VehicleThief.BreakMindControl", "no");
        section.set("VehicleThief.OneTime", "yes");
        const rules = new TechnoRules(ObjectType.Infantry, section, 0, {}, new ArmorRegistry());
        expect(rules.vehicleThief).toBe(true);
        expect(rules.hijackerEnterSound).toBe("HijackEnter");
        expect(rules.hijackerLeaveSound).toBe("HijackLeave");
        expect(rules.hijackerKillPilots).toBe(-1);
        expect(rules.hijackerBreakMindControl).toBe(false);
        expect(rules.hijackerOneTime).toBe(true);

        const targetSection = new IniSection("Hijackable");
        targetSection.set("VehicleThief.Allowed", "no");
        const targetRules = new TechnoRules(ObjectType.Vehicle, targetSection, 0, {}, new ArmorRegistry());
        expect(targetRules.hijackerAllowed).toBe(false);
    });

    test("VehicleThief takes eligible enemy vehicles but not allies or opted-out targets", () => {
        const thiefOwner = player("Thief");
        const enemyOwner = player("Enemy");
        const thief = driver(thiefOwner, { vehicleThief: true });
        const target = vehicle(enemyOwner);
        const game = gameFor(target);
        expect(getAresVehicleHijackAction(thief, target, game)).toBe("hijack");

        const alliedGame = { ...game, areAllied: () => true };
        expect(getAresVehicleHijackAction(thief, target, alliedGame)).toBe("none");
        target.rules.hijackerAllowed = false;
        expect(getAresVehicleHijackAction(thief, target, game)).toBe("none");
    });

    test("CanDrive reclaims a neutral DriverKilled vehicle", () => {
        const owner = player("Driver");
        const civilian = player("Civilian", true);
        const infantry = driver(owner, { canDrive: true });
        const target = vehicle(civilian, { operatorAny: true });
        target.aresDriverTrait.markDriverKilled();
        const game = gameFor(target);

        expect(getAresVehicleHijackAction(infantry, target, game)).toBe("drive");
        expect(applyAresVehicleHijack(infantry, target, game)).toBe(true);
        expect(target.owner).toBe(owner);
        expect(target.aresDriverTrait.isDriverKilled()).toBe(false);
        expect(target.transportTrait.units).toEqual([infantry]);
        expect(infantry.isDestroyed).toBe(false);
    });

    test("operator hijacks retain the driver as a passenger while generic thieves are recoverable", () => {
        const thiefOwner = player("Thief");
        const enemyOwner = player("Enemy");
        const thief = driver(thiefOwner, { vehicleThief: true });
        const operatorTarget = vehicle(enemyOwner, { operator: ["HIJACKER"] });
        const game = gameFor(operatorTarget);
        expect(applyAresVehicleHijack(thief, operatorTarget, game)).toBe(true);
        // VehicleThief is a generic hijacker, not an Operator driver: it is
        // absorbed and later recovered when the stolen vehicle is destroyed.
        expect(operatorTarget.transportTrait.units).toHaveLength(0);
        expect(operatorTarget.aresVehicleHijackerTrait.hasHijacker()).toBe(true);

        const recovered: any[] = [];
        const recoverTarget = vehicle(enemyOwner);
        const recoverTrait = new AresVehicleHijackerTrait();
        recoverTarget.aresVehicleHijackerTrait = recoverTrait;
        const recoverer = driver(thiefOwner, { vehicleThief: true });
        recoverer.limboData = { inTransport: true };
        recoverer.isSpawned = false;
        recoverer.healthTrait.health = 81;
        recoverTrait.remember(recoverer, recoverer.rules);
        recoverTrait[NotifyDestroy.onDestroy](recoverTarget, gameFor(recoverTarget, recovered));
        expect(recovered).toEqual([recoverer]);
        expect(recoverer.healthTrait.health).toBe(40);
    });

    test("KillPilots applies Antares survivor-count semantics", () => {
        const trait = new AresVehicleHijackerTrait();
        const thief = driver(player("Thief"), { vehicleThief: true, hijackerKillPilots: -1 });
        trait.remember(thief, thief.rules);
        expect(trait.adjustSurvivorPilotCount(3)).toBe(0);
        trait.remember(thief, { ...thief.rules, hijackerKillPilots: 1 });
        expect(trait.adjustSurvivorPilotCount(3)).toBe(2);
        expect(trait.adjustSurvivorPilotCount(0)).toBe(0);
    });

    test("CaptureOrder and its task expose the generic vehicle action to human/AI orders", () => {
        const owner = player("Thief");
        const enemy = player("Enemy");
        const thief = driver(owner, { vehicleThief: true });
        const target = vehicle(enemy);
        const game = gameFor(target);
        const order = new CaptureOrder(game).set(thief, { obj: target, tile: target.tile });
        expect(order.isValid()).toBe(true);
        expect(order.process()[0]).toBeInstanceOf(HijackVehicleTask);
    });

    test("scanner classifies VehicleThief keys independently", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rules-hijackers.ini",
            contents: "[Hijacker]\nVehicleThief=yes\nVehicleThief.OneTime=yes\nVehicleThief.Allowed=no\n",
        }]);
        const usage = report.featureUsage.find(item => item.featureId === "ares.vehicle-thief");
        expect(usage?.occurrences).toBe(3);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
