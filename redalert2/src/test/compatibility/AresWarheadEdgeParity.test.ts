import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { WarheadRules } from "@/game/rules/WarheadRules";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";

function makeWarhead(key: string, value: string | boolean | number): WarheadRules {
    const section = new IniSection("TestWH");
    section.set(key, String(value));
    return new WarheadRules(section, new ArmorRegistry());
}

describe("Ares warhead edge parity fields", () => {
    test("AffectsOwner defaults to AffectsAllies", () => {
        const rules = makeWarhead("AffectsAllies", "false");
        expect(rules.affectsOwner).toBe(false);
    });

    test("AffectsOwner can be explicitly true while AffectsAllies is false", () => {
        const section = new IniSection("TestWH");
        section.set("AffectsAllies", "false");
        section.set("AffectsOwner", "true");
        const rules = new WarheadRules(section, new ArmorRegistry());
        expect(rules.affectsOwner).toBe(true);
    });

    test("AllowZeroDamage defaults to false", () => {
        expect(makeWarhead("Dummy", "x").allowZeroDamage).toBe(false);
    });

    test("Malicious defaults to true", () => {
        expect(makeWarhead("Dummy", "x").malicious).toBe(true);
    });

    test("PreventScatter defaults to false", () => {
        expect(makeWarhead("Dummy", "x").preventScatter).toBe(false);
    });

    test("parses all four documented fields", () => {
        const section = new IniSection("TestWH");
        section.set("AllowZeroDamage", "true");
        section.set("Malicious", "false");
        section.set("PreventScatter", "true");
        section.set("AffectsOwner", "true");
        const rules = new WarheadRules(section, new ArmorRegistry());
        expect(rules.allowZeroDamage).toBe(true);
        expect(rules.malicious).toBe(false);
        expect(rules.preventScatter).toBe(true);
        expect(rules.affectsOwner).toBe(true);
    });
});
