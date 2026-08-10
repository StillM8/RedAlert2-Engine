import { describe, expect, test } from "bun:test";
import { ArmorRegistry, canUseArmorVersus, parseAresWarheadVerses } from "@/extensions/ares/AresArmor";
import { IniFile } from "@/data/IniFile";

describe("Ares armor targeting", () => {
    test("honors the documented 0%, 1%, and 2% acquisition gates", () => {
        const ini = new IniFile(`
[WH0]
Versus.magic=0%

[WH1]
Versus.magic=1%

[WH2]
Versus.magic=2%
`);
        const registry = new ArmorRegistry();
        const magic = registry.register("magic");
        const parsed0 = parseAresWarheadVerses(ini.getSection("WH0")!, registry);
        const parsed1 = parseAresWarheadVerses(ini.getSection("WH1")!, registry);
        const parsed2 = parseAresWarheadVerses(ini.getSection("WH2")!, registry);

        expect(canUseArmorVersus(parsed0.verses, parsed0.behavior, magic, { forceFire: true })).toBe(false);
        expect(canUseArmorVersus(parsed0.verses, parsed0.behavior, magic, { retaliate: true })).toBe(false);
        expect(canUseArmorVersus(parsed0.verses, parsed0.behavior, magic, { passiveAcquire: true })).toBe(false);

        expect(canUseArmorVersus(parsed1.verses, parsed1.behavior, magic, { forceFire: true })).toBe(true);
        expect(canUseArmorVersus(parsed1.verses, parsed1.behavior, magic, { retaliate: true })).toBe(false);
        expect(canUseArmorVersus(parsed1.verses, parsed1.behavior, magic, { passiveAcquire: true })).toBe(false);

        expect(canUseArmorVersus(parsed2.verses, parsed2.behavior, magic, { retaliate: true })).toBe(true);
        expect(canUseArmorVersus(parsed2.verses, parsed2.behavior, magic, { passiveAcquire: true })).toBe(false);
    });

    test("allows an explicit zero-damage targetability override", () => {
        const ini = new IniFile(`
[IceBlast]
Versus.magic=0%
Versus.magic.ForceFire=yes
Versus.magic.Retaliate=yes
Versus.magic.PassiveAcquire=yes
`);
        const registry = new ArmorRegistry();
        const magic = registry.register("magic");
        const parsed = parseAresWarheadVerses(ini.getSection("IceBlast")!, registry);

        expect(canUseArmorVersus(parsed.verses, parsed.behavior, magic, { forceFire: true })).toBe(true);
        expect(canUseArmorVersus(parsed.verses, parsed.behavior, magic, { retaliate: true })).toBe(true);
        expect(canUseArmorVersus(parsed.verses, parsed.behavior, magic, { passiveAcquire: true })).toBe(true);
    });
});

