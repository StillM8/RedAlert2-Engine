import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import {
    parseAresInsigniaRules,
    resolveAresInsigniaShowEnemy,
    selectAresInsignia,
} from "@/extensions/ares/AresInsignia";
import { TechnoRules } from "@/game/rules/TechnoRules";

describe("Ares customizable insignia", () => {
    test("defaults to vanilla pips when no Insignia fields are authored", () => {
        const section = new IniSection("VanillaUnit");

        expect(parseAresInsigniaRules(section)).toBeUndefined();
        expect(resolveAresInsigniaShowEnemy(section)).toBe(true);
        expect(selectAresInsignia(undefined, 0)).toBeUndefined();
        expect(selectAresInsignia(undefined, 1)).toBeUndefined();
    });

    test("parses rank-specific SHPs and uses the first frame for -1/default", () => {
        const section = new IniFile(`
[Unit]
Insignia.Rookie=RookieChevrons
Insignia.Veteran=VeteranChevrons
Insignia.Elite=EliteChevrons
InsigniaFrame.Veteran=2
`).getSection("Unit")!;
        const rules = parseAresInsigniaRules(section);

        expect(rules).toMatchObject({
            rookie: "RookieChevrons",
            veteran: "VeteranChevrons",
            elite: "EliteChevrons",
            rookieFrame: -1,
            veteranFrame: 2,
            eliteFrame: -1,
            showEnemy: true,
        });
        expect(selectAresInsignia(rules, 0)).toEqual({ fileName: "RookieChevrons", frame: 0 });
        expect(selectAresInsignia(rules, 1)).toEqual({ fileName: "VeteranChevrons", frame: 2 });
        expect(selectAresInsignia(rules, 2)).toEqual({ fileName: "EliteChevrons", frame: 0 });
    });

    test("preserves explicit zero frame and case-insensitive Ares keys", () => {
        const section = new IniSection("MixedCaseUnit");
        section.set("insignia.elite", "EliteChevrons");
        section.set("insigniaframe.elite", "0");
        section.set("insignia.showenemy", "no");

        const rules = parseAresInsigniaRules(section, true)!;
        expect(rules.eliteFrame).toBe(0);
        expect(rules.showEnemy).toBe(false);
        expect(resolveAresInsigniaShowEnemy(section, true)).toBe(false);
        expect(selectAresInsignia(rules, 2)).toEqual({ fileName: "EliteChevrons", frame: 0 });
    });

    test("wires General EnemyInsignia and TechnoType override into TechnoRules", () => {
        const hidden = new IniSection("HiddenUnit");
        hidden.set("Insignia.Veteran", "VeteranChevrons");
        const hiddenRules = new TechnoRules(ObjectType.Infantry, hidden, 0, { enemyInsignia: false }, new ArmorRegistry());
        expect(hiddenRules.insigniaShowEnemy).toBe(false);
        expect(hiddenRules.aresInsignia?.showEnemy).toBe(false);

        const visible = new IniSection("VisibleUnit");
        visible.set("Insignia.ShowEnemy", "yes");
        const visibleRules = new TechnoRules(ObjectType.Infantry, visible, 0, { enemyInsignia: false }, new ArmorRegistry());
        expect(visibleRules.insigniaShowEnemy).toBe(true);
    });
});
