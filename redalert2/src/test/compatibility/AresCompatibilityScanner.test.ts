import { describe, expect, test } from "bun:test";
import {
    formatMentalOmegaCompatibilityReport,
    scanMentalOmegaIniSources,
} from "@/extensions/ares/AresCompatibilityScanner";
import { ArmorRegistry, parseAresWarheadVerses } from "@/extensions/ares/AresArmor";
import { IniFile } from "@/data/IniFile";
import { AresCountryRegistry, AresSideRegistry } from "@/extensions/ares/AresSides";

describe("Ares compatibility scanner", () => {
    test("separates vanilla, known extension, and unknown extension keys", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[ArmorTypes]
magic=steel

[PulseWarhead]
Versus.magic=0.5
Ares.CustomArmor=yes

[FoehnUnit]
Cost=500
UnknownGameplayFlag=yes
`,
            },
        ]);

        expect(report.sourceCount).toBe(1);
        expect(report.knownExtensionKeys).toBe(3);
        expect(report.unknownExtensionKeys).toBe(1);
        expect(report.vanillaKeys).toBe(1);
        expect(report.featureUsage.find((item) => item.featureId === "ares.additional-armor-types")?.occurrences).toBe(3);
        expect(report.featureUsage.find((item) => item.featureId === "ares.unknown-key")?.occurrences).toBe(1);
    });

    test("maps documented extension families to separate capabilities", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "artmo.ini",
                contents: `
[CustomBuilding]
Foundation=Custom
Foundation.X=3
Foundation.Y=3
Foundation.0=0,0
FoundationOutline.Length=4
FoundationOutline.0=-1,-1
Ares.ProjectilePalette=laser.pal
Ares.PassengerDelete=yes
`,
            },
        ]);

        expect(report.featureUsage.map((usage) => usage.featureId)).toEqual(expect.arrayContaining([
            "ares.custom-foundations",
            "ares.custom-animation-palettes",
            "ares.passenger-extensions",
        ]));
    });

    test("formats an actionable report with verified runtime coverage", () => {
        const report = scanMentalOmegaIniSources([
            { name: "rulesmo.ini", contents: "[ArmorTypes]\nmagic=steel\n" },
        ]);
        const text = formatMentalOmegaCompatibilityReport(report);
        expect(text).toContain("MENTAL OMEGA EXTENSION REQUIREMENTS");
        expect(text).toContain("ares.additional-armor-types");
        expect(text).toContain("verified");
    });

    test("parses additional armor types and dynamic Versus values", () => {
        const ini = new IniFile(`
[ArmorTypes]
paper=steel
magic=11%

[PulseWarhead]
Verses=100%,50%,25%,100%,100%,100%,100%,100%,100%,100%,100%
Versus.paper=75%
Versus.magic=25%
Versus.magic.ForceFire=no
`);
        const registry = ArmorRegistry.fromIni(ini);
        const paper = registry.resolve("PAPER");
        const magic = registry.resolve("magic");
        const parsed = parseAresWarheadVerses(ini.getSection("PulseWarhead")!, registry);

        expect(paper).toBeGreaterThan(99);
        expect(magic).toBeGreaterThan(99);
        expect(parsed.verses.get(paper)).toBe(0.75);
        expect(parsed.verses.get(magic)).toBe(0.25);
        expect(parsed.behavior.get(magic)?.forceFire).toBe(false);
    });

    test("parses data-defined sides and countries without hardcoded MO names", () => {
        const ini = new IniFile(`
[Sides]
0=GDI
1=Nod
2=Epsilon
3=Foehn

[Epsilon]
UIName=TXT_EPSILON
Presentation=epsilon
Sidebar.MixFileIndex=4
EVA.Tag=Epsilon

[Foehn]
UIName=TXT_FOEHN
Presentation=foehn

[Countries]
0=FoehnCountry
1=EpsilonCountry

[FoehnCountry]
Side=Foehn
UIName=TXT_FOEHN_COUNTRY
Multiplay=yes
ListIndex=12

[EpsilonCountry]
Side=Epsilon
UIName=TXT_EPSILON_COUNTRY
Multiplay=yes
ListIndex=11
`);
        const sides = AresSideRegistry.fromIni(ini);
        const countries = AresCountryRegistry.fromIni(ini, sides);

        expect(sides.resolve("foehn")?.presentationId).toBe("foehn");
        expect(sides.resolve("epsilon")?.sidebarMixFileIndex).toBe(4);
        expect(countries.resolve("FoehnCountry")?.sideId).toBe("Foehn");
        expect(countries.list().map((country) => country.id)).toEqual(["EpsilonCountry", "FoehnCountry"]);
    });
});
