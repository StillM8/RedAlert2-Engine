import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import {
    DEFAULT_ARES_IFV_MODE,
    DEFAULT_ARES_WEAPON_TURRET_INDEX,
    getAresWeaponTurretIndex,
    parseAresIfvModeRules,
    parseAresPoweredByRules,
    parseAresTechnoExtensions,
} from "@/extensions/ares/AresTechnoExtensions";

function technoSection(source: string) {
    return new IniFile(source).getSection("Techno")!;
}

describe("Ares TechnoType data extensions", () => {
    test("parses IFV modes, 1-based weapon mappings, labels, and repair voice", () => {
        const rules = parseAresIfvModeRules(technoSection(`
[Techno]
IFVMode=4
WeaponTurretIndex1=2
WeaponTurretIndex5=7
WeaponUIName5=Name_IFV_Cannon
VoiceIFVRepair=IFVRepairVoice
`));

        expect(rules.ifvMode).toBe(4);
        expect(rules.weaponTurretIndexes).toEqual(new Map([[1, 2], [5, 7]]));
        expect(rules.weaponUiNames).toEqual(new Map([[5, "Name_IFV_Cannon"]]));
        expect(rules.voiceIfvRepair).toBe("IFVRepairVoice");
        expect(getAresWeaponTurretIndex(rules, 5)).toBe(7);
        expect(getAresWeaponTurretIndex(rules, 2)).toBe(DEFAULT_ARES_WEAPON_TURRET_INDEX);
    });

    test("uses deterministic defaults and ignores invalid or zero-based weapon keys", () => {
        const rules = parseAresIfvModeRules(technoSection(`
[Techno]
IFVMode=not-a-number
WeaponTurretIndex0=3
WeaponTurretIndex2=-4
WeaponTurretIndex3=4
WeaponUIName0=Ignored
VoiceIFVRepair=
`));

        expect(rules.ifvMode).toBe(DEFAULT_ARES_IFV_MODE);
        expect(rules.weaponTurretIndexes).toEqual(new Map([[2, -1], [3, 4]]));
        expect(rules.weaponUiNames).toEqual(new Map());
        expect(rules.voiceIfvRepair).toBeUndefined();
    });

    test("matches extension keys case-insensitively while preserving UI and voice values", () => {
        const rules = parseAresIfvModeRules(technoSection(`
[Techno]
ifvmode=8
weaponturretindex9=11
weaponuiname9=Name_MixedCase
voiceifvrepair=Repair_MixedCase
`));

        expect(rules.ifvMode).toBe(8);
        expect(rules.weaponTurretIndexes.get(9)).toBe(11);
        expect(rules.weaponUiNames.get(9)).toBe("Name_MixedCase");
        expect(rules.voiceIfvRepair).toBe("Repair_MixedCase");
    });

    test("normalizes PoweredBy as a case-preserving OR-list", () => {
        const rules = parseAresPoweredByRules(technoSection(`
[Techno]
PoweredBy=PowerCore,  powercore , ,AuxGenerator, AUXGENERATOR
`));

        expect(rules).toEqual({
            providers: ["PowerCore", "powercore", "AuxGenerator", "AUXGENERATOR"],
            relation: "any",
        });
    });

    test("defaults missing PoweredBy to no providers and composes both models", () => {
        const section = technoSection(`
[Techno]
IFVMode=1
`);
        expect(parseAresPoweredByRules(section)).toEqual({ providers: [], relation: "any" });
        expect(parseAresTechnoExtensions(section)).toEqual({
            ifv: {
                ifvMode: 1,
                weaponTurretIndexes: new Map(),
                weaponUiNames: new Map(),
            },
            poweredBy: { providers: [], relation: "any" },
        });
    });
});
