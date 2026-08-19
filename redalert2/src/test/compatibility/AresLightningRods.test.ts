import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import {
    resolveAresLightningRodCloudTile,
    resolveAresLightningRodDamage,
} from "@/extensions/ares/AresLightningRods";
import { TechnoRules } from "@/game/rules/TechnoRules";

function techno(id: number, rx: number, ry: number, rod = false): any {
    return {
        id, tile: { rx, ry, z: 0 }, isSpawned: true, isDestroyed: false, isDisposed: false, isCrashing: false,
        rules: { lightningRod: rod, lightningRodModifier: rod ? 3 : 1 },
        isTechno: () => true,
        isBuilding: () => rod,
    };
}

describe("Ares Lightning Rods", () => {
    test("parses BuildingType rod settings with documented defaults", () => {
        const section = new IniSection("GARODS");
        section.set("LightningRod", "yes");
        section.set("LightningRod.Modifier", "3");
        const rules = new TechnoRules(ObjectType.Building, section, 0, {}, new ArmorRegistry());
        expect(rules.lightningRod).toBe(true);
        expect(rules.lightningRodModifier).toBe(3);

        const defaultRules = new TechnoRules(ObjectType.Building, new IniSection("NORMAL"), 0, {}, new ArmorRegistry());
        expect(defaultRules.lightningRod).toBe(false);
        expect(defaultRules.lightningRodModifier).toBe(1);
    });

    test("redirects a random cloud only when the nearest live Techno is a rod", () => {
        const random = { rx: 10, ry: 10, z: 0 };
        const rod = techno(2, 12, 10, true);
        const ordinary = techno(1, 20, 20, false);
        expect(resolveAresLightningRodCloudTile(random, [ordinary, rod])).toEqual(rod.tile);

        const nearerOrdinary = techno(3, 11, 10, false);
        expect(resolveAresLightningRodCloudTile(random, [rod, nearerOrdinary])).toBe(random);
        expect(resolveAresLightningRodCloudTile(random, [rod], true)).toBe(random);
    });

    test("uses deterministic target tie-breaking independent of input order", () => {
        const random = { rx: 10, ry: 10, z: 0 };
        const rod = techno(1, 9, 10, true);
        const ordinary = techno(2, 11, 10, false);
        expect(resolveAresLightningRodCloudTile(random, [ordinary, rod])).toEqual(rod.tile);
        expect(resolveAresLightningRodCloudTile(random, [rod, ordinary])).toEqual(rod.tile);
    });

    test("scales weather damage only for the rod itself and honors IgnoreLightningRod", () => {
        const rod = techno(1, 0, 0, true);
        expect(resolveAresLightningRodDamage(100, rod, true)).toBe(300);
        expect(resolveAresLightningRodDamage(100, rod, false)).toBe(100);
        expect(resolveAresLightningRodDamage(100, rod, true, true)).toBe(100);
        expect(resolveAresLightningRodDamage(100, techno(2, 0, 0, false), true)).toBe(100);
    });

    test("parses Lightning.IgnoreLightningRod as Ares superweapon data", () => {
        const section = new IniSection("StormSpecial");
        section.set("Type", "LightningStorm");
        section.set("Lightning.IgnoreLightningRod", "yes");
        const definition = parseAresSuperWeaponDefinition(section)!;
        expect(definition.lightningIgnoreLightningRod).toBe(true);
        expect(definition.extensionEntries.has("Lightning.IgnoreLightningRod")).toBe(true);
    });
});
