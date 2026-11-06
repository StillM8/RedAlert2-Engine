import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import {
    getAresPassengerRules,
    isAresBuildingPassengerClassAllowed,
    isAresInitialPayloadBuildingHost,
    registerAresPassengerRules,
} from "@/extensions/ares/AresPassengers";
import { AresInitialPayloadTrait } from "@/game/gameobject/trait/AresInitialPayloadTrait";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";

/**
 * Backs the AresFeatureRegistry certification that InitialPayload obeys the
 * Ares building-host restrictions: a BuildingType host must be occupiable
 * (CanBeOccupied=yes) or explicitly InfantryAbsorb=yes, and a building host
 * may only receive InfantryType payload.
 */

function rulesFrom(contents: string, sectionName: string): object {
    const section = new IniFile(contents).getSection(sectionName)!;
    const technoRules = {};
    registerAresPassengerRules(technoRules, section as any);
    return technoRules;
}

describe("Ares building passenger host restrictions", () => {
    test("InitialPayload building host requires CanBeOccupied or InfantryAbsorb", () => {
        const infantryAbsorb = getAresPassengerRules(rulesFrom(
            "[Host]\nInfantryAbsorb=yes\nInitialPayload.Types=GIDF\n", "Host"));
        const unitAbsorbOnly = getAresPassengerRules(rulesFrom(
            "[Host]\nUnitAbsorb=yes\nInitialPayload.Types=HTNK\n", "Host"));

        // InfantryAbsorb=yes qualifies without a garrison.
        expect(isAresInitialPayloadBuildingHost(infantryAbsorb, false)).toBe(true);
        // UnitAbsorb=yes alone is explicitly not sufficient.
        expect(isAresInitialPayloadBuildingHost(unitAbsorbOnly, false)).toBe(false);
        // CanBeOccupied (garrison) qualifies regardless of absorb flags.
        expect(isAresInitialPayloadBuildingHost(unitAbsorbOnly, true)).toBe(true);
        expect(isAresInitialPayloadBuildingHost(undefined, false)).toBe(false);
    });

    test("building passenger class gates infantry and vehicles independently", () => {
        const rules = getAresPassengerRules(rulesFrom(
            "[Host]\nInfantryAbsorb=yes\nInitialPayload.Types=GIDF\n", "Host"));
        const infantry = { isInfantry: () => true };
        const vehicle = { isVehicle: () => true };

        expect(isAresBuildingPassengerClassAllowed(rules, infantry)).toBe(true);
        expect(isAresBuildingPassengerClassAllowed(rules, vehicle)).toBe(false);
        expect(isAresBuildingPassengerClassAllowed(undefined, infantry)).toBe(false);
    });

    test("building hosts only receive InfantryType initial payload", () => {
        const hostRules = rulesFrom(
            "[Host]\nInfantryAbsorb=yes\nInitialPayload.Types=HTNK,GIDF\nInitialPayload.Nums=1,1\n", "Host");
        expect(getAresPassengerRules(hostRules)?.initialPayloadTypes).toEqual(["HTNK", "GIDF"]);

        const occupants: any[] = [];
        const host: any = {
            rules: hostRules,
            isBuilding: () => true,
            garrisonTrait: {
                units: occupants,
                addInitialOccupant(payload: any) { occupants.push(payload); return true; },
            },
        };
        const world = {
            rules: {
                hasObject: (name: string, type: ObjectType) =>
                    (name === "GIDF" && type === ObjectType.Infantry) ||
                    (name === "HTNK" && type === ObjectType.Vehicle),
                getObject: (name: string, type: ObjectType) => ({ name, type }),
            },
            createUnitForPlayer: (rules: any) => ({ rules, limboData: undefined }),
            applyInitialVeteran: () => undefined,
        };

        new AresInitialPayloadTrait()[NotifySpawn.onSpawn](host, world);

        // HTNK resolves only as a VehicleType and must be rejected for a
        // building host; only the InfantryType entry produces payload while
        // the invalid entry is skipped.
        expect(occupants.map((payload: any) => payload.rules.name)).toEqual(["GIDF"]);
    });
});
