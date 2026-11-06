import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { Palette } from "@/data/Palette";
import { ObjectType } from "@/engine/type/ObjectType";
import { PalDrawable } from "@/engine/gfx/drawable/PalDrawable";
import {
    ARES_DEFAULT_CAMEO_PALETTE,
    normalizeAresCameoPalette,
} from "@/extensions/ares/AresPcxCameos";
import { ObjectArt } from "@/game/art/ObjectArt";
import { ObjectRules } from "@/game/rules/ObjectRules";
import { SuperWeaponRules } from "@/game/rules/SuperWeaponRules";
import { SidebarCard } from "@/gui/screen/game/component/hud/SidebarCard";

describe("Ares custom cameo palettes", () => {
    test("defaults unit and superweapon palettes to cameo.pal", () => {
        expect(normalizeAresCameoPalette(undefined)).toBe(ARES_DEFAULT_CAMEO_PALETTE);
        expect(normalizeAresCameoPalette("invalid")).toBe(ARES_DEFAULT_CAMEO_PALETTE);

        const art = new IniSection("UNIT");
        art.set("CameoPalette", " UnitPal.PAL ");
        const rules = new ObjectRules(ObjectType.Infantry, new IniSection("E1"));
        const objectArt = new ObjectArt(ObjectType.Infantry, rules, art);
        const defaultArt = new ObjectArt(ObjectType.Infantry, rules, new IniSection("E1"));

        const defaultSuperweapon = new SuperWeaponRules(0).readIni(new IniSection("Nuke"));
        const customSection = new IniSection("Custom");
        customSection.set("SidebarPalette", "shell.pal");
        const customSuperweapon = new SuperWeaponRules(1).readIni(customSection);

        expect(objectArt.cameoPalette).toBe("UnitPal.PAL");
        expect(defaultArt.cameoPalette).toBe("cameo.pal");
        expect(defaultSuperweapon.sidebarPalette).toBe("cameo.pal");
        expect(customSuperweapon.sidebarPalette).toBe("shell.pal");
    });

    test("selects a palette for each SHP sidebar item or shell", () => {
        const defaultPalette = { id: "default" };
        const unitPalette = { id: "unit" };
        const shellPalette = { id: "shell" };
        const palettes = new Map<string, any>([
            ["cameo.pal", defaultPalette],
            ["unit.pal", unitPalette],
            ["shell.pal", shellPalette],
        ]);
        const card = Object.create(SidebarCard.prototype) as SidebarCard;
        (card as any).props = {
            cameoNameToIdMap: new Map([["icon.shp", 0]]),
            cameoPalettes: { get: (name: string) => palettes.get(name) },
            cameoPalette: defaultPalette,
        };
        const selected: any[] = [];
        const slot = {
            setFrame: () => undefined,
            setPalette: (palette: any) => selected.push(palette),
            setVisible: () => undefined,
            setLightMult: () => undefined,
        };

        card.updateCameo({ cameo: "icon", cameoPalette: "unit.pal", disabled: false }, slot);
        card.updateCameo({ cameo: "icon", cameoPalette: "shell.pal", disabled: false }, slot);
        card.updateCameo({ cameo: "icon", disabled: false }, slot);

        expect(selected).toEqual([unitPalette, shellPalette, defaultPalette]);
    });

    test("keeps palette index zero transparent", () => {
        const bitmap = new PalDrawable(new Palette(new Uint8Array(768).fill(64))).draw();
        expect(bitmap.data[3]).toBe(0);
        expect(bitmap.data[7]).toBe(255);
    });
});
