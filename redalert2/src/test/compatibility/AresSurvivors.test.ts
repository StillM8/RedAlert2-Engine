import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { LocomotorType } from "@/game/type/LocomotorType";
import {
    getAresSideSurvivorOverride,
    getAresSurvivorPassengerChance,
    getAresSurvivorPilotChance,
    getAresSurvivorPilotCount,
    rollAresSurvivorPercent,
    shouldAresPassengerSurvive,
} from "@/extensions/ares/AresSurvivors";

function rules(entries: Record<string, string>, crewed = false): any {
    const ini = new IniSection("TEST");
    for (const [key, value] of Object.entries(entries)) ini.set(key, value);
    return { ini, crewed };
}

describe("Ares survivors", () => {
    test("uses Survivor.PilotCount and the Crewed fallback", () => {
        expect(getAresSurvivorPilotCount({ rules: rules({}, false) })).toBe(0);
        expect(getAresSurvivorPilotCount({ rules: rules({}, true) })).toBe(1);
        expect(getAresSurvivorPilotCount({ rules: rules({ "Survivor.PilotCount": "3" }, false) })).toBe(3);
    });

    test("selects pilot and passenger chances from transport veterancy", () => {
        const object: any = {
            veteranLevel: VeteranLevel.Veteran,
            rules: rules({
                "Survivor.RookiePilotChance": "10",
                "Survivor.VeteranPilotChance": "70",
                "Survivor.ElitePilotChance": "90",
                "Survivor.RookiePassengerChance": "20",
                "Survivor.VeteranPassengerChance": "65",
                "Survivor.ElitePassengerChance": "95",
            }),
        };
        expect(getAresSurvivorPilotChance(object, 50)).toBe(70);
        expect(getAresSurvivorPassengerChance(object)).toBe(65);
    });

    test("normalizes literal percentages without changing bare integer semantics", () => {
        const object: any = {
            veteranLevel: VeteranLevel.Veteran,
            rules: rules({
                "Survivor.VeteranPilotChance": "50%",
                "Survivor.VeteranPassengerChance": "1",
            }),
        };
        expect(getAresSurvivorPilotChance(object, 0.25)).toBe(50);
        expect(getAresSurvivorPassengerChance(object)).toBe(1);
    });

    test("CrewEscape parsed as a fixed fraction is converted back to Ares percent units", () => {
        const object: any = {
            veteranLevel: VeteranLevel.None,
            rules: rules({}),
        };
        expect(getAresSurvivorPilotChance(object, 0.5)).toBe(50);
        expect(getAresSurvivorPilotChance(object, 50)).toBe(50);
    });

    test("pilot chance falls back to CrewEscape while passenger -1 preserves retail ground/air behavior", () => {
        const ground: any = { zone: ZoneType.Ground, veteranLevel: VeteranLevel.None, rules: rules({}) };
        const air: any = { zone: ZoneType.Air, veteranLevel: VeteranLevel.None, rules: rules({}) };
        const context = { generateRandomInt: () => 99 };
        expect(getAresSurvivorPilotChance(ground, 0.5)).toBe(50);
        expect(getAresSurvivorPassengerChance(ground)).toBe(-1);
        expect(shouldAresPassengerSurvive(ground, context)).toBe(true);
        expect(shouldAresPassengerSurvive(air, context)).toBe(false);
    });

    test("original -1 still kills jumpjet cargo after the crashing transport has touched down", () => {
        const jumpjet: any = {
            zone: ZoneType.Ground,
            isAircraft: () => false,
            veteranLevel: VeteranLevel.None,
            rules: { ...rules({}), locomotor: LocomotorType.Jumpjet },
        };
        expect(shouldAresPassengerSurvive(jumpjet, { generateRandomInt: () => 0 })).toBe(false);
    });

    test("explicit passenger chance allows airborne survivors and is rolled per passenger", () => {
        const context = { generateRandomInt: () => 24 };
        const air: any = {
            zone: ZoneType.Air,
            veteranLevel: VeteranLevel.Elite,
            rules: rules({ "Survivor.ElitePassengerChance": "25" }),
        };
        expect(shouldAresPassengerSurvive(air, context)).toBe(true);
        expect(rollAresSurvivorPercent({ generateRandomInt: () => 25 }, 25)).toBe(false);
    });

    test("Survivor.Side# uses the owning side index/order", () => {
        const object: any = {
            owner: { country: { side: 1, sideDefinition: { order: 3 } } },
            rules: rules({ "Survivor.Side3": "CUSTOMCREW" }),
        };
        expect(getAresSideSurvivorOverride(object)).toBe("CUSTOMCREW");
    });
});
