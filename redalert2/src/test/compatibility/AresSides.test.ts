import { describe, expect, test } from "bun:test";
import { expandAresMultiplayerScoreBars, resolveLoadingTheme, resolveMultiplayerScorePresentation, resolveSideMixSelection, resolveSidePresentation } from "@/extensions/ares/AresSides";
import { SideType } from "@/game/SideType";
import { IniSection } from "@/data/IniSection";
import { AresCountryRegistry, AresSideRegistry } from "@/extensions/ares/AresSides";
import { CountryRules } from "@/game/rules/CountryRules";
import { Country } from "@/game/Country";
import { Rules } from "@/game/rules/Rules";
import { TechnoRules } from "@/game/rules/TechnoRules";
import { ParadropRules, resolveParadropAircraft } from "@/game/rules/general/ParadropRules";
import { sideTypeToTriggerSide } from "@/game/ai/thirdpartbot/builtIn/bot/logic/ai-ini/aiTriggerDb";
import { Player } from "@/game/Player";
import { Production } from "@/game/player/production/Production";

describe("Ares side presentation", () => {
    test("parses Ares named [Sides] entries used by Mental Omega", () => {
        const sections = new Map<string, IniSection>();
        const sidesSection = new IniSection("Sides");
        sidesSection.set("GDI", "UnitedStates,Europeans,Pacific");
        sidesSection.set("Nod", "USSR,Latin,Chinese");
        sidesSection.set("ThirdSide", "PsiCorps,ScorpionCell,Headquaters");
        sidesSection.set("FourthSide", "Guild1,Guild2,Guild3");
        sections.set("Sides", sidesSection);
        const reader = { getSection: (name: string) => sections.get(name) };

        const sides = AresSideRegistry.fromIni(reader);

        expect(sides.list().map((side) => side.id)).toEqual([
            "GDI",
            "Nod",
            "ThirdSide",
            "FourthSide",
        ]);
        expect(sides.resolve("FourthSide")?.order).toBe(3);
        expect(sides.resolve("FourthSide")?.legacySide).toBeUndefined();
    });

    test("keeps four authored sides and their countries data-defined", () => {
        const sections = new Map<string, IniSection>();
        const add = (name: string, values: Record<string, string>) => {
            const section = new IniSection(name);
            Object.entries(values).forEach(([key, value]) => section.set(key, value));
            sections.set(name, section);
        };
        add("Sides", { "0": "Alpha", "1": "Beta", "2": "Gamma", "3": "Delta" });
        add("Alpha", { ToolTipColor: "1,2,3" });
        add("Countries", {
            "0": "AlphaCountry",
            "1": "BetaCountry",
            "2": "GammaCountry",
            "3": "DeltaCountry",
            "4": "HiddenCountry",
        });
        add("AlphaCountry", { Side: "Alpha", Multiplay: "yes", ListIndex: "20" });
        add("BetaCountry", { Side: "Beta", Multiplay: "no", ListIndex: "21" });
        add("GammaCountry", { Side: "Gamma", Multiplay: "yes", ListIndex: "22" });
        add("DeltaCountry", { Side: "Delta", Multiplay: "yes", ListIndex: "23" });
        add("HiddenCountry", { Side: "Alpha", Multiplay: "yes", ListIndex: "-1" });
        const reader = { getSection: (name: string) => sections.get(name) };
        const sides = AresSideRegistry.fromIni(reader);
        const countries = AresCountryRegistry.fromIni(reader, sides);

        expect(sides.list().map((side) => side.id)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
        expect(sides.list().map((side) => side.order)).toEqual([0, 1, 2, 3]);
        expect(sides.resolve("Alpha")?.tooltipColor).toBe("1,2,3");
        expect(sides.resolveByIndex(3)?.id).toBe("Delta");
        expect(countries.definitionOrder().map((country) => country.sideId)).toEqual(["Alpha", "Beta", "Gamma", "Delta", "Alpha"]);
        expect(countries.multiplayerCountries().map((country) => country.id)).toEqual([
            "AlphaCountry",
            "GammaCountry",
            "DeltaCountry",
        ]);
        expect(countries.resolve("deltacountry")?.sideId).toBe("Delta");
        expect(sides.resolveLegacySide("Delta")).toBeUndefined();
        expect(sides.toLegacySide("Delta")).toBe(SideType.Civilian);

        const countryRules = countries.definitionOrder().map((descriptor) =>
            new CountryRules(descriptor.id).readIni(sections.get(descriptor.id)!, sides, {
                order: descriptor.order,
                networkIndex: descriptor.order,
            }));
        const runtimeRules = Object.create(Rules.prototype) as any;
        runtimeRules.countryRegistry = countries;
        runtimeRules.countryRules = new Map(countryRules.map((rules) => [rules.id.toLowerCase(), rules]));
        expect(runtimeRules.getMultiplayerCountries().map((country: CountryRules) => country.id)).toEqual([
            "AlphaCountry",
            "GammaCountry",
            "DeltaCountry",
        ]);
        expect(runtimeRules.getCountryByMultiplayerIndex(2).id).toBe("DeltaCountry");
        expect(Country.factory("DeltaCountry", runtimeRules).sideId).toBe("Delta");
    });

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
            tooltipColor: "12,34,56",
        }, SideType.Civilian);

        expect(presentation).toEqual({
            id: "Foehn",
            hudLayout: "soviet",
            sidebarMixFileIndex: 4,
            useYuriFileNames: false,
            tooltipColor: "rgb(12,34,56)",
            evaTag: "Foehn",
            loadingTheme: undefined,
            graphicalTextImage: "grfxtxt.shp",
            graphicalTextPalette: "grfxtxt.pal",
        });
        expect(resolveSidePresentation(undefined, SideType.GDI).hudLayout).toBe("allied");
        expect(resolveSidePresentation(undefined, SideType.Yuri, true).hudLayout).toBe("yuri");
    });

    test("does not turn Yuri-named sidebar assets into Yuri HUD geometry", () => {
        const presentation = resolveSidePresentation({
            id: "Foehn",
            presentationId: "FourthSide",
            sidebarMixFileIndex: 4,
            sidebarYuriFileNames: true,
        }, SideType.Civilian);

        expect(presentation.hudLayout).toBe("soviet");
        expect(presentation.useYuriFileNames).toBe(true);
    });

    test("gives a country loading theme precedence over its side default", () => {
        expect(resolveLoadingTheme({ id: "Foehn", loadingTheme: "FOEHN_SIDE" }, undefined)).toBe("FOEHN_SIDE");
        expect(resolveLoadingTheme({ id: "Foehn", loadingTheme: "FOEHN_SIDE" }, { loadingTheme: "FOEHN_COUNTRY" })).toBe("FOEHN_COUNTRY");
    });

    test("keeps custom graphical result art in the generic side presentation", () => {
        expect(resolveSidePresentation({
            id: "Foehn",
            graphicalTextImage: "foehnresult.shp",
            graphicalTextPalette: "foehnresult.pal",
        }, SideType.Civilian)).toMatchObject({
            graphicalTextImage: "foehnresult.shp",
            graphicalTextPalette: "foehnresult.pal",
        });
    });

    test("uses data-defined score assets for custom sides", () => {
        expect(resolveMultiplayerScorePresentation({
            id: "Foehn",
            index: 3,
            multiplayerScoreBackground: "foehn_score.shp",
            multiplayerScorePalette: "foehn_score.pal",
            multiplayerScoreBars: "foehn_score~~.pcx",
        }, SideType.Civilian)).toEqual({
            image: "foehn_score.shp",
            palette: "foehn_score.pal",
            bars: "foehn_score~~.pcx",
            winTheme: undefined,
            loseTheme: undefined,
        });
        expect(resolveMultiplayerScorePresentation({ id: "Foehn", index: 3 }, SideType.Civilian)).toEqual({
            image: "mpyscrnl.shp",
            palette: "mpyscrn.pal",
            bars: "mpyscrnlbar~~.pcx",
            winTheme: undefined,
            loseTheme: undefined,
        });
    });

    test("expands the ten Ares multiplayer score bar assets", () => {
        expect(expandAresMultiplayerScoreBars("score~~.pcx")).toEqual([
            "score01.pcx", "score02.pcx", "score03.pcx", "score04.pcx", "score05.pcx",
            "score06.pcx", "score07.pcx", "score08.pcx", "score09.pcx", "score10.pcx",
        ]);
        expect(expandAresMultiplayerScoreBars("score.pcx")).toEqual(["score.pcx"]);
        expect(expandAresMultiplayerScoreBars(undefined)).toEqual([]);
    });

    test("preserves data-defined country metadata in runtime Country objects", () => {
        const side = new IniSection("Epsilon");
        side.set("Presentation", "epsilon");
        const country = new IniSection("EpsilonCountry");
        country.set("Side", "Epsilon");
        country.set("UIName", "TXT_EPSILON_COUNTRY");
        country.set("MenuText.Status", "STT_EPSILON_COUNTRY");
        country.set("File.Flag", "epsilon_flag.pcx");
        country.set("File.LoadScreen", "epsilon_load.shp");
        country.set("File.LoadScreenPAL", "epsilon_load.pal");
        country.set("LoadScreenText.Name", "Name:EPSILON");
        country.set("LoadScreenText.Color", "EpsilonLoad");
        country.set("Multiplay", "yes");
        country.set("CanBeDriven", "no");
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
        const rules = new CountryRules("EpsilonCountry").readIni(country, sides, { order: 7, networkIndex: 3 });
        const runtimeCountry = new Country(rules);

        expect(countries.resolve("epsiloncountry")?.flag).toBe("epsilon_flag.pcx");
        expect(runtimeCountry.sideId).toBe("Epsilon");
        expect(runtimeCountry.presentationId).toBe("epsilon");
        expect(runtimeCountry.flag).toBe("epsilon_flag.pcx");
        expect(runtimeCountry.loadScreen).toBe("epsilon_load.shp");
        expect(runtimeCountry.loadScreenPalette).toBe("epsilon_load.pal");
        expect(runtimeCountry.uiTooltip).toBe("STT_EPSILON_COUNTRY");
        expect(runtimeCountry.loadScreenTextName).toBe("Name:EPSILON");
        expect(runtimeCountry.loadScreenTextColor).toBe("EpsilonLoad");
        expect(runtimeCountry.id).toBe("EpsilonCountry");
        expect(runtimeCountry.order).toBe(7);
        expect(runtimeCountry.networkIndex).toBe(3);
        expect(runtimeCountry.legacySideFallback).toBe(true);
        expect(runtimeCountry.canBeDriven).toBe(false);
        expect(countries.resolve("epsiloncountry")?.canBeDriven).toBe(false);
    });

    test("matches dynamic country ownership fields case-insensitively", () => {
        const technoRules = Object.create(TechnoRules.prototype) as any;
        technoRules.owner = ["AlphaCountry"];
        technoRules.requiredHouses = ["AlphaCountry"];
        technoRules.forbiddenHouses = ["BetaCountry"];

        expect(technoRules.hasOwner({ name: "alphacountry" })).toBe(true);
        expect(technoRules.isAvailableTo({ name: "ALPHACOUNTRY" })).toBe(true);
        expect(technoRules.isAvailableTo({ name: "betacountry" })).toBe(false);
    });

    test("does not silently reuse Soviet paradrops for an unmapped authored side", () => {
        const general = new IniSection("General");
        general.set("AllyParaDropInf", "ENGINEER");
        general.set("AllyParaDropNum", "1");
        general.set("AmerParaDropInf", "ENGINEER");
        general.set("AmerParaDropNum", "1");
        general.set("SovParaDropInf", "CONS");
        general.set("SovParaDropNum", "4");
        general.set("YuriParaDropInf", "INIT");
        general.set("YuriParaDropNum", "2");
        general.set("ParadropPlane", "PDPLANE");
        general.set("ParadropRadius", "3");

        const sections = new Map<string, IniSection>();
        const sidesSection = new IniSection("Sides");
        sidesSection.set("0", "Alpha");
        sidesSection.set("1", "Beta");
        sections.set("Sides", sidesSection);
        const ini = { getSection: (name: string) => sections.get(name) };
        const sides = AresSideRegistry.fromIni(ini);
        const paradrop = new ParadropRules().readIni(general, sides);

        expect(paradrop.getParadropSquads("Alpha")).toEqual([]);
        expect(paradrop.getParadropSquads("Beta")).toEqual([]);
    });

    test("derives the legacy paradrop aircraft from the shared aircraft registry", () => {
        const general = new IniSection("General");
        const aircraftTypes = new IniSection("AircraftTypes");
        aircraftTypes.set("0", "CUSTOM_TRANSPORT");
        aircraftTypes.set("1", "CUSTOM_ATTACKER");
        const transport = new IniSection("CUSTOM_TRANSPORT");
        transport.set("Primary", "ParaDropWeapon");
        const attacker = new IniSection("CUSTOM_ATTACKER");
        attacker.set("Primary", "Maverick");
        const sections = new Map<string, IniSection>([
            ["AircraftTypes", aircraftTypes],
            ["CUSTOM_TRANSPORT", transport],
            ["CUSTOM_ATTACKER", attacker],
        ]);
        const rootIni = { getSection: (name: string) => sections.get(name) };

        expect(resolveParadropAircraft(general, rootIni)).toBe("CUSTOM_TRANSPORT");
        expect(new ParadropRules().readIni(general, undefined, rootIni)).toMatchObject({
            paradropPlane: "CUSTOM_TRANSPORT",
        });
    });

    test("allows Ares profiles with only custom paradrop aircraft", () => {
        const general = new IniSection("General");
        const aircraftTypes = new IniSection("AircraftTypes");
        aircraftTypes.set("0", "CUSTOM_ATTACKER");
        const attacker = new IniSection("CUSTOM_ATTACKER");
        attacker.set("Primary", "Maverick");
        const rootIni = {
            getSection: (name: string) => new Map([
                ["AircraftTypes", aircraftTypes],
                ["CUSTOM_ATTACKER", attacker],
            ]).get(name),
        };

        expect(() => new ParadropRules().readIni(general, undefined, rootIni as any)).not.toThrow();
        expect(resolveParadropAircraft(general, rootIni as any)).toBe("");
    });

    test("does not give a custom side a vanilla AI trigger identity", () => {
        expect(sideTypeToTriggerSide({
            side: SideType.Civilian,
            legacySideFallback: true,
            sideDefinition: { legacySide: undefined },
        })).toBeUndefined();
        expect(sideTypeToTriggerSide(SideType.GDI)).toBe(1);
        expect(sideTypeToTriggerSide(SideType.Yuri)).toBe(3);
    });

    test("keeps dynamic country and side identity in deterministic player state", () => {
        const alphaCountry = {
            id: "AlphaCountry",
            sideId: "Alpha",
            isPlayable: () => true,
        } as Country;
        const betaCountry = {
            id: "BetaCountry",
            sideId: "Beta",
            isPlayable: () => true,
        } as Country;
        const alphaPlayer = new Player("Alpha", alphaCountry);
        const betaPlayer = new Player("Beta", betaCountry);
        alphaPlayer.production = new Production(alphaPlayer, 9, {}, {}, []);

        const initialHash = alphaPlayer.getHash();
        alphaPlayer.production.addStolenTech("Gamma");
        const stolenTechHash = alphaPlayer.getHash();

        expect(stolenTechHash).not.toBe(initialHash);
        expect(alphaPlayer.getHash()).not.toBe(betaPlayer.getHash());
        expect(alphaPlayer.debugGetState()).toMatchObject({
            countryId: "AlphaCountry",
            sideId: "Alpha",
            production: {
                stolenTechs: ["Gamma"],
                permanentFactoryOwnerPlans: [],
            },
        });
    });
});
