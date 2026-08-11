import { describe, expect, test } from "bun:test";
import { SoundHandler } from "@/gui/screen/game/SoundHandler";
import { SoundKey } from "@/engine/sound/SoundKey";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { TechnoRules } from "@/game/rules/TechnoRules";

function buildingRules(slamSound?: string): TechnoRules {
    const section = new IniSection("FATRAP");
    if (slamSound) {
        section.set("SlamSound", slamSound);
    }
    return new TechnoRules(ObjectType.Building, section, 0, {}, new ArmorRegistry());
}

function placementSound(slamSound?: string): string | number {
    const calls: any[][] = [];
    const handler = new SoundHandler(
        {},
        { playEffect: (...args: any[]) => calls.push(args) },
        {},
        {},
        {},
        {},
        {},
        {},
    );
    (handler as any).handleBuildingPlaceSound({
        target: {
            rules: buildingRules(slamSound),
            owner: {},
            position: { worldPosition: { x: 0, y: 0, z: 0 } },
        },
    });
    return calls[0][0];
}

describe("building placement sound", () => {
    test("uses a TechnoType SlamSound override", () => {
        expect(placementSound("PlaceBuildingFoehn")).toBe("PlaceBuildingFoehn");
    });

    test("falls back to the global building slam sound", () => {
        expect(placementSound()).toBe(SoundKey.BuildingSlam);
    });
});
