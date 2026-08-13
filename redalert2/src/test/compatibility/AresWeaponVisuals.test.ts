import { describe, expect, test } from "bun:test";
import { IniFile, IniSection } from "@/data/IniFile";
import {
    parseAresRgb,
    parseAresWeaponTypeNames,
    parseAresWeaponVisualRules,
} from "@/extensions/ares/AresWeaponVisuals";
import { WeaponRules } from "@/game/rules/WeaponRules";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";

describe("Ares weapon visual extensions", () => {
    test("parses RGB values, clamps channels, and rejects incomplete values", () => {
        expect(parseAresRgb("(12, 34, 56)")).toEqual([12, 34, 56]);
        expect(parseAresRgb("(-5, 260, 12.4)")).toEqual([0, 255, 12]);
        expect(parseAresRgb("(12, 34)")).toBeUndefined();
        expect(parseAresRgb("not a color")).toBeUndefined();
    });

    test("uses Ares defaults and preserves independently omitted bolt colors", () => {
        const section = new IniSection("Weapon");
        section.set("Beam.Color", "(10, 20, 30)");
        section.set("Beam.IsHouseColor", "yes");
        section.set("Beam.Duration", "24");
        section.set("Beam.Amplitude", "55.5");
        section.set("Bolt.Color2", "(1,2,3)");
        section.set("Wave.IsLaser", "true");
        section.set("Wave.Color", "(200, 100, 50)");

        expect(parseAresWeaponVisualRules(section)).toEqual({
            beamColor: [10, 20, 30],
            beamDuration: 24,
            beamAmplitude: 55.5,
            beamIsHouseColor: true,
            boltColors: [undefined, [1, 2, 3], undefined],
            waveIsLaser: true,
            waveIsBigLaser: false,
            waveColor: [200, 100, 50],
            waveIsHouseColor: false,
            waveReverseAgainstVehicles: false,
            waveReverseAgainstAircraft: false,
            waveReverseAgainstBuildings: false,
            waveReverseAgainstInfantry: false,
            waveReverseAgainstOthers: false,
        });

        const defaults = parseAresWeaponVisualRules(new IniSection("PlainWeapon"));
        expect(defaults.beamDuration).toBe(15);
        expect(defaults.beamAmplitude).toBe(40);
        expect(defaults.boltColors).toEqual([undefined, undefined, undefined]);
        expect(defaults.waveIsLaser).toBe(false);
        expect(defaults.waveReverseAgainstVehicles).toBe(false);

        const magBeam = new IniSection("MagneticBeam");
        magBeam.set("IsMagBeam", "yes");
        expect(parseAresWeaponVisualRules(magBeam).waveReverseAgainstVehicles).toBe(true);
    });

    test("routes weapon visual fields through WeaponRules", () => {
        const section = new IniSection("MOWeapon");
        section.set("Damage", "100");
        section.set("Projectile", "Invisible");
        section.set("Warhead", "MOWarhead");
        section.set("Beam.Duration", "18");
        section.set("Wave.IsBigLaser", "yes");
        section.set("Wave.ReverseAgainstBuildings", "true");

        const rules = new WeaponRules(section);

        expect(rules.aresWeaponVisuals.beamDuration).toBe(18);
        expect(rules.aresWeaponVisuals.waveIsBigLaser).toBe(true);
        expect(rules.aresWeaponVisuals.waveReverseAgainstBuildings).toBe(true);
    });

    test("registers standalone Ares [WeaponTypes] declarations", () => {
        const ini = new IniFile(`
[WeaponTypes]
0=MOBeamWeapon
1=MOBoltWeapon
`);

        expect(parseAresWeaponTypeNames(ini)).toEqual(["MOBeamWeapon", "MOBoltWeapon"]);
    });

    test("classifies authored weapon visual keys as one Ares capability", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: `
[WeaponTypes]
0=MOBeam
[MOBeam]
Beam.Color=(255,0,0)
Beam.Duration=12
Bolt.Color1=(1,2,3)
Wave.IsBigLaser=yes
Wave.ReverseAgainstOthers=yes
`,
        }]);

        const usage = report.featureUsage.find((entry) => entry.featureId === "ares.weapon-visuals");
        expect(usage?.occurrences).toBe(5);
        expect(usage?.definitionCount).toBe(1);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
