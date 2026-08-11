import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { PaletteType } from "@/engine/type/PaletteType";
import { ObjectArt } from "@/game/art/ObjectArt";
import { ObjectRules } from "@/game/rules/ObjectRules";
import { getAresCustomPaletteCandidates } from "@/extensions/ares/AresCustomPalettes";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { createDefaultAresFeatureRegistry } from "@/extensions/ares/AresFeatureRegistry";
import { Theater } from "@/engine/Theater";
import { LazyResourceCollection } from "@/engine/LazyResourceCollection";
import type { Palette } from "@/data/Palette";

function makeArt(type: ObjectType, values: Record<string, string>): ObjectArt {
    const section = new IniSection("TESTART");
    for (const [key, value] of Object.entries(values)) section.set(key, value);
    const rulesSection = new IniSection("TESTRULES");
    const rules = new ObjectRules(type, rulesSection);
    return new ObjectArt(type, rules, section);
}

describe("Ares custom animation/projectile palettes", () => {
    test("reads an explicit CustomPalette filename for animation art", () => {
        const art = makeArt(ObjectType.Animation, { CustomPalette: "unittem.pal" });

        expect(art.paletteType).toBe(PaletteType.Custom);
        expect(art.customPaletteName).toBe("unittem.pal");
    });

    test("reads CustomPalette from projectile art without changing FirersPalette behavior", () => {
        const art = makeArt(ObjectType.Projectile, { CustomPalette: "laser~~~.pal" });

        expect(art.paletteType).toBe(PaletteType.Custom);
        expect(art.customPaletteName).toBe("laser~~~.pal");
    });

    test("expands only the first three-tildes theater marker and preserves direct filenames", () => {
        expect(getAresCustomPaletteCandidates("laser~~~.pal", ".tem")).toEqual(["lasertem.pal"]);
        expect(getAresCustomPaletteCandidates("unittem.pal", ".tem")).toEqual(["unittem.pal"]);
        expect(getAresCustomPaletteCandidates("obliw", ".sno")).toEqual(["obliwsno.pal", "obliw.pal"]);
        expect(getAresCustomPaletteCandidates("LIB", ".urb")).toEqual(["lib"]);
    });

    test("Theater resolves direct and theater-substituted palettes without double suffixing", () => {
        const palettes = new LazyResourceCollection<Palette>(() => undefined as never);
        const direct = {} as Palette;
        const substituted = {} as Palette;
        palettes.set("unittem.pal", direct);
        palettes.set("lasertem.pal", substituted);

        const theater = Object.create(Theater.prototype) as Theater;
        (theater as any).settings = { extension: ".tem" };
        (theater as any).palettes = palettes;

        expect(theater.getPalette(PaletteType.Custom, "unittem.pal")).toBe(direct);
        expect(theater.getPalette(PaletteType.Custom, "laser~~~.pal")).toBe(substituted);
    });

    test("classifies CustomPalette as a verified runtime capability", () => {
        const report = scanMentalOmegaIniSources([
            {
                name: "artmo.ini",
                contents: "[MOAnimation]\nCustomPalette=laser~~~.pal\n",
            },
        ], createDefaultAresFeatureRegistry());
        const usage = report.featureUsage.find((item) => item.featureId === "ares.custom-animation-palettes");

        expect(usage?.occurrences).toBe(1);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
