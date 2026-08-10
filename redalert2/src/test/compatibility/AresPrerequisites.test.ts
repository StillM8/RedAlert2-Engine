import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import {
    evaluateAresPrerequisiteRules,
    isFactoryOwnerAllowed,
    parseAresPrerequisiteRules,
} from "@/extensions/ares/AresPrerequisites";
import { FactoryType } from "@/game/rules/TechnoRules";
import { Production } from "@/game/player/production/Production";

describe("Ares prerequisite runtime", () => {
    test("supports custom generic groups and non-building alternates", () => {
        const ini = new IniFile(`
[TestUnit]
Prerequisites=NAVALYARD

[GenericPrerequisites]
NAVALYARD=GAYARD,NAYARD

[General]
PrerequisiteNavalyardAlternate=SHMIN
`);
        const rules = parseAresPrerequisiteRules(ini.getSection("TestUnit")!);
        const genericGroups = new Map([
            ["NAVALYARD", ["GAYARD", "NAYARD"]],
        ]);
        const genericAlternates = new Map([
            ["NAVALYARD", ["SHMIN"]],
        ]);

        expect(evaluateAresPrerequisiteRules(rules, {
            ownedObjectNames: ["GAYARD"],
            genericGroups,
            genericAlternates,
        })).toBe(true);
        expect(evaluateAresPrerequisiteRules(rules, {
            ownedObjectNames: ["SHMIN"],
            genericGroups,
            genericAlternates,
        })).toBe(true);
        expect(evaluateAresPrerequisiteRules(rules, {
            ownedObjectNames: ["GAPILE"],
            genericGroups,
            genericAlternates,
        })).toBe(false);
    });

    test("uses alternative lists and honors negative, theater, and stolen-tech gates", () => {
        const ini = new IniFile(`
[TestUnit]
Prerequisite=GAPILE,GATECH
Prerequisite.Lists=1
Prerequisite.List1=NAHAND,NATECH
Prerequisite.Negative=YACOMD
Prerequisite.RequiredTheaters=SNOW,NEWURBAN
Prerequisite.StolenTechs=2,5
`);
        const rules = parseAresPrerequisiteRules(ini.getSection("TestUnit")!);

        const baseContext = {
            ownedObjectNames: ["NAHAND", "NATECH"],
            stolenTechs: [2, 5],
            theater: "snow",
        };
        expect(evaluateAresPrerequisiteRules(rules, baseContext)).toBe(true);
        expect(evaluateAresPrerequisiteRules(rules, {
            ...baseContext,
            theater: "TEMPERATE",
        })).toBe(false);
        expect(evaluateAresPrerequisiteRules(rules, {
            ...baseContext,
            ownedObjectNames: ["NAHAND", "NATECH", "YACOMD"],
        })).toBe(false);
        expect(evaluateAresPrerequisiteRules(rules, {
            ...baseContext,
            stolenTechs: [2],
        })).toBe(false);
    });

    test("keeps vanilla no-prerequisite and Prerequisite.List0 semantics", () => {
        const noPrerequisite = parseAresPrerequisiteRules(new IniFile(`
[TestUnit]
Cost=100
`).getSection("TestUnit")!);
        expect(evaluateAresPrerequisiteRules(noPrerequisite, {
            ownedObjectNames: [],
        })).toBe(true);

        const list0 = parseAresPrerequisiteRules(new IniFile(`
[TestUnit]
Prerequisite=WRONG
Prerequisite.List0=RIGHT
`).getSection("TestUnit")!);
        expect(evaluateAresPrerequisiteRules(list0, {
            ownedObjectNames: ["RIGHT"],
        })).toBe(true);
        expect(evaluateAresPrerequisiteRules(list0, {
            ownedObjectNames: ["WRONG"],
        })).toBe(false);
    });

    test("normalizes alternatives and independent exclusions into an expression tree", () => {
        const rules = parseAresPrerequisiteRules(new IniFile(`
[TestUnit]
Prerequisite=GAPILE,GATECH
Prerequisite.Lists=1
Prerequisite.List1=NAHAND,NATECH
Prerequisite.Negative=YACOMD
Prerequisite.RequiredTheaters=SNOW,NEWURBAN
Prerequisite.StolenTechs=2,5
`).getSection("TestUnit")!);

        expect(rules.expression).toEqual({
            type: "all",
            children: [
                {
                    type: "any",
                    children: [
                        {
                            type: "all",
                            children: [
                                { type: "reference", id: "GAPILE" },
                                { type: "reference", id: "GATECH" },
                            ],
                        },
                        {
                            type: "all",
                            children: [
                                { type: "reference", id: "NAHAND" },
                                { type: "reference", id: "NATECH" },
                            ],
                        },
                    ],
                },
                { type: "not", child: { type: "reference", id: "YACOMD" } },
                { type: "theater", allowed: ["SNOW", "NEWURBAN"] },
                { type: "stolen-tech", required: [2, 5] },
            ],
        });
        expect(evaluateAresPrerequisiteRules(rules, {
            ownedObjectNames: ["NAHAND", "NATECH"],
            stolenTechs: [2, 5],
            theater: "SNOW",
        })).toBe(true);
    });

    test("does not turn a missing declared alternative list into an always-true list", () => {
        const rules = parseAresPrerequisiteRules(new IniFile(`
[TestUnit]
Prerequisite=GAPILE
Prerequisite.Lists=2
Prerequisite.List1=NAHAND
`).getSection("TestUnit")!);

        expect(rules.alternativeLists).toEqual([["GAPILE"], ["NAHAND"]]);
        expect(evaluateAresPrerequisiteRules(rules, { ownedObjectNames: [] })).toBe(false);
        expect(evaluateAresPrerequisiteRules(rules, { ownedObjectNames: ["NAHAND"] })).toBe(true);
    });

    test("treats disabled stolen-tech values and missing theater context correctly", () => {
        const disabledStolenTech = parseAresPrerequisiteRules(new IniFile(`
[TestUnit]
Prerequisite.StolenTechs=-1
`).getSection("TestUnit")!);
        expect(disabledStolenTech.stolenTechs).toEqual([]);
        expect(evaluateAresPrerequisiteRules(disabledStolenTech, {
            ownedObjectNames: [],
        })).toBe(true);

        const snowOnly = parseAresPrerequisiteRules(new IniFile(`
[TestUnit]
Prerequisite.RequiredTheaters=SNOW
`).getSection("TestUnit")!);
        expect(evaluateAresPrerequisiteRules(snowOnly, {
            ownedObjectNames: [],
        })).toBe(false);
        expect(evaluateAresPrerequisiteRules(snowOnly, {
            ownedObjectNames: [],
            theater: "snow",
        })).toBe(true);
    });

    test("parses and evaluates factory-owner restrictions by stable country ID", () => {
        const rules = parseAresPrerequisiteRules(new IniFile(`
[TestUnit]
FactoryOwners=AlphaCountry,BetaCountry
FactoryOwners.Forbidden=BetaCountry
`).getSection("TestUnit")!);

        expect(rules.factoryOwners).toEqual(["ALPHACOUNTRY", "BETACOUNTRY"]);
        expect(rules.factoryOwnersForbidden).toEqual(["BETACOUNTRY"]);
        expect(isFactoryOwnerAllowed("AlphaCountry", rules.factoryOwners, rules.factoryOwnersForbidden)).toBe(true);
        expect(isFactoryOwnerAllowed("BetaCountry", rules.factoryOwners, rules.factoryOwnersForbidden)).toBe(false);
        expect(isFactoryOwnerAllowed("GammaCountry", rules.factoryOwners, rules.factoryOwnersForbidden)).toBe(false);
        expect(isFactoryOwnerAllowed("GammaCountry", [], rules.factoryOwnersForbidden)).toBe(true);
    });

    test("keeps FactoryOwners tied to the factory's initial country after capture", () => {
        const production = Object.create(Production.prototype) as any;
        production.player = {
            buildings: new Set([{
                factoryTrait: { type: FactoryType.UnitType },
                rules: { naval: false, owner: ["AlphaCountry"] },
                initialFactoryOwnerId: "AlphaCountry",
                owner: { country: { id: "BetaCountry" } },
            }]),
        };
        const object = {
            type: ObjectType.Vehicle,
            naval: false,
            owner: ["AlphaCountry"],
            factoryOwners: ["AlphaCountry"],
            factoryOwnersForbidden: [],
        };

        expect(production.hasFactoryFor(object)).toBe(true);
        expect(production.hasFactoryFor({
            ...object,
            factoryOwners: ["BetaCountry"],
        })).toBe(false);
        expect(production.hasFactoryFor({
            ...object,
            factoryOwnersForbidden: ["BetaCountry"],
        })).toBe(true);
        expect(production.hasFactoryFor({
            ...object,
            factoryOwnersForbidden: ["AlphaCountry"],
        })).toBe(false);
    });

    test("uses active HasAllPlans buildings for every factory type", () => {
        const production = Object.create(Production.prototype) as any;
        production.permanentFactoryOwnerPlans = new Set();
        production.player = {
            buildings: new Set([{
                factoryTrait: undefined,
                rules: { factoryOwnersHasAllPlans: true, owner: ["AlphaCountry"] },
                initialFactoryOwnerId: "AlphaCountry",
                owner: { country: { id: "AlphaCountry" } },
            }]),
        };
        const object = {
            type: ObjectType.Aircraft,
            owner: ["AlphaCountry"],
            factoryOwners: ["AlphaCountry"],
            factoryOwnersForbidden: [],
        };

        expect(production.hasFactoryFor(object)).toBe(true);
        expect(production.hasFactoryFor({ ...object, factoryOwners: ["BetaCountry"] })).toBe(false);
    });

    test("keeps Permanent factory plans after the source building is lost", () => {
        const production = Object.create(Production.prototype) as any;
        production.permanentFactoryOwnerPlans = new Set(["AlphaCountry"]);
        production.player = { buildings: new Set() };
        const object = {
            type: ObjectType.Vehicle,
            naval: false,
            owner: ["AlphaCountry"],
            factoryOwners: ["AlphaCountry"],
            factoryOwnersForbidden: [],
        };

        expect(production.hasFactoryFor(object)).toBe(true);
        expect(production.hasFactoryFor({ ...object, factoryOwners: ["BetaCountry"] })).toBe(false);
    });
});
