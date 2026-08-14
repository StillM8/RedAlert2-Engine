import { describe, expect, test } from "bun:test";
import { Rules } from "@/game/rules/Rules";

function buildWeaponNames(dropPodWeapon: string, superWeaponWeapon?: string): string[] {
    const rules = Object.create(Rules.prototype) as any;
    rules.ini = { getSection: () => undefined };
    rules.general = { dropPodWeapon };
    rules.superWeaponRules = new Map();
    if (superWeaponWeapon !== undefined) {
        rules.superWeaponRules.set("Test", { weaponType: superWeaponWeapon });
    }
    rules.weaponTypes = new Map();
    rules.buildingRules = new Map();
    rules.aircraftRules = new Map();
    rules.vehicleRules = new Map();
    rules.infantryRules = new Map();

    rules.buildWeaponsList();
    return [...rules.weaponTypes.values()];
}

describe("shared weapon reference loading", () => {
    test("does not register optional no-weapon sentinels", () => {
        const names = buildWeaponNames("NotAWeapon", "none");

        expect(names).not.toContain("NotAWeapon");
        expect(names).not.toContain("none");
    });

    test("keeps real optional weapon references available to map validation", () => {
        const names = buildWeaponNames("DropPodImpact", "CustomSuperWeaponWeapon");

        expect(names).toContain("DropPodImpact");
        expect(names).toContain("CustomSuperWeaponWeapon");
    });
});
