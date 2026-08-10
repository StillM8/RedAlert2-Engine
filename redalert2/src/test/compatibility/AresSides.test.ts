import { describe, expect, test } from "bun:test";
import { resolveSideMixSelection } from "@/extensions/ares/AresSides";
import { SideType } from "@/game/SideType";

describe("Ares side presentation", () => {
    test("maps a data-defined side to its configured sidebar MIX family", () => {
        const selection = resolveSideMixSelection({
            id: "Foehn",
            index: 3,
            sidebarMixFileIndex: 4,
            sidebarYuriFileNames: false,
        }, SideType.Nod);

        expect(selection).toEqual({
            mixFileIndex: 4,
            baseMixFile: "sidec04.mix",
            expansionMixFile: "sidec04md.mix",
            compatibilityMixFile: "sidec04cd.mix",
            useYuriFileNames: false,
        });
    });

    test("keeps the retail Yuri fallback when no data-defined side is available", () => {
        const selection = resolveSideMixSelection(undefined, SideType.Nod, true);
        expect(selection.baseMixFile).toBe("sidec02.mix");
        expect(selection.useYuriFileNames).toBe(true);
    });
});
