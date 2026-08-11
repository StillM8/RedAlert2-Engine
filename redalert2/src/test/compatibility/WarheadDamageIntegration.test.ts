import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { Warhead } from "@/game/Warhead";
import { WarheadRules } from "@/game/rules/WarheadRules";
import { ArmorType } from "@/game/type/ArmorType";

function makeTarget() {
    return {
        rules: { armor: ArmorType.Heavy, wall: false },
        invulnerableTrait: { isActive: () => false },
        crateBonuses: { armor: 1 },
        isTechno: () => true,
        isUnit: () => true,
        isInfantry: () => false,
        isAircraft: () => false,
        isOverlay: () => false,
        isTerrain: () => false,
        isBuilding: () => false,
        isBridge: () => false,
    } as any;
}

function damageForVerses(verses: string | undefined): number {
    const section = new IniSection("WarheadDamage");
    if (verses !== undefined) section.set("Verses", verses);
    const warhead = new Warhead(new WarheadRules(section) as any);
    return warhead.computeDamage(100, makeTarget(), { gameOpts: { destroyableBridges: true } } as any);
}

describe("Warhead Verses damage integration", () => {
    test.each([
        ["0%", 0],
        ["1%", 1],
        ["2%", 2],
        ["100%", 100],
    ])("preserves an authored %s damage multiplier", (verses, expected) => {
        expect(damageForVerses(`1,1,1,1,1,${verses}`)).toBe(expected);
    });

    test("falls back only when a Verses entry is absent", () => {
        expect(damageForVerses(undefined)).toBe(100);
        expect(damageForVerses("1,1,1,1,1")).toBe(100);
    });

    test("keeps ForceFire, Retaliate, and PassiveAcquire separate from damage", () => {
        const section = new IniSection("TargetingOnly");
        section.set("Versus.heavy", "0%");
        section.set("Versus.heavy.ForceFire", "yes");
        section.set("Versus.heavy.Retaliate", "no");
        section.set("Versus.heavy.PassiveAcquire", "yes");
        const rules = new WarheadRules(section);
        const warhead = new Warhead(rules as any);
        const behavior = rules.armorVersusBehavior.get(ArmorType.Heavy);

        expect(warhead.computeDamage(100, makeTarget(), { gameOpts: { destroyableBridges: true } } as any)).toBe(0);
        expect(behavior).toEqual({ forceFire: true, retaliate: false, passiveAcquire: true });
    });
});
