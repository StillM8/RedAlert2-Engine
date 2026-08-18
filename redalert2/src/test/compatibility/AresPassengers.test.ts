import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import {
    getAresPassengerRules,
    isAresInitialPayloadBuildingHost,
    parseAresPassengerRules,
    registerAresPassengerRules,
} from "@/extensions/ares/AresPassengers";
import { TransportTrait } from "@/game/gameobject/trait/TransportTrait";
import { EnterTransportOrder } from "@/game/order/EnterTransportOrder";
import { DeployOrder } from "@/game/order/DeployOrder";

function section(entries: Record<string, string>): IniSection {
    const result = new IniSection("Transport");
    for (const [key, value] of Object.entries(entries)) result.set(key, value);
    return result;
}

function passenger(name: string, size: number): any {
    return { name, rules: { name, size } };
}

function transport(entries: Record<string, string>, passengers = 3, sizeLimit = 3): { rules: any; object: any; trait: TransportTrait } {
    const rules = { name: "Carrier", passengers, sizeLimit };
    registerAresPassengerRules(rules, section(entries));
    const object: any = {
        name: "Carrier",
        rules,
        isVehicle: () => true,
        isInfantry: () => false,
        isBuilding: () => false,
        isDestroyed: false,
    };
    const trait = new TransportTrait(object);
    object.transportTrait = trait;
    return { rules, object, trait };
}

describe("Ares passenger extensions", () => {
    test("normalizes Specific Passengers, building absorption and one-seat capacity semantics", () => {
        const rules = parseAresPassengerRules(section({
            "Passengers.Allowed": "E1, E2",
            "Passengers.Disallowed": "E2, SPY",
            "Passengers.BySize": "no",
            "InfantryAbsorb": "yes",
            "UnitAbsorb": "yes",
            "NoManualUnload": "yes",
            "NoManualEnter": "yes",
            "InitialPayload.Types": "E1, E2, E3",
            "InitialPayload.Nums": "2, 4",
            "Promote.IncludePassengers": "yes",
        }));

        expect(rules.allowedTypes).toEqual(["E1", "E2"]);
        expect(rules.disallowedTypes).toEqual(["E2", "SPY"]);
        expect(rules.bySize).toBe(false);
        expect(rules.infantryAbsorb).toBe(true);
        expect(rules.unitAbsorb).toBe(true);
        expect(rules.noManualUnload).toBe(true);
        expect(rules.noManualEnter).toBe(true);
        expect(rules.initialPayloadTypes).toEqual(["E1", "E2", "E3"]);
        expect(rules.initialPayloadCounts).toEqual([2, 4, 4]);
        expect(rules.promoteIncludePassengers).toBe(true);
    });

    test("uses Ares defaults when only an extension key is authored", () => {
        const raw = section({ "Passengers.Allowed": "E1" });
        const hostRules = {};
        registerAresPassengerRules(hostRules, raw);
        const rules = getAresPassengerRules(hostRules)!;

        expect(rules.bySize).toBe(true);
        expect(rules.infantryAbsorb).toBe(false);
        expect(rules.unitAbsorb).toBe(false);
        expect(rules.noManualUnload).toBe(false);
        expect(rules.noManualEnter).toBe(false);
        expect(rules.initialPayloadTypes).toEqual([]);
        expect(rules.initialPayloadCounts).toEqual([]);
        expect(rules.promoteIncludePassengers).toBe(false);
    });

    test("InitialPayload building host accepts garrisons or InfantryAbsorb but not UnitAbsorb alone", () => {
        const infantryAbsorb = parseAresPassengerRules(section({ "InfantryAbsorb": "yes" }));
        const unitAbsorb = parseAresPassengerRules(section({ "UnitAbsorb": "yes" }));

        expect(isAresInitialPayloadBuildingHost(undefined, true)).toBe(true);
        expect(isAresInitialPayloadBuildingHost(infantryAbsorb, false)).toBe(true);
        expect(isAresInitialPayloadBuildingHost(unitAbsorb, false)).toBe(false);
    });

    test("enforces Allowed and Disallowed case-insensitively with Disallowed winning", () => {
        const { trait } = transport({
            "Passengers.Allowed": "E1, E2",
            "Passengers.Disallowed": "e2",
        });

        expect(trait.unitFitsInside(passenger("e1", 1))).toBe(true);
        expect(trait.unitFitsInside(passenger("E2", 1))).toBe(false);
        expect(trait.unitFitsInside(passenger("SPY", 1))).toBe(false);
    });

    test("Passengers.BySize=no makes every passenger consume one seat", () => {
        const { trait } = transport({ "Passengers.BySize": "no" }, 2, 3);
        const largeA = passenger("A", 3);
        const largeB = passenger("B", 3);
        const largeC = passenger("C", 3);

        expect(trait.unitFitsInside(largeA)).toBe(true);
        trait.units.push(largeA);
        expect(trait.getOccupiedCapacity()).toBe(1);
        expect(trait.unitFitsInside(largeB)).toBe(true);
        trait.units.push(largeB);
        expect(trait.getOccupiedCapacity()).toBe(2);
        expect(trait.unitFitsInside(largeC)).toBe(false);
    });

    test("SizeLimit remains authoritative when Passengers.BySize=no", () => {
        const { trait } = transport({ "Passengers.BySize": "no" }, 10, 2);
        expect(trait.unitFitsInside(passenger("TOO_BIG", 3))).toBe(false);
        expect(trait.unitFitsInside(passenger("FITS", 2))).toBe(true);
    });

    test("NoManualEnter removes the player enter order without blocking scripted task semantics", () => {
        const { object: carrier, trait } = transport({ "NoManualEnter": "yes" });
        expect(trait.allowsManualEntry()).toBe(false);

        const source = { isVehicle: () => false, isInfantry: () => true };
        const order = new EnterTransportOrder({} as any);
        order.set(source, { obj: carrier });
        expect(order.isValid()).toBe(false);
    });

    test("NoManualUnload removes the player deploy/evacuate order", () => {
        const { object: carrier, trait } = transport({ "NoManualUnload": "yes" });
        trait.units.push(passenger("E1", 1));
        expect(trait.allowsManualUnload()).toBe(false);

        const order = new DeployOrder({} as any, false);
        order.set(carrier, undefined);
        expect(order.isValid()).toBe(false);
        expect(order.process()).toBeUndefined();
    });

    test("legacy transports retain size-based capacity and manual controls when no Ares passenger keys are authored", () => {
        const { trait, rules } = transport({}, 3, 3);
        expect(getAresPassengerRules(rules)).toBeUndefined();
        expect(trait.allowsManualEntry()).toBe(true);
        expect(trait.allowsManualUnload()).toBe(true);
        const twoSeat = passenger("E1", 2);
        trait.units.push(twoSeat);
        expect(trait.getOccupiedCapacity()).toBe(2);
        expect(trait.unitFitsInside(passenger("E2", 2))).toBe(false);
        expect(trait.unitFitsInside(passenger("E3", 1))).toBe(true);
    });
});
