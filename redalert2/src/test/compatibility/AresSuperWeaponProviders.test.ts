import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import {
    buildingProvidesAresSuperWeapon,
    getAresSuperWeaponProviderNames,
    normalizeAresSuperWeaponProviders,
} from "@/extensions/ares/AresSuperWeaponProviders";
import { evaluateAresSuperWeaponAvailabilityForOwner } from "@/extensions/ares/AresSuperWeaponAvailability";
import { TechnoRules } from "@/game/rules/TechnoRules";

describe("Ares multi-slot superweapon providers", () => {
    test("preserves slot order and removes empty, none, and duplicate entries", () => {
        expect(normalizeAresSuperWeaponProviders({
            superWeapon: "PrimarySW",
            superWeapon2: " primarysw ",
            superWeapons: ["none", "SecondSW, ThirdSW", "thirdsw", ""],
        })).toEqual([
            { name: "PrimarySW", slot: "SuperWeapon", index: 0 },
            { name: "SecondSW", slot: "SuperWeapons", index: 1 },
            { name: "ThirdSW", slot: "SuperWeapons", index: 2 },
        ]);
    });

    test("parses SuperWeapon2 and SuperWeapons without breaking the singular alias", () => {
        const section = new IniSection("MultiProvider");
        section.set("SuperWeapon", "PrimarySW");
        section.set("SuperWeapon2", "SecondSW");
        section.set("SuperWeapons", "ThirdSW,FourthSW");
        const rules = new TechnoRules(ObjectType.Building, section, 0, {}, new ArmorRegistry());

        expect(rules.superWeapon).toBe("PrimarySW");
        expect(rules.superWeapon2).toBe("SecondSW");
        expect(rules.superWeapons).toEqual(["ThirdSW", "FourthSW"]);
        expect(getAresSuperWeaponProviderNames(rules)).toEqual([
            "PrimarySW", "SecondSW", "ThirdSW", "FourthSW",
        ]);
    });

    test("availability sees any provider slot and retains logical-SW ownership semantics", () => {
        const owner: any = {
            country: { id: "CountryA" },
            isAi: false,
            defeated: false,
            buildings: [
                { name: "Provider", rules: { name: "Provider", superWeapon2: "MOBlast" } },
            ],
            getOwnedObjectsByType: () => owner.buildings,
        };

        expect(buildingProvidesAresSuperWeapon(owner.buildings[0], "MOBlast")).toBe(true);
        expect(evaluateAresSuperWeaponAvailabilityForOwner({}, owner, "MOBlast")).toMatchObject({
            available: true,
            providerBuildingPresent: true,
        });
    });
});
