import { describe, expect, test } from "bun:test";
import { ImageFinder } from "@/engine/ImageFinder";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ObjectArt } from "@/game/art/ObjectArt";
import { ObjectRules } from "@/game/rules/ObjectRules";

function createFinder(files: string[], newTheaterChar = "U"): ImageFinder {
    const images = new Map(files.map((filename) => [filename, { filename }]));
    return new ImageFinder(images, {
        settings: {
            extension: ".urb",
            newTheaterChar,
        },
    });
}

describe("ImageFinder Ares theater art", () => {
    test("applies NewTheater to image prefixes outside the retail set", () => {
        const finder = createFinder(["fucybr.shp"]);

        expect(finder.getFilename("FACYBR", false, true)).toBe("fucybr.shp");
        expect(finder.find("FACYBR", false, true)).toEqual({ filename: "fucybr.shp" });
    });

    test("falls back to the generic G variant when the theater art is absent", () => {
        const finder = createFinder(["fgcybr.shp"]);

        expect(finder.getFilename("FACYBR", false, true)).toBe("fgcybr.shp");
        expect(finder.find("FACYBR", false, true)).toEqual({ filename: "fgcybr.shp" });
    });

    test("does not rewrite an image ID that is already the generic G variant", () => {
        const finder = createFinder(["fgcnst.shp"]);

        expect(finder.getFilename("FGCNST", false, true)).toBe("fgcnst.shp");
    });

    test("keeps the retail heuristic for unmarked legacy art", () => {
        const finder = createFinder(["gucnst.shp"]);

        expect(finder.getFilename("GACNST", false)).toBe("gucnst.shp");
    });

    test("exposes NewTheater from the art section independently of Theater", () => {
        const artSection = new IniSection("FACNST");
        artSection.set("Image", "FGCNST");
        artSection.set("NewTheater", "yes");
        const rules = new ObjectRules(ObjectType.Building, new IniSection("FACNST"));
        const art = new ObjectArt(ObjectType.Building, rules, artSection);

        expect(art.useNewTheaterArt).toBe(true);
        expect(art.useTheaterExtension).toBe(false);
    });
});
