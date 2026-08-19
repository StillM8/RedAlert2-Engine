import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { parseAresTechnoExtensions, resolveAresParachuteAnim } from "@/extensions/ares/AresTechnoExtensions";

describe("Ares customizable parachutes", () => {
    test("normalizes a per-Techno parachute and preserves the fallback", () => {
        const section = new IniSection("PARATROOPER");
        section.set("Parachute.Anim", "FOEPARACH");
        const rules = parseAresTechnoExtensions(section);

        expect(rules.parachuteAnim).toBe("FOEPARACH");
        expect(resolveAresParachuteAnim(rules, "PARACH")).toBe("FOEPARACH");
        expect(resolveAresParachuteAnim(undefined, "PARACH")).toBe("PARACH");
    });
});
