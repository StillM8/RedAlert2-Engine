import { describe, expect, test } from "bun:test";
import {
    getAresSuperWeaponPresentationGroup,
    isAresSuperWeaponAnimationVisible,
    isAresSuperWeaponCameoVisible,
    isAresSuperWeaponMessageFirerColored,
    isAresSuperWeaponTimerVisible,
    normalizeAresSuperWeaponPresentation,
    resolveAresSuperWeaponOverlayText,
    resolveAresSuperWeaponEva,
    resolveAresSuperWeaponMessage,
    resolveAresSuperWeaponMessageColor,
    resolveAresSuperWeaponViewerRelation,
} from "@/extensions/ares/AresSuperWeaponPresentation";

describe("Ares superweapon presentation adapter", () => {
    test("normalizes documented defaults without requiring authored names", () => {
        expect(normalizeAresSuperWeaponPresentation({})).toEqual({
            showCameo: true,
            autoFire: false,
            showTimer: false,
            timerVisibility: "all",
            animationVisibility: "all",
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

    test("applies AnimationVisibility using the same owner relation vocabulary", () => {
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
            expect(relations.map(relation => isAresSuperWeaponAnimationVisible(
                { animationVisibility: visibility },
                relation,
            ))).toEqual(results);
        }
    });

    test("resolves owner, allied, enemy, and observer timer viewers", () => {
        const owner = { name: "Owner", isObserver: false };
        const ally = { name: "Ally", isObserver: false };
        const enemy = { name: "Enemy", isObserver: false };
        const observer = { name: "Observer", isObserver: true };
        const alliances = { areAllied: (first: any, second: any) => first === ally && second === owner };

        expect(resolveAresSuperWeaponViewerRelation(owner, owner, alliances)).toBe("owner");
        expect(resolveAresSuperWeaponViewerRelation(ally, owner, alliances)).toBe("ally");
        expect(resolveAresSuperWeaponViewerRelation(enemy, owner, alliances)).toBe("enemy");
        expect(resolveAresSuperWeaponViewerRelation(observer, owner, alliances)).toBe("observer");
        expect(resolveAresSuperWeaponViewerRelation(undefined, owner, alliances)).toBe("observer");
    });

    test("normalizes authored groups and reads the existing raw extension shape", () => {
        expect(normalizeAresSuperWeaponPresentation({ group: "3.9", showTimer: true })).toMatchObject({ group: 3 });
        expect(getAresSuperWeaponPresentationGroup({
            extensionEntries: new Map([
                ["SW.ShowCameo", "no"],
                ["SW.AutoFire", "yes"],
                ["SW.TimerVisibility", "owner"],
                ["SW.AnimationVisibility", "owner"],
                ["SW.Group", "7"],
                ["ShowTimer", "yes"],
            ]),
        })).toBe(7);
        expect(normalizeAresSuperWeaponPresentation({
            extensionEntries: new Map([["SW.AnimationVisibility", "owner"]]),
        }).animationVisibility).toBe("owner");
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

    test("resolves lifecycle EVA and messages while preserving explicit none", () => {
        const rules = {
            evaReady: "EVA_CustomReady",
            messageReady: "TXT_CustomReady",
            extensionEntries: new Map([
                ["EVA.Detected", "EVA_CustomDetected"],
                ["EVA.Activated", "none"],
                ["Message.Launch", "TXT_CustomLaunch"],
                ["Message.Abort", "TXT_CustomAbort"],
                ["Message.FirerColor", "yes"],
            ]),
        };

        expect(resolveAresSuperWeaponEva(rules, "detected")).toBe("EVA_CustomDetected");
        expect(resolveAresSuperWeaponEva(rules, "ready")).toBe("EVA_CustomReady");
        expect(resolveAresSuperWeaponEva(rules, "activated")).toBeNull();
        expect(resolveAresSuperWeaponMessage(rules, "ready")).toBe("TXT_CustomReady");
        expect(resolveAresSuperWeaponMessage(rules, "launch")).toBe("TXT_CustomLaunch");
        expect(resolveAresSuperWeaponMessage(rules, "abort")).toBe("TXT_CustomAbort");
        expect(isAresSuperWeaponMessageFirerColored(rules)).toBe(true);
        expect(resolveAresSuperWeaponMessage(rules, "cannotFire")).toBe("MSG:CannotFire");
        expect(resolveAresSuperWeaponMessageColor({ messageColor: "Blue" }, undefined, "grey")).toBe("Blue");
        expect(resolveAresSuperWeaponMessageColor({ messageColor: "Blue", messageFirerColor: true }, "owner", "grey"))
            .toBe("owner");
    });

    test("resolves state-specific cameo overlay text and explicit suppression", () => {
        const rules = {
            textReady: "TXT_CUSTOM_READY",
            extensionEntries: new Map([
                ["Text.Charging", "TXT_CUSTOM_CHARGING"],
                ["Text.Active", "none"],
            ]),
        };
        expect(resolveAresSuperWeaponOverlayText(rules, "ready")).toBe("TXT_CUSTOM_READY");
        expect(resolveAresSuperWeaponOverlayText(rules, "charging")).toBe("TXT_CUSTOM_CHARGING");
        expect(resolveAresSuperWeaponOverlayText(rules, "active")).toBeNull();
    });
});
