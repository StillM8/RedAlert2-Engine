import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import {
    applyAresKillDriver,
    AresDriverTrait,
    canAresDriverReclaim,
    isAresDriverKillable,
} from "@/extensions/ares/AresKillingDrivers";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { TechnoRules } from "@/game/rules/TechnoRules";
import { WarheadRules } from "@/game/rules/WarheadRules";

function player(name: string, countryId: string, combatant = true): any {
    return {
        name,
        country: { id: countryId },
        isCombatant: () => combatant,
        addOwnedObject(object: any) { object.owner = this; },
        removeOwnedObject() { },
    };
}

function infantry(name: string, owner: any): any {
    return {
        name,
        owner,
        isInfantry: () => true,
        isDestroyed: false,
        limboData: { inTransport: true },
        position: {},
    };
}

function vehicle(owner: any, overrides: Record<string, any> = {}): any {
    const object: any = {
        name: "TESTVEHICLE",
        owner,
        isSpawned: true,
        isDestroyed: false,
        isCrashing: false,
        isVehicle: () => true,
        isAircraft: () => false,
        isUnit: () => true,
        rules: {
            protectedDriver: false,
            operator: [],
            operatorAny: false,
            natural: false,
            organic: false,
            airportBound: false,
            dock: [],
            ...overrides,
        },
        healthTrait: { health: 100 },
        moveTrait: { disabled: false, setDisabled(value: boolean) { this.disabled = value; } },
        attackTrait: { disabled: false, setDisabled(value: boolean) { this.disabled = value; } },
        unitOrderTrait: { getTasks: () => [] },
        transportTrait: { units: [] },
        position: { tile: { rx: 3, ry: 4 }, tileElevation: 0 },
        zone: 0,
        onBridge: false,
        aresDriverTrait: new AresDriverTrait(),
    };
    return object;
}

function gameFor(target: any, civilian: any, destroyed: any[] = [], ejected: any[] = []): any {
    return {
        getCivilianPlayer: () => civilian,
        getAllPlayers: () => [civilian, target.owner],
        generateRandom: () => 0,
        changeObjectOwner: (object: any, owner: any) => { object.owner = owner; },
        destroyObject: (object: any) => { object.isDestroyed = true; object.limboData = undefined; destroyed.push(object); },
        unlimboObject: (object: any) => { object.limboData = undefined; object.isSpawned = true; ejected.push(object); },
    };
}

describe("Ares Killing Drivers", () => {
    test("parses the documented and Antares 3.0p1 driver fields", () => {
        const technoSection = new IniSection("DriverVehicle");
        technoSection.set("ProtectedDriver", "yes");
        technoSection.set("ProtectedDriver.MinHealth", "25%");
        technoSection.set("CanDrive", "yes");
        const techno = new TechnoRules(ObjectType.Vehicle, technoSection, 0, {}, new ArmorRegistry());
        expect(techno.protectedDriver).toBe(true);
        expect(techno.protectedDriverMinHealth).toBe(0.25);
        expect(techno.canDrive).toBe(true);

        const warheadSection = new IniSection("DriverWarhead");
        warheadSection.set("KillDriver", "yes");
        warheadSection.set("KillDriver.KillBelowPercent", "50%");
        warheadSection.set("KillDriver.Chance", "75%");
        warheadSection.set("KillDriver.Owner", "civilian");
        warheadSection.set("KillDriver.RemoveVeterancy", "yes");
        const warhead = new WarheadRules(warheadSection);
        expect(warhead.killDriver).toBe(true);
        expect(warhead.killDriverBelowPercent).toBe(0.5);
        expect(warhead.killDriverChance).toBe(0.75);
        expect(warhead.killDriverOwner).toBe("civilian");
        expect(warhead.killDriverRemoveVeterancy).toBe(true);
    });

    test("honors vehicle/aircraft eligibility, health threshold, and protection", () => {
        const owner = player("Alpha", "alpha");
        const normal = vehicle(owner);
        expect(isAresDriverKillable(normal, normal.rules)).toBe(true);

        const protectedVehicle = vehicle(owner, { protectedDriver: true });
        expect(isAresDriverKillable(protectedVehicle, protectedVehicle.rules)).toBe(false);

        const damaged = vehicle(owner, { protectedDriver: true, protectedDriverMinHealth: 0.25 });
        damaged.healthTrait.health = 20;
        expect(isAresDriverKillable(damaged, damaged.rules)).toBe(true);

        const dockedAircraft = vehicle(owner, { dock: ["AIRPORT"] });
        dockedAircraft.isVehicle = () => false;
        dockedAircraft.isAircraft = () => true;
        expect(isAresDriverKillable(dockedAircraft, dockedAircraft.rules)).toBe(false);
    });

    test("kills the specific operator, ejects other passengers, and transfers the driverless vehicle", () => {
        const owner = player("Alpha", "alpha");
        const civilian = player("Civilian", "civilian", false);
        const target = vehicle(owner, { operator: ["driver"] });
        const operator = infantry("Driver", owner);
        const passenger = infantry("Passenger", owner);
        target.transportTrait.units = [operator, passenger];
        const destroyed: any[] = [];
        const ejected: any[] = [];

        const applied = applyAresKillDriver(
            target,
            { owner: owner },
            gameFor(target, civilian, destroyed, ejected),
            { killDriver: true, killDriverOwner: "special", affectsAllies: true, affectsEnemies: true },
        );

        expect(applied).toBe(true);
        expect(target.owner).toBe(civilian);
        expect(target.aresDriverTrait.isDriverKilled()).toBe(true);
        expect(target.moveTrait.disabled).toBe(true);
        expect(target.attackTrait.disabled).toBe(true);
        expect(destroyed).toEqual([operator]);
        expect(ejected).toEqual([passenger]);
        expect(target.transportTrait.units).toHaveLength(0);
        expect(target.healthTrait.health).toBe(100);
    });

    test("the _ANY_ operator case removes all passengers", () => {
        const owner = player("Alpha", "alpha");
        const civilian = player("Civilian", "civilian", false);
        const target = vehicle(owner, { operatorAny: true });
        const first = infantry("First", owner);
        const second = infantry("Second", owner);
        target.transportTrait.units = [first, second];
        const destroyed: any[] = [];

        expect(applyAresKillDriver(
            target,
            { owner },
            gameFor(target, civilian, destroyed),
            { killDriver: true },
        )).toBe(true);
        expect(destroyed).toEqual([first, second]);
        expect(target.transportTrait.units).toHaveLength(0);
    });

    test("protected or failed chance targets fall through without driver state changes", () => {
        const owner = player("Alpha", "alpha");
        const civilian = player("Civilian", "civilian", false);
        const protectedVehicle = vehicle(owner, { protectedDriver: true });
        expect(applyAresKillDriver(protectedVehicle, { owner }, gameFor(protectedVehicle, civilian), { killDriver: true })).toBe(false);
        expect(protectedVehicle.owner).toBe(owner);
        expect(protectedVehicle.aresDriverTrait.isDriverKilled()).toBe(false);

        const unlucky = vehicle(owner);
        const unluckyGame = { ...gameFor(unlucky, civilian), generateRandom: () => 0.9 };
        expect(applyAresKillDriver(unlucky, { owner }, unluckyGame, { killDriver: true, killDriverChance: 0.5 })).toBe(false);
        expect(unlucky.owner).toBe(owner);
    });

    test("CanDrive is exposed as a generic reclaim predicate", () => {
        const owner = player("Alpha", "alpha");
        const target = vehicle(owner);
        target.aresDriverTrait.markDriverKilled();
        expect(canAresDriverReclaim({ isInfantry: () => true, rules: { canDrive: true } }, target)).toBe(true);
        expect(canAresDriverReclaim({ isInfantry: () => true, rules: { canDrive: false } }, target)).toBe(false);
    });

    test("scanner classifies all driver keys as one capability", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rules-drivers.ini",
            contents: "[DriverVehicle]\nProtectedDriver=yes\nCanDrive=yes\n[DriverWarhead]\nKillDriver=yes\n",
        }]);
        const usage = report.featureUsage.find(item => item.featureId === "ares.killing-drivers");
        expect(usage?.occurrences).toBe(3);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
