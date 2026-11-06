import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ObjectArt } from "@/game/art/ObjectArt";
import { ObjectRules } from "@/game/rules/ObjectRules";

function makeArt(values: Record<string, string>, theaterSections: Record<string, Record<string, string>>) {
    const rulesSection = new IniSection("JUNK");
    for (const [key, value] of Object.entries(values)) {
        rulesSection.set(key, value);
    }
    const rules = new ObjectRules(ObjectType.Infantry, rulesSection);
    const artIni = new IniFile();
    for (const [name, entries] of Object.entries(theaterSections)) {
        const section = artIni.getOrCreateSection(name);
        for (const [key, value] of Object.entries(entries)) {
            section.set(key, value);
        }
    }
    return ObjectArt.factory(ObjectType.Infantry, rules, artIni, artIni.getSection("JUNK")!);
}

describe("Ares AlternateTheaterArt", () => {
    test("defaults to no and resolves the active theater SHP section", () => {
        const previousSuffix = ObjectArt.alternateTheaterSuffix;
        ObjectArt.alternateTheaterSuffix = "D";
        try {
            const disabled = makeArt({ Image: "JUNK" }, {
                JUNK: { Image: "JUNK" },
                JUNKD: { Image: "JUNKD", Cameo: "JUNKDICON" },
            });
            const enabled = makeArt({ Image: "JUNK", AlternateTheaterArt: "yes" }, {
                JUNK: { Image: "JUNK" },
                JUNKD: { Image: "JUNKD", Cameo: "JUNKDICON" },
            });

            expect(disabled.imageName).toBe("JUNK");
            expect(disabled.cameo).toBe("xxicon");
            expect(enabled.imageName).toBe("JUNKD");
            expect(enabled.cameo).toBe("junkdicon");
        }
        finally {
            ObjectArt.alternateTheaterSuffix = previousSuffix;
        }
    });

    test("falls back to the base section and never coerces voxel art", () => {
        const previousSuffix = ObjectArt.alternateTheaterSuffix;
        ObjectArt.alternateTheaterSuffix = "A";
        try {
            const fallback = makeArt({ Image: "JUNK", AlternateTheaterArt: "yes" }, {
                JUNK: { Image: "JUNK" },
            });
            const voxelRules = new IniSection("TANK");
            voxelRules.set("Image", "TANK");
            voxelRules.set("AlternateTheaterArt", "yes");
            const voxelArt = new IniFile();
            voxelArt.getOrCreateSection("TANK").set("Voxel", "yes");
            voxelArt.getOrCreateSection("TANKA").set("Voxel", "yes");
            const voxel = ObjectArt.factory(
                ObjectType.Vehicle,
                new ObjectRules(ObjectType.Vehicle, voxelRules),
                voxelArt,
                voxelArt.getSection("TANK")!,
            );

            expect(fallback.imageName).toBe("JUNK");
            expect(fallback.cameo).toBe("xxicon");
            expect(voxel.imageName).toBe("TANK");
            expect(voxel.isVoxel).toBe(true);
        }
        finally {
            ObjectArt.alternateTheaterSuffix = previousSuffix;
        }
    });
});
