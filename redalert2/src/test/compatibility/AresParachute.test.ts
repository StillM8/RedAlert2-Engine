import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { parseAresTechnoExtensions, resolveAresParachuteAnim } from "@/extensions/ares/AresTechnoExtensions";
import { GeneralRules } from "@/game/rules/GeneralRules";
import { ParadropTask } from "@/game/gameobject/task/ParadropTask";

describe("Ares customizable parachutes", () => {
    test("normalizes a per-Techno parachute and preserves the fallback", () => {
        const section = new IniSection("PARATROOPER");
        section.set("Parachute.Anim", "FOEPARACH");
        const rules = parseAresTechnoExtensions(section);

        expect(rules.parachuteAnim).toBe("FOEPARACH");
        expect(resolveAresParachuteAnim(rules, "PARACH")).toBe("FOEPARACH");
        expect(resolveAresParachuteAnim(undefined, "PARACH")).toBe("PARACH");
    });

    test("parses both fall rates and switches after the parachute animation completes", () => {
        const section = new IniSection("General");
        section.set("PrerequisitePower", "");
        section.set("PrerequisiteFactory", "");
        section.set("PrerequisiteBarracks", "");
        section.set("PrerequisiteRadar", "");
        section.set("PrerequisiteTech", "");
        section.set("PrerequisiteProc", "");
        section.set("ParachuteMaxFallRate", "-2");
        section.set("NoParachuteMaxFallRate", "-20");
        const general = new GeneralRules();
        general.readIni(section);

        expect(general.parachuteMaxFallRate).toBe(-2);
        expect(general.noParachuteMaxFallRate).toBe(-20);

        const game = {
            rules: { general },
            map: {
                tileOccupation: { getBridgeOnTile: () => undefined },
                terrain: { getPassableSpeed: () => 1 },
                getTileZone: () => 0,
            },
        };
        const fall = (finished: boolean) => {
            let distance = 0;
            const object = {
                parachuteAnimationFinished: finished,
                tile: { onBridgeLandType: false },
                tileElevation: 100,
                position: {
                    tileElevation: 100,
                    moveByLeptons3: (movement: { y: number }) => { distance += -movement.y; },
                },
                moveTrait: { handleElevationChange: () => undefined },
                rules: { speedType: 0 },
                isInfantry: () => true,
                onBridge: false,
                stance: 4,
            };
            new ParadropTask(game).onTick(object);
            return distance;
        };

        expect(fall(false)).toBe(2);
        expect(fall(true)).toBe(20);
    });
});
