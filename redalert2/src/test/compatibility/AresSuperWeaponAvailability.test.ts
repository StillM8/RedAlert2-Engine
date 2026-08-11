import { describe, expect, test } from "bun:test";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";
import { NotifyTick as WorldNotifyTick } from "@/game/trait/interface/NotifyTick";
import { SuperWeapon } from "@/game/SuperWeapon";
import { SuperWeaponStatus } from "@/game/SuperWeapon";
import { SuperWeaponTrait } from "@/game/gameobject/trait/SuperWeaponTrait";
import { SuperWeaponsTrait as WorldSuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";
import { SuperWeaponsTrait as PlayerSuperWeaponsTrait } from "@/game/player/trait/SuperWeaponsTrait";
import {
    evaluateAresSuperWeaponAvailability,
    evaluateAresSuperWeaponAvailabilityForOwner,
    hasAresSuperWeaponAvailabilityConfiguration,
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

    test("adapts live owner buildings without hardcoding a mod or country", () => {
        const owner = {
            country: { id: "CountryA" },
            isAi: false,
            buildings: [
                { name: "AuxA", rules: { name: "AuxA" } },
                { name: "ProviderA", rules: { name: "ProviderA", superWeapon: "MOBlast" } },
            ],
        };

        const result = evaluateAresSuperWeaponAvailabilityForOwner(
            { requiredHouses: "CountryA", auxBuildings: "AuxA" },
            owner,
            "MOBlast",
        );

        expect(result).toMatchObject({
            available: true,
            providerBuildingPresent: true,
        });
    });

    test("detects only the common availability keys, not unrelated Ares fields", () => {
        expect(hasAresSuperWeaponAvailabilityConfiguration({
            extensionEntries: new Map([["SW.Damage", "10"]]),
        })).toBe(false);
        expect(hasAresSuperWeaponAvailabilityConfiguration({
            extensionEntries: new Map([["SW.AllowAI", "no"]]),
        })).toBe(true);
    });

    test("grants and revokes an Ares superweapon from generic building state", () => {
        const superWeaponRules: any = {
            name: "MOBlast",
            index: 7,
            rechargeTime: 1,
            isPowered: false,
            ares: { auxBuildings: "AuxA" },
        };
        const playerSuperWeapons = new PlayerSuperWeaponsTrait();
        const owner: any = {
            country: { id: "CountryA" },
            isAi: false,
            defeated: false,
            credits: 0,
            superWeaponsTrait: playerSuperWeapons,
            buildings: [],
            getOwnedObjectsByType: () => owner.buildings,
        };
        const world: any = {
            currentTick: 0,
            rules: {
                getSuperWeapon: () => superWeaponRules,
                superWeaponRules: new Map([[superWeaponRules.name, superWeaponRules]]),
            },
            createSuperWeapon: (name: string, player: any) => new SuperWeapon(name, superWeaponRules, player),
            getCombatants: () => [owner],
            events: { dispatch: () => undefined },
            traits: { filter: () => [] },
        };
        const worldSuperWeapons = new WorldSuperWeaponsTrait();
        const provider = {
            name: "ProviderA",
            rules: { name: "ProviderA", superWeapon: "MOBlast" },
            owner,
        };
        const auxiliary = { name: "AuxA", rules: { name: "AuxA" } };
        owner.buildings.push(provider);

        const providerTrait = new SuperWeaponTrait("MOBlast");
        providerTrait[NotifySpawn.onSpawn](provider, world);
        expect(playerSuperWeapons.has("MOBlast")).toBe(false);

        owner.buildings.push(auxiliary);
        worldSuperWeapons[WorldNotifyTick.onTick](world);
        expect(playerSuperWeapons.has("MOBlast")).toBe(true);

        owner.buildings = [provider];
        worldSuperWeapons[WorldNotifyTick.onTick](world);
        expect(playerSuperWeapons.has("MOBlast")).toBe(false);
    });

    test("AlwaysGranted can create a superweapon without a provider building", () => {
        const superWeaponRules: any = {
            name: "AlwaysSW",
            index: 8,
            rechargeTime: 1,
            isPowered: false,
            ares: { alwaysGranted: true },
        };
        const playerSuperWeapons = new PlayerSuperWeaponsTrait();
        const owner: any = {
            country: { id: "CountryA" },
            isAi: false,
            defeated: false,
            credits: 0,
            superWeaponsTrait: playerSuperWeapons,
            buildings: [],
            getOwnedObjectsByType: () => owner.buildings,
        };
        const world: any = {
            currentTick: 0,
            rules: { superWeaponRules: new Map([[superWeaponRules.name, superWeaponRules]]) },
            createSuperWeapon: (name: string, player: any) => new SuperWeapon(name, superWeaponRules, player),
            getCombatants: () => [owner],
            events: { dispatch: () => undefined },
            traits: { filter: () => [] },
        };

        const worldSuperWeapons = new WorldSuperWeaponsTrait();
        worldSuperWeapons[WorldNotifyTick.onTick](world);
        expect(playerSuperWeapons.has("AlwaysSW")).toBe(true);
    });

    test("finite Shots rejects the next launch after the configured count", () => {
        const superWeaponRules: any = {
            name: "LimitedSW",
            index: 9,
            rechargeTime: 1,
            isPowered: false,
            ares: { shots: 1, alwaysGranted: true },
        };
        const playerSuperWeapons = new PlayerSuperWeaponsTrait();
        const owner: any = {
            country: { id: "CountryA" },
            isAi: false,
            defeated: false,
            credits: 0,
            superWeaponsTrait: playerSuperWeapons,
            buildings: [],
            getOwnedObjectsByType: () => owner.buildings,
        };
        const weapon = new SuperWeapon("LimitedSW", superWeaponRules, owner);
        weapon.status = SuperWeaponStatus.Ready;
        playerSuperWeapons.add(weapon);
        const trait = new WorldSuperWeaponsTrait();

        expect((trait as any).activateSuperWeapon(9, owner, {
            rules: { general: {} },
            traits: { filter: () => [] },
            events: { dispatch: () => undefined },
        }, {}, {})).toBe(true);
        weapon.status = SuperWeaponStatus.Ready;
        expect((trait as any).activateSuperWeapon(9, owner, {
            rules: { general: {} },
            traits: { filter: () => [] },
            events: { dispatch: () => undefined },
        }, {}, {})).toBe(false);
    });
});
