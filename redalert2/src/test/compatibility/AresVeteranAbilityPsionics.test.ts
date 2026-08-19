import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { VeteranAbility } from "@/game/gameobject/unit/VeteranAbility";

describe("Ares PSIONICSIMMUNE veteran ability", () => {
    test("is a parseable VeteranAbilities token", () => {
        const section = new IniSection("TESTUNIT");
        section.set("VeteranAbilities", "PSIONICSIMMUNE");
        expect(section.getEnumArray("VeteranAbilities", VeteranAbility)).toContain(VeteranAbility.PSIONICSIMMUNE);
    });
});
