import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import {
    decideAresChronoshiftEligibility,
    parseAresChronoshiftRules,
} from "@/extensions/ares/AresChronoshift";

describe("Ares Chronoshift eligibility", () => {
    test("uses documented defaults and honors Allow/IsVehicle overrides", () => {
        const defaults = parseAresChronoshiftRules(new IniSection("PlainTechno"));
        expect(defaults).toEqual({ allow: true, isVehicle: false });

        const section = new IniSection("Configured");
        section.set("chronoshift.allow", "NO");
        section.set("CHRONOSHIFT.ISVEHICLE", "yes");
        expect(parseAresChronoshiftRules(section)).toEqual({ allow: false, isVehicle: true });
    });

    test("applies the default object-category filter", () => {
        const base = { techno: { allow: true, isVehicle: false } };
        expect(decideAresChronoshiftEligibility({ ...base, objectCategory: "infantry" })).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "infantry",
        });
        expect(decideAresChronoshiftEligibility({ ...base, objectCategory: "unit" }).eligible).toBe(true);
        expect(decideAresChronoshiftEligibility({ ...base, objectCategory: "aircraft" })).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "unit",
        });
        expect(decideAresChronoshiftEligibility({ ...base, objectCategory: "building" })).toEqual({
            eligible: false,
            reason: "category-not-affected",
            effectiveCategory: "building",
        });
    });

    test("reclassifies only IsVehicle buildings when ReconsiderBuildings is enabled", () => {
        const vehicleBuilding = {
            objectCategory: "building",
            techno: { allow: true, isVehicle: true },
        } as const;

        expect(decideAresChronoshiftEligibility(vehicleBuilding)).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "unit",
        });
        expect(decideAresChronoshiftEligibility({
            ...vehicleBuilding,
            chronosphere: { reconsiderBuildings: false },
        })).toEqual({
            eligible: false,
            reason: "category-not-affected",
            effectiveCategory: "building",
        });
        expect(decideAresChronoshiftEligibility({
            objectCategory: "building",
            techno: { allow: true, isVehicle: false },
            chronosphere: { affectedTargets: ["building"] },
        })).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "building",
        });
    });

    test("honors Allow=false before category filtering", () => {
        expect(decideAresChronoshiftEligibility({
            objectCategory: "unit",
            techno: { allow: false, isVehicle: true },
        })).toEqual({
            eligible: false,
            reason: "not-allowed",
            effectiveCategory: "unit",
        });
    });

    test("falls back safely for malformed fields and unknown categories", () => {
        expect(decideAresChronoshiftEligibility({
            objectCategory: "not-a-techno",
            techno: { allow: "maybe" as unknown as boolean, isVehicle: 1 as unknown as boolean },
            chronosphere: { reconsiderBuildings: "sometimes", affectedTargets: ["invalid"] },
        })).toEqual({ eligible: false, reason: "invalid-category" });

        expect(decideAresChronoshiftEligibility({
            objectCategory: "building",
            techno: { allow: true, isVehicle: true },
            chronosphere: { reconsiderBuildings: "sometimes", affectedTargets: ["invalid"] },
        })).toEqual({
            eligible: true,
            reason: "eligible",
            effectiveCategory: "unit",
        });

        const malformed = new IniSection("Malformed");
        malformed.set("Chronoshift.Allow", "maybe");
        malformed.set("Chronoshift.IsVehicle", "unknown");
        expect(parseAresChronoshiftRules(malformed)).toEqual({ allow: true, isVehicle: false });
    });
});
