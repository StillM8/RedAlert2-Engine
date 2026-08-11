import { describe, expect, test } from "bun:test";
import {
    getAresSuperWeaponPresentationGroup,
    isAresSuperWeaponCameoVisible,
    isAresSuperWeaponTimerVisible,
    normalizeAresSuperWeaponPresentation,
} from "@/extensions/ares/AresSuperWeaponPresentation";

describe("Ares superweapon presentation adapter", () => {
    test("normalizes documented defaults without requiring authored names", () => {
        expect(normalizeAresSuperWeaponPresentation({})).toEqual({
            showCameo: true,
            autoFire: false,
            showTimer: false,
            timerVisibility: "all",
            group: 0,
        });
        expect(isAresSuperWeaponCameoVisible({})).toBe(true);
        expect(isAresSuperWeaponTimerVisible({ showTimer: true }, "enemy")).toBe(true);
        expect(getAresSuperWeaponPresentationGroup({})).toBe(0);
    });

    test("applies ShowCameo only to auto-fired superweapons", () => {
        expect(isAresSuperWeaponCameoVisible({ showCameo: false })).toBe(true);
        expect(isAresSuperWeaponCameoVisible({ autoFire: true, showCameo: false })).toBe(false);
        expect(isAresSuperWeaponCameoVisible({ autoFire: true, showCameo: true })).toBe(true);
    });

    test("normalizes TimerVisibility and applies ShowTimer plus house relations", () => {
        const rules = { showTimer: true, timerVisibility: "Allies" };
        expect(isAresSuperWeaponTimerVisible(rules, "owner")).toBe(true);
        expect(isAresSuperWeaponTimerVisible(rules, "ally")).toBe(true);
        expect(isAresSuperWeaponTimerVisible(rules, "observer")).toBe(true);
        expect(isAresSuperWeaponTimerVisible(rules, "enemy")).toBe(false);
        expect(isAresSuperWeaponTimerVisible({ ...rules, showTimer: false }, "owner")).toBe(false);
        expect(isAresSuperWeaponTimerVisible({ showTimer: true, timerVisibility: "invalid" }, "enemy")).toBe(true);
    });

    test("supports each explicit timer visibility scope", () => {
        const relations = ["owner", "ally", "observer", "enemy"] as const;
        const expected: Record<string, boolean[]> = {
            none: [false, false, false, false],
            owner: [true, false, false, false],
            allies: [true, true, true, false],
            team: [true, true, true, false],
            enemies: [false, false, false, true],
            all: [true, true, true, true],
        };
        for (const [visibility, results] of Object.entries(expected)) {
            expect(relations.map(relation => isAresSuperWeaponTimerVisible(
                { showTimer: true, timerVisibility: visibility },
                relation,
            ))).toEqual(results);
        }
    });

    test("normalizes authored groups and reads the existing raw extension shape", () => {
        expect(normalizeAresSuperWeaponPresentation({ group: "3.9", showTimer: true })).toMatchObject({ group: 3 });
        expect(getAresSuperWeaponPresentationGroup({
            extensionEntries: new Map([
                ["SW.ShowCameo", "no"],
                ["SW.AutoFire", "yes"],
                ["SW.TimerVisibility", "owner"],
                ["SW.Group", "7"],
                ["ShowTimer", "yes"],
            ]),
        })).toBe(7);
        expect(isAresSuperWeaponCameoVisible({
            extensionEntries: new Map([
                ["SW.ShowCameo", "no"],
                ["SW.AutoFire", "yes"],
            ]),
        })).toBe(false);
        expect(isAresSuperWeaponTimerVisible({
            extensionEntries: new Map([
                ["ShowTimer", "yes"],
                ["SW.TimerVisibility", "owner"],
            ]),
        }, "owner")).toBe(true);
    });
});
