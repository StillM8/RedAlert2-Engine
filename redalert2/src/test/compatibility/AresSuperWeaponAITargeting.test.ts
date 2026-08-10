import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import {
    normalizeAresSuperWeaponAITargeting,
    resolveAresSuperWeaponAITargeting,
} from "@/extensions/ares/AresSuperWeaponAI";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";

describe("Ares superweapon AI targeting", () => {
    test("normalizes documented modes and explicit AI-required target overrides", () => {
        const ini = new IniFile(`
[Pulse]
Type=GenericWarhead
SW.AITargeting=Stealth
SW.AIRequiresTarget=Water
SW.AIRequiresHouse=Enemies
SW.AITargeting.Preference=Defensive
SW.AITargeting.Constraints=Attacked,LowPower
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("Pulse")!);
        const profile = resolveAresSuperWeaponAITargeting(definition!);

        expect(profile.mode).toBe("stealth");
        expect(profile.requiredTarget).toBe("Water");
        expect(profile.requiredHouse).toBe("Enemies");
        expect(profile.preference).toBe("defensive");
        expect(profile.constraints).toEqual(["attacked", "low-power"]);
        expect(profile.supported).toBe(true);
        expect(normalizeAresSuperWeaponAITargeting("PsychicDominator")).toBe("psychic-dominator");
    });

    test("matches Antares defaults for generic, SonarPulse, and no-AI handlers", () => {
        expect(resolveAresSuperWeaponAITargeting({
            typeId: "GenericWarhead",
            extensionType: "GenericWarhead",
        })).toMatchObject({
            mode: "offensive",
            requiredTarget: "infantry,units,buildings",
            requiredHouse: "enemies",
            supported: true,
        });

        expect(resolveAresSuperWeaponAITargeting({
            typeId: "SonarPulse",
            extensionType: "SonarPulse",
        })).toMatchObject({
            mode: "stealth",
            requiredTarget: "water",
            requiredHouse: "enemies",
            supported: true,
        });

        expect(resolveAresSuperWeaponAITargeting({
            typeId: "EMPulse",
            extensionType: "EMPulse",
        }).supported).toBe(false);
    });

    test("does not silently enable an unknown Ares AI mode", () => {
        const profile = resolveAresSuperWeaponAITargeting({
            typeId: "GenericWarhead",
            extensionType: "GenericWarhead",
            swAITargeting: "FutureMode",
        });
        expect(profile.mode).toBe("unknown");
        expect(profile.supported).toBe(false);
    });

    test("scanner tracks SW.AITargeting and SW.AIRequiresTarget separately", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: "[MOBlast]\nType=GenericWarhead\nSW.AITargeting=Offensive\nSW.AIRequiresTarget=Buildings\n",
        }]);
        const usage = report.featureUsage.filter((item) => item.featureId === "ares.superweapon-ai-targeting");

        expect(usage.reduce((sum, item) => sum + item.occurrences, 0)).toBe(2);
        expect(usage.every((item) => item.support?.parserImplemented && item.support?.runtimeImplemented)).toBe(true);
    });

    test("keeps Antares AI-required house separate from SW.AffectsHouse", () => {
        const profile = resolveAresSuperWeaponAITargeting({
            typeId: "GenericWarhead",
            extensionType: "GenericWarhead",
            swAffectsHouse: "all",
            swAIRequiresHouse: "allies",
        });
        expect(profile.requiredHouse).toBe("allies");
    });
});
