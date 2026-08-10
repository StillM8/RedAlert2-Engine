import { describe, expect, test } from "bun:test";
import { EvaSpecs } from "@/engine/sound/EvaSpecs";
import { SideType } from "@/game/SideType";

function makeEvaIni(values: Record<string, Record<string, string>>): any {
    return {
        getSection(name: string): any {
            const section = values[name];
            if (!section) return undefined;
            return {
                entries: new Map(Object.entries(section)),
                getString(key: string): string {
                    return section[key] ?? "";
                },
                getEnum: (_key: string, _enum: any, fallback: number): number => fallback,
            };
        },
    };
}

describe("Ares EVA side tags", () => {
    test("uses an explicit custom voice column without legacy fallback", () => {
        const specs = new EvaSpecs(SideType.Civilian, "Foehn").readIni(makeEvaIni({
            DialogList: { "0": "EVA_Test" },
            EVA_Test: { Russian: "crussian", Allied: "callied", Text: "TXT_TEST", Type: "" },
        }));

        expect(specs.getSpec("EVA_Test")?.sound).toBe("");
    });

    test("honors EVA.Tag=none without requiring the EVA INI", () => {
        const specs = new EvaSpecs(SideType.Civilian, "none").readIni({
            getSection: () => {
                throw new Error("disabled EVA should not load the dialog list");
            },
        });

        expect(specs.getSpec("EVA_Test")).toBeUndefined();
    });

    test("keeps legacy side fallback for vanilla voice selection", () => {
        const specs = new EvaSpecs(SideType.GDI).readIni(makeEvaIni({
            DialogList: { "0": "EVA_Test" },
            EVA_Test: { Russian: "crussian", Text: "TXT_TEST", Type: "" },
        }));

        expect(specs.getSpec("EVA_Test")?.sound).toBe("crussian");
    });
});
