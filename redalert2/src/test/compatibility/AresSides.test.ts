import { describe, expect, test } from "bun:test";
import { resolveSideMixSelection, resolveSidePresentation } from "@/extensions/ares/AresSides";
import { SideType } from "@/game/SideType";
import { IniSection } from "@/data/IniSection";
import { AresCountryRegistry, AresSideRegistry } from "@/extensions/ares/AresSides";
import { CountryRules } from "@/game/rules/CountryRules";
import { Country } from "@/game/Country";

describe("Ares side presentation", () => {
    test("maps a data-defined side to its configured sidebar MIX family", () => {
        const selection = resolveSideMixSelection({
            id: "Foehn",
            index: 3,
            sidebarMixFileIndex: 4,
            sidebarYuriFileNames: false,
        }, SideType.Nod);

        expect(selection).toEqual({
            mixFileIndex: 4,
            baseMixFile: "sidec04.mix",
            expansionMixFile: "sidec04md.mix",
            compatibilityMixFile: "sidec04cd.mix",
            useYuriFileNames: false,
        });
    });

    test("keeps the retail Yuri fallback when no data-defined side is available", () => {
        const selection = resolveSideMixSelection(undefined, SideType.Nod, true);
        expect(selection.baseMixFile).toBe("sidec02.mix");
        expect(selection.useYuriFileNames).toBe(true);
    });

    test("keeps custom presentation identity separate from legacy SideType", () => {
        const presentation = resolveSidePresentation({
            id: "Foehn",
            index: 4,
            presentationId: "Foehn",
            sidebarMixFileIndex: 4,
            evaTag: "Foehn",
        }, SideType.Civilian);

        expect(presentation).toEqual({
            id: "Foehn",
            hudLayout: "soviet",
            sidebarMixFileIndex: 4,
            useYuriFileNames: false,
            evaTag: "Foehn",
            loadingTheme: undefined,
        });
        expect(resolveSidePresentation(undefined, SideType.GDI).hudLayout).toBe("allied");
        expect(resolveSidePresentation(undefined, SideType.Yuri, true).hudLayout).toBe("yuri");
    });

    test("preserves data-defined country metadata in runtime Country objects", () => {
        const side = new IniSection("Epsilon");
        side.set("Presentation", "epsilon");
        const country = new IniSection("EpsilonCountry");
        country.set("Side", "Epsilon");
        country.set("UIName", "TXT_EPSILON_COUNTRY");
        country.set("UITooltip", "STT_EPSILON_COUNTRY");
        country.set("Flag", "epsilon_flag");
        country.set("LoadingScreen", "epsilon_load");
        country.set("LoadingScreenPalette", "epsilon_load.pal");
        country.set("Multiplay", "yes");
        country.set("ListIndex", "12");
        const sections = new Map([
            ["Sides", (() => {
                const section = new IniSection("Sides");
                section.set("0", "Epsilon");
                return section;
            })()],
            ["Epsilon", side],
            ["Countries", (() => {
                const section = new IniSection("Countries");
                section.set("0", "EpsilonCountry");
                return section;
            })()],
            ["EpsilonCountry", country],
        ]);
        const ini = { getSection: (name: string) => sections.get(name) };
        const sides = AresSideRegistry.fromIni(ini);
        const countries = AresCountryRegistry.fromIni(ini, sides);
        const rules = new CountryRules("EpsilonCountry").readIni(country, sides);
        const runtimeCountry = new Country(rules);

        expect(countries.resolve("epsiloncountry")?.flag).toBe("epsilon_flag");
        expect(runtimeCountry.sideId).toBe("Epsilon");
        expect(runtimeCountry.presentationId).toBe("epsilon");
        expect(runtimeCountry.flag).toBe("epsilon_flag");
        expect(runtimeCountry.loadScreen).toBe("epsilon_load");
        expect(runtimeCountry.loadScreenPalette).toBe("epsilon_load.pal");
        expect(runtimeCountry.uiTooltip).toBe("STT_EPSILON_COUNTRY");
    });
});
