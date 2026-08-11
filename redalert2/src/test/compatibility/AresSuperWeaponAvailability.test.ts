import { describe, expect, test } from "bun:test";
import {
    evaluateAresSuperWeaponAvailability,
    type AresSuperWeaponAvailabilityContext,
    type AresSuperWeaponAvailabilityRules,
} from "@/extensions/ares/AresSuperWeaponAvailability";

function context(overrides: Partial<AresSuperWeaponAvailabilityContext> = {}): AresSuperWeaponAvailabilityContext {
    return {
        countryId: "CountryA",
        isAi: false,
        ownedBuildingTypes: ["AuxA", "ProviderA"],
        ownedProviderBuildingTypes: ["ProviderA"],
        shotsFired: 0,
        ...overrides,
    };
}

function evaluate(
    rules: AresSuperWeaponAvailabilityRules = {},
    overrides: Partial<AresSuperWeaponAvailabilityContext> = {},
) {
    return evaluateAresSuperWeaponAvailability(rules, context(overrides));
}

describe("Ares superweapon availability", () => {
    test("uses permissive defaults but still requires an owned provider building", () => {
        expect(evaluate().available).toBe(true);
        expect(evaluate({}, { ownedProviderBuildingTypes: [] })).toMatchObject({
            available: false,
            reasons: ["missing-provider-building"],
            failures: ["missing-provider-building"],
            providerBuildingPresent: false,
        });
    });

    test("applies RequiredHouses and ForbiddenHouses case-insensitively", () => {
        expect(evaluate({ requiredHouses: "countrya,countryb" }).available).toBe(true);
        expect(evaluate({ requiredHouses: ["CountryB"] })).toMatchObject({
            available: false,
            failures: ["missing-required-house"],
        });
        expect(evaluate({ forbiddenHouses: "COUNTRYA" })).toMatchObject({
            available: false,
            failures: ["forbidden-house"],
        });
    });

    test("requires at least one AuxBuildings type and rejects any NegBuildings type", () => {
        expect(evaluate({ auxBuildings: ["AuxA", "AuxB"] }).available).toBe(true);
        expect(evaluate({ auxBuildings: "AuxB" })).toMatchObject({
            available: false,
            failures: ["missing-aux-building"],
        });
        expect(evaluate({ negBuildings: "NegA" }, { ownedBuildingTypes: ["AuxA", "NegA"] })).toMatchObject({
            available: false,
            failures: ["has-negative-building"],
        });
    });

    test("enforces AllowPlayer and AllowAI independently", () => {
        expect(evaluate({ allowPlayer: false })).toMatchObject({
            available: false,
            failures: ["player-not-allowed"],
        });
        expect(evaluate({ allowAI: false }, { isAi: true })).toMatchObject({
            available: false,
            failures: ["ai-not-allowed"],
        });
        expect(evaluate({ allowPlayer: false, allowAI: true }, { isAi: true }).available).toBe(true);
    });

    test("tracks finite Shots and treats -1 as unlimited", () => {
        expect(evaluate({ shots: 3 }, { shotsFired: 2 })).toMatchObject({
            available: true,
            shotsLimit: 3,
            shotsRemaining: 1,
        });
        expect(evaluate({ shots: 3 }, { shotsFired: 3 })).toMatchObject({
            available: false,
            reasons: ["shot-limit"],
            failures: ["shot-limit"],
            shotsRemaining: 0,
        });
        expect(evaluate({ shots: -1 }, { shotsFired: 999 }).available).toBe(true);
    });

    test("AlwaysGranted bypasses only provider presence and preserves other gates", () => {
        expect(evaluate({ alwaysGranted: true }, { ownedProviderBuildingTypes: [] })).toMatchObject({
            available: true,
            providerBuildingPresent: false,
        });
        expect(evaluate({ alwaysGranted: true, auxBuildings: "MissingAux" }, {
            ownedProviderBuildingTypes: [],
        })).toMatchObject({
            available: false,
            failures: ["missing-aux-building"],
        });
    });

    test("reads the raw SW fields retained by the existing Ares parser", () => {
        const result = evaluateAresSuperWeaponAvailability({
            extensionEntries: new Map([
                ["SW.RequiredHouses", "CountryA"],
                ["SW.AuxBuildings", "AuxA"],
                ["SW.AllowPlayer", "no"],
                ["SW.Shots", "2"],
                ["SW.AlwaysGranted", "yes"],
            ]),
        }, context({ ownedProviderBuildingTypes: [], shotsFired: 0 }));

        expect(result).toMatchObject({
            available: false,
            failures: ["player-not-allowed"],
            shotsLimit: 2,
            providerBuildingPresent: false,
        });
    });
});
