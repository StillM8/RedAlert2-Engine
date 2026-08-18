import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { registerAresPassengerRules } from "@/extensions/ares/AresPassengers";
import { AresInitialPayloadTrait } from "@/game/gameobject/trait/AresInitialPayloadTrait";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";

function section(entries: Record<string, string>): IniSection {
    const result = new IniSection("Host");
    for (const [key, value] of Object.entries(entries)) result.set(key, value);
    return result;
}

function makeRules(name: string, type: ObjectType, entries: Record<string, string> = {}): any {
    const rules: any = { name, type, size: 1 };
    registerAresPassengerRules(rules, section(entries));
    return rules;
}

function makePayload(rules: any, owner: any): any {
    return {
        name: rules.name,
        rules,
        owner,
        limboData: undefined,
        disposed: false,
        isInfantry: () => rules.type === ObjectType.Infantry,
        dispose() { this.disposed = true; },
    };
}

function worldWith(definitions: any[], created: any[] = []): any {
    const byTypeAndName = new Map(definitions.map((rules) => [`${rules.type}:${rules.name.toLowerCase()}`, rules]));
    return {
        rules: {
            hasObject: (name: string, type: ObjectType) => byTypeAndName.has(`${type}:${name.toLowerCase()}`),
            getObject: (name: string, type: ObjectType) => byTypeAndName.get(`${type}:${name.toLowerCase()}`),
        },
        createUnitForPlayer: (rules: any, owner: any) => {
            const payload = makePayload(rules, owner);
            created.push(payload);
            owner.objects.push(payload);
            return payload;
        },
        applyInitialVeteran: (payload: any) => { payload.initialVeteranApplied = true; },
    };
}

function transportHost(entries: Record<string, string>, passengers = 4, sizeLimit = 4): any {
    const rules: any = { name: "Carrier", passengers, sizeLimit };
    registerAresPassengerRules(rules, section(entries));
    const host: any = {
        rules,
        owner: { objects: [], removeOwnedObject(obj: any) { this.objects.splice(this.objects.indexOf(obj), 1); } },
        isInfantry: () => false,
        isBuilding: () => false,
    };
    host.transportTrait = {
        units: [] as any[],
        unitFitsInside: (unit: any) => {
            const occupied = host.transportTrait.units.reduce((sum: number, entry: any) => sum + entry.rules.size, 0);
            return unit.rules.size <= sizeLimit && occupied + unit.rules.size <= passengers;
        },
    };
    return host;
}

describe("Ares InitialPayload", () => {
    test("creates authored vehicle payload directly in limbo and only once", () => {
        const host = transportHost({
            "InitialPayload.Types": "E1, HTNK",
            "InitialPayload.Nums": "2, 1",
        });
        const e1 = makeRules("E1", ObjectType.Infantry);
        const tank = makeRules("HTNK", ObjectType.Vehicle);
        const created: any[] = [];
        const world = worldWith([e1, tank], created);
        const trait = new AresInitialPayloadTrait();

        trait[NotifySpawn.onSpawn](host, world);
        trait[NotifySpawn.onSpawn](host, world);

        expect(host.transportTrait.units.map((unit: any) => unit.name)).toEqual(["E1", "E1", "HTNK"]);
        expect(created).toHaveLength(3);
        expect(created.every((unit) => unit.limboData?.inTransport === true)).toBe(true);
        expect(created.every((unit) => unit.initialVeteranApplied === true)).toBe(true);
    });

    test("repeats the final InitialPayload.Nums value", () => {
        const host = transportHost({
            "InitialPayload.Types": "A, B, C",
            "InitialPayload.Nums": "1, 2",
        }, 8, 8);
        const defs = ["A", "B", "C"].map((name) => makeRules(name, ObjectType.Infantry));
        const world = worldWith(defs);
        const trait = new AresInitialPayloadTrait();

        trait[NotifySpawn.onSpawn](host, world);
        expect(host.transportTrait.units.map((unit: any) => unit.name)).toEqual(["A", "B", "B", "C", "C"]);
    });

    test("rejects recursive payload definitions", () => {
        const host = transportHost({ "InitialPayload.Types": "CHILD" });
        const child = makeRules("CHILD", ObjectType.Vehicle, { "InitialPayload.Types": "E1" });
        const e1 = makeRules("E1", ObjectType.Infantry);
        const created: any[] = [];
        const world = worldWith([child, e1], created);

        new AresInitialPayloadTrait()[NotifySpawn.onSpawn](host, world);
        expect(created).toHaveLength(0);
        expect(host.transportTrait.units).toHaveLength(0);
    });

    test("building host accepts infantry only and respects garrison capacity", () => {
        const rules: any = { name: "BUNKER" };
        registerAresPassengerRules(rules, section({
            "InitialPayload.Types": "E1, HTNK",
            "InitialPayload.Nums": "3, 1",
        }));
        const accepted: any[] = [];
        const host: any = {
            rules,
            owner: { objects: [], removeOwnedObject(obj: any) { this.objects.splice(this.objects.indexOf(obj), 1); } },
            isInfantry: () => false,
            isBuilding: () => true,
            garrisonTrait: {
                addInitialOccupant(unit: any) {
                    if (accepted.length >= 2) return false;
                    accepted.push(unit);
                    return true;
                },
            },
        };
        const e1 = makeRules("E1", ObjectType.Infantry);
        const tank = makeRules("HTNK", ObjectType.Vehicle);
        const created: any[] = [];
        const world = worldWith([e1, tank], created);

        new AresInitialPayloadTrait()[NotifySpawn.onSpawn](host, world);

        expect(accepted.map((unit) => unit.name)).toEqual(["E1", "E1"]);
        // Third infantry is created then rejected by the capacity gate and is
        // cleaned up; the following vehicle type is invalid for building hosts.
        expect(created.filter((unit) => !unit.disposed).map((unit) => unit.name)).toEqual(["E1", "E1"]);
        expect(host.owner.objects).toHaveLength(2);
    });

    test("infantry hosts never create InitialPayload", () => {
        const rules: any = { name: "E1" };
        registerAresPassengerRules(rules, section({ "InitialPayload.Types": "E2" }));
        const host: any = {
            rules,
            owner: { objects: [] },
            isInfantry: () => true,
            isBuilding: () => false,
            transportTrait: { units: [], unitFitsInside: () => true },
        };
        const created: any[] = [];
        const world = worldWith([makeRules("E2", ObjectType.Infantry)], created);

        new AresInitialPayloadTrait()[NotifySpawn.onSpawn](host, world);
        expect(created).toHaveLength(0);
    });
});
