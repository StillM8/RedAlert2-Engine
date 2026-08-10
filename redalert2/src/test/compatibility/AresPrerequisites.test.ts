import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import {
    evaluateAresPrerequisiteRules,
    parseAresPrerequisiteRules,
} from "@/extensions/ares/AresPrerequisites";

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
});

