import { describe, expect, test } from "bun:test";
import {
    formatMentalOmegaCompatibilityReport,
    scanMentalOmegaIniSources,
    scanMentalOmegaVfs,
} from "@/extensions/ares/AresCompatibilityScanner";
import { createDefaultAresFeatureRegistry } from "@/extensions/ares/AresFeatureRegistry";
import { ArmorRegistry, parseAresWarheadVerses } from "@/extensions/ares/AresArmor";
import { IniFile } from "@/data/IniFile";
import { AresCountryRegistry, AresSideRegistry } from "@/extensions/ares/AresSides";
import { IniSourceLoader } from "@/engine/IniSourceLoader";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { MemArchive } from "@/data/vfs/MemArchive";
import { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";

describe("Ares compatibility scanner", () => {
    test("separates vanilla, Ares-known, and unclassified keys", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[ArmorTypes]
magic=steel

[TechnoTypes]
0=FoehnUnit

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
        expect(report.aresKnownKeys).toBe(2);
        expect(report.unclassifiedKeys).toBe(2);
        expect(report.vanillaKeys).toBe(2);
        const armorUsage = report.featureUsage.find((item) => item.featureId === "ares.additional-armor-types");
        expect(armorUsage?.occurrences).toBe(2);
        expect(armorUsage?.sourceCount).toBe(1);
        expect(armorUsage?.sectionCount).toBe(2);
        expect(armorUsage?.definitionCount).toBe(2);
        expect(report.featureUsage.find((item) => item.featureId === "ares.unknown-key")).toBeUndefined();
        expect(report.unclassifiedUsage.find((item) => item.key === "Ares.CustomArmor")?.occurrences).toBe(1);
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
CustomPalette=laser.pal
PassengerDelete=yes
`,
            },
        ]);

        expect(report.featureUsage.map((usage) => usage.featureId)).toEqual(expect.arrayContaining([
            "ares.custom-foundations",
            "ares.custom-animation-palettes",
            "ares.passenger-extensions",
        ]));
    });

    test("classifies the complete MO Airburst/Splits field family", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[MOProjectile]
Airburst=yes
AirburstWeapon=MOFrag
Cluster=2
AirburstSpread=3
AroundTarget=yes
Splits=yes
RetargetAccuracy=80%
RetargetSelf=no
Proximity=yes
`,
            },
        ]);

        const usage = report.featureUsage.find((item) => item.featureId === "ares.projectile-extensions");
        expect(usage?.occurrences).toBe(9);
        expect(usage?.definitionCount).toBe(1);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });

    test("classifies documented Chronoshift eligibility fields as Ares requirements", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[ChronoTank]
Chronoshift.Allow=no
Chronoshift.Crushable=no

[ChronoBuilding]
Chronoshift.IsVehicle=yes
`,
            },
        ]);

        const usage = report.featureUsage.find((item) => item.featureId === "ares.chronoshift");
        expect(usage?.occurrences).toBe(3);
        expect(usage?.support?.implemented).toBe(false);
        expect(report.unclassifiedKeys).toBe(0);
    });

    test("classifies MO-used veterancy, insignia, and bounty fields as generic Ares requirements", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[TechnoTypes]
0=MOUnit

[MOUnit]
Trainable=no
Insignia.Elite=MOELITE
InsigniaFrame.Veteran=2
Bounty=yes
Bounty.Display=yes
Bounty.Value=100
Bounty.RookieValue=100
Bounty.VeteranValue=200
Bounty.EliteValue=300

[General]
BountyEnablers=MOHQ

[AudioVisual]
BountyDisplay=yes

[Countries]
0=MOCountry

[MOCountry]
GivesBounty=no
`,
            },
        ]);

        expect(report.featureUsage.find((item) => item.featureId === "ares.customizable-veterancy")?.occurrences).toBe(1);
        expect(report.featureUsage.find((item) => item.featureId === "ares.customizable-insignia")?.occurrences).toBe(2);
        expect(report.featureUsage.find((item) => item.featureId === "ares.bounty")?.occurrences).toBe(9);
        expect(report.unclassifiedKeys).toBe(0);
    });

    test("classifies MO-used AttachEffect, IFVMode, and PoweredBy fields as generic Ares requirements", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[TechnoTypes]
0=MOUnit

[MOUnit]
AttachEffect.Duration=120
AttachEffect.Animation=MOEffect
IFVMode=4
PoweredBy=MOGenerator
`,
            },
        ]);

        expect(report.featureUsage.find((item) => item.featureId === "ares.status-effects")?.occurrences).toBe(2);
        expect(report.featureUsage.find((item) => item.featureId === "ares.ifv-modes")?.occurrences).toBe(1);
        expect(report.featureUsage.find((item) => item.featureId === "ares.powered-by")?.occurrences).toBe(1);
        expect(report.unclassifiedKeys).toBe(0);
    });

    test("classifies MO-used Chrono Prison and Urban Combat fields as generic Ares requirements", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[WeaponTypes]
0=MOAbductorWeapon

[MOAbductorWeapon]
Abductor=yes
Abductor.Temporal=yes
Abductor.AbductBelowPercent=75%

[BuildingTypes]
0=MOTrench

[MOTrench]
UC.PassThrough=50%
UC.FatalRate=10%
UC.DamageMultiplier=125%
Bunker.Raidable=yes
Rubble.Destroyed=MOTrenchRubble
Rubble.Intact=MOTrench
IsTrench=MOTrenchType
CanBeOccupiedBy=MOInfantry

[ProjectileTypes]
0=MOProjectile

[MOProjectile]
SubjectToTrenches=no

[VehicleTypes]
0=MOAbductable

[MOAbductable]
PassengerTurret=yes
ImmuneToAbduction=no
`,
            },
        ]);

        expect(report.featureUsage.find((item) => item.featureId === "ares.chrono-prisons")?.occurrences).toBe(5);
        expect(report.featureUsage.find((item) => item.featureId === "ares.urban-combat")?.occurrences).toBe(9);
        expect(report.unclassifiedKeys).toBe(0);
    });

    test("keeps common YR object and projectile fields vanilla without inferring Ares", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[TechnoTypes]
0=MOUnit

[MOUnit]
CanHideThings=yes
DamageFireOffset1=10,20
CrushSound=TankCrush
VoiceAttack=MOAttack
LeaveRubble=yes
PrimaryFireFLH=10,0,20
Turret=yes
MoveSound=MOMove
ZAdjust=-2
Weight=3
RadarInvisible=yes
CrateGoodie=yes

[ProjectileTypes]
0=MOProjectile

[MOProjectile]
SubjectToElevation=yes
SubjectToCliffs=no
SubjectToWalls=yes
Conventional=yes
`,
            },
        ]);

        expect(report.vanillaKeys).toBe(18);
        expect(report.aresKnownKeys).toBe(0);
        expect(report.unclassifiedKeys).toBe(0);
    });

    test("classifies documented Ares superweapon extensions", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[SuperWeaponTypes]
0=MOGeneric

[MOGeneric]
Type=GenericWarhead
SW.Damage=500
SW.Warhead=MOBlast
SW.AffectsTarget=land,units
SW.Animation=MOBlastAnim
SW.AnimationHeight=4
SW.AnimationVisibility=owner
SW.Sound=MOBlastImpact
SW.ActivationSound=MOBlastLaunch
Deliver.Types=MOUnit
`,
            },
        ]);

        const usage = report.featureUsage.find((item) => item.featureId === "ares.custom-superweapons");
        expect(usage?.occurrences).toBe(9);
        expect(usage?.definitionCount).toBe(1);
        expect(usage?.support?.implemented).toBe(false);
        expect(report.featureUsage.find((item) => item.featureId === "ares.target-filters")?.occurrences).toBe(1);
    });

    test("tracks manual superweapon target requirements separately from effect handlers", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[MOProtect]
Type=GenericWarhead
SW.RequiresTarget=Land,Buildings
SW.RequiresHouse=Team
`,
            },
        ]);

        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-target-requirements");
        expect(usage?.occurrences).toBe(2);
        expect(usage?.definitionCount).toBe(1);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });

    test("classifies SW.FireIntoShroud as a common visibility gate", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[MOReveal]
Type=GenericWarhead
SW.FireIntoShroud=no
`,
            },
        ]);

        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-shroud-targeting");
        expect(usage?.occurrences).toBe(1);
        expect(usage?.definitionCount).toBe(1);
        expect(usage?.support?.runtimeImplemented).toBe(true);
        expect(report.unclassifiedKeys).toBe(0);
    });

    test("classifies AutoFire and ManualFire as one activation-policy capability", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[MOAuto]
Type=GenericWarhead
SW.AutoFire=yes
SW.ManualFire=no
`,
            },
        ]);

        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-fire-mode");
        expect(usage?.occurrences).toBe(2);
        expect(usage?.definitionCount).toBe(1);
        expect(usage?.support?.runtimeImplemented).toBe(true);
        expect(report.unclassifiedKeys).toBe(0);
    });

    test("classifies EMPulse fields and launch-site flags as one capability", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[EMPulseSW]
Type=EMPulse
EMPulse.Linked=yes
EMPulse.TargetSelf=no
EMPulse.PulseDelay=32
EMPulse.Cannons=PulseCannon

[PulseCannon]
EMPulseCannon=yes
`,
            },
        ]);

        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-empulse");
        expect(usage?.occurrences).toBe(6);
        expect(report.unclassifiedKeys).toBe(0);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });

    test("classifies EMP duration, immunity, modifier, and threshold separately", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[EMPWarhead]
EMP.Duration=150
EMP.Cap=300

[EMPUnit]
ImmuneToEMP=no
EMP.Modifier=50%
EMP.Threshold=inair
`,
            },
        ]);

        expect(report.featureUsage.find((item) => item.featureId === "ares.emp")?.occurrences).toBe(4);
        expect(report.featureUsage.find((item) => item.featureId === "ares.emp-threshold")?.occurrences).toBe(1);
        expect(report.featureUsage.find((item) => item.featureId === "ares.emp")?.support?.runtimeImplemented).toBe(true);
        expect(report.featureUsage.find((item) => item.featureId === "ares.emp-threshold")?.support?.parserImplemented).toBe(true);
    });

    test("classifies documented prerequisite extensions and factory-owner country edges", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[GenericPrerequisites]
NAVALYARD=GAYARD,NAYARD

[General]
PrerequisiteNavalyardAlternate=SHMIN

[TechnoTypes]
0=TestUnit

[TestUnit]
Prerequisite.Lists=1
Prerequisite.List1=GATECH
Prerequisite.RequiredTheaters=SNOW
FactoryOwners=AlphaCountry
FactoryOwners.Forbidden=BetaCountry
`,
            },
        ]);

        expect(report.unclassifiedKeys).toBe(0);
        expect(report.featureUsage.find((usage) => usage.featureId === "ares.generic-prerequisites")?.occurrences).toBe(5);
        expect(report.featureUsage.find((usage) => usage.featureId === "ares.factory-owner-prerequisites")?.occurrences).toBe(2);
        expect(report.dependencyGraph.edges.filter((edge) => edge.kind === "country").map((edge) => edge.value)).toEqual([
            "AlphaCountry",
            "BetaCountry",
        ]);
    });

    test("formats an actionable report with verified runtime coverage", () => {
        const report = scanMentalOmegaIniSources([
            { name: "rulesmo.ini", contents: "[ArmorTypes]\nmagic=steel\n" },
        ]);
        const text = formatMentalOmegaCompatibilityReport(report);
        expect(text).toContain("MENTAL OMEGA EXTENSION REQUIREMENTS");
        expect(text).toContain("ares.additional-armor-types");
        expect(text).toContain("definition(s)");
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

    test("marks dynamic side and country runtime coverage in the feature registry", () => {
        const registry = createDefaultAresFeatureRegistry();
        expect(registry.get("ares.custom-sides")).toMatchObject({
            implemented: true,
            parserImplemented: true,
            runtimeImplemented: true,
        });
        expect(registry.get("ares.custom-countries")).toMatchObject({
            implemented: true,
            parserImplemented: true,
            runtimeImplemented: true,
        });
    });

    test("scans the effective INI graph instead of only the root file", () => {
        const archive = new MemArchive();
        archive.addFile(VirtualFile.fromBytes(new TextEncoder().encode(`[#include]\n1=rules_units.ini\n`), "rulesmo.ini"));
        archive.addFile(VirtualFile.fromBytes(new TextEncoder().encode(`[PulseWarhead]\nVersus.magic=25%\n`), "rules_units.ini"));
        const vfs = new VirtualFileSystem(undefined as any, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });
        vfs.addArchive(archive, "expandmo95.mix");
        const report = scanMentalOmegaVfs(vfs, undefined, new IniSourceLoader(vfs));

        expect(report.references.some((reference) => reference.source === "rulesmo.ini (effective)" && reference.key === "Versus.magic")).toBe(true);
        expect(report.featureUsage.find((usage) => usage.featureId === "ares.additional-armor-types")?.occurrences).toBe(1);
    });

    test("resolves the complete Mental Omega canonical INI set", () => {
        const archive = new MemArchive();
        const files: Record<string, string> = {
            "rulesmo.ini": "[General]\nName=MentalOmegaRules\n",
            "artmo.ini": "[MOArt]\nImage=MOART\n",
            "aimo.ini": "[AI]\n0=MOAI\n",
            "uimd.ini": "[UI]\nName=MentalOmegaUI\n",
            "soundmo.ini": "[SoundList]\n0=MentalOmegaSound\n",
        };
        for (const [filename, contents] of Object.entries(files)) {
            archive.addFile(VirtualFile.fromBytes(new TextEncoder().encode(contents), filename));
        }
        const vfs = new VirtualFileSystem(undefined as any, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });
        vfs.addArchive(archive, "expandmo99.mix");

        const report = scanMentalOmegaVfs(vfs);

        expect(report.sourceCount).toBe(5);
        expect(new Set(report.references.map((reference) => reference.source))).toEqual(new Set(Object.keys(files)));
        expect(report.references.some((reference) => reference.source === "soundmo.ini")).toBe(true);
    });

    test("builds side/country and gameplay dependency coverage from effective sources", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "rulesmo.ini",
                contents: `
[Sides]
0=Alpha
1=Beta
2=Gamma
3=Delta

[Countries]
0=AlphaCountry
1=BetaCountry
2=GammaCountry
3=DeltaCountry

[AlphaCountry]
Side=Alpha

[BetaCountry]
Side=Beta

[GammaCountry]
Side=Gamma

[DeltaCountry]
Side=Delta

[TechnoTypes]
0=TestTank

[WeaponTypes]
0=TestWeapon

[ProjectileTypes]
0=TestProjectile

[WarheadTypes]
0=TestWarhead

[TestTank]
Primary=TestWeapon
Owner=AlphaCountry

[TestWeapon]
Projectile=TestProjectile
Warhead=TestWarhead
`,
            },
        ]);

        const sideNodes = report.dependencyGraph.nodes.filter((node) => node.kind === "side");
        const countryNodes = report.dependencyGraph.nodes.filter((node) => node.kind === "country");
        expect(sideNodes.map((node) => node.name)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
        expect(countryNodes.map((node) => node.name)).toEqual(["AlphaCountry", "BetaCountry", "GammaCountry", "DeltaCountry"]);
        expect(report.dependencyGraph.edges.filter((edge) => edge.kind === "side")).toHaveLength(4);
        expect(report.dependencyGraph.edges.some((edge) => edge.kind === "weapon" && edge.value === "TestWeapon" && edge.resolved)).toBe(true);
        expect(report.dependencyGraph.edges.some((edge) => edge.kind === "projectile" && edge.value === "TestProjectile" && edge.resolved)).toBe(true);
        expect(report.dependencyGraph.edges.some((edge) => edge.kind === "warhead" && edge.value === "TestWarhead" && edge.resolved)).toBe(true);
        expect(report.dependencyGraph.unresolved).toHaveLength(0);
        expect(report.sideCountryCoverage).toEqual({
            sideDefinitions: 4,
            sideReferences: 4,
            unknownSideReferences: 0,
            countryDefinitions: 4,
            countryReferences: 1,
            unknownCountryReferences: 0,
        });

        const text = formatMentalOmegaCompatibilityReport(report);
        expect(text).toContain("side: 4 definition(s)");
        expect(text).toContain("country: 4 definition(s)");
    });
});
