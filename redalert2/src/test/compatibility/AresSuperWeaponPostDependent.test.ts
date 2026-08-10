import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import {
    parseAresSuperWeaponDefinition,
    resolveAresPostDependentSuperWeapon,
} from "@/extensions/ares/AresSuperWeapons";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { SuperWeaponType } from "@/game/type/SuperWeaponType";
import { SpecialActionMode } from "@/gui/screen/game/worldInteraction/SpecialActionMode";

describe("Ares SW.PostDependent", () => {
    test("parses an authored dependent ID without coercing custom types", () => {
        const ini = new IniFile(`
[ChronoSphereSpecial]
Type=ChronoSphere
SW.PostDependent=ChronoWarpSpecial
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("ChronoSphereSpecial")!);

        expect(definition?.swPostDependent).toBe("ChronoWarpSpecial");
        expect(definition?.extensionEntries.get("SW.PostDependent")).toBe("ChronoWarpSpecial");
    });

    test("resolves an explicit dependent by name or type ID case-insensitively", () => {
        const dependent = {
            index: 7,
            name: "ChronoWarpSpecial",
            typeId: "ChronoWarp",
            ares: { extensionType: "ChronoWarp", typeId: "ChronoWarp" },
        };
        const source = {
            type: SuperWeaponType.ChronoSphere,
            ares: { swPostDependent: "chronowarpspecial" },
        };

        expect(resolveAresPostDependentSuperWeapon([dependent], source)).toBe(dependent);
    });

    test("falls back to the first authored ChronoWarp for ChronoSphere", () => {
        const firstWarp = {
            index: 3,
            name: "WarpOne",
            typeId: "ChronoWarp",
            ares: { extensionType: "ChronoWarp" },
        };
        const secondWarp = {
            index: 4,
            name: "WarpTwo",
            typeId: "ChronoWarp",
            ares: { extensionType: "ChronoWarp" },
        };
        const source = { type: SuperWeaponType.ChronoSphere, ares: {} };

        expect(resolveAresPostDependentSuperWeapon([firstWarp, secondWarp], source)).toBe(firstWarp);
        expect(resolveAresPostDependentSuperWeapon([firstWarp], {
            type: SuperWeaponType.ChronoSphere,
            ares: { swPostDependent: "MissingWarp" },
        })).toBe(firstWarp);
    });

    test("does not invent a dependent stage for unrelated superweapons", () => {
        expect(resolveAresPostDependentSuperWeapon([
            { typeId: "ChronoWarp", ares: { extensionType: "ChronoWarp" } },
        ], { type: SuperWeaponType.MultiMissile, ares: {} })).toBeUndefined();
    });

    test("uses Ares PostDependent for the two-click ChronoSphere UI flow", () => {
        const source = {
            index: 2,
            name: "ChronoSphereSpecial",
            type: SuperWeaponType.ChronoSphere,
            preClick: false,
            ares: { swPostDependent: "WarpSpecial" },
        };
        const dependent = {
            index: 3,
            name: "WarpSpecial",
            typeId: "ChronoWarp",
            ares: { extensionType: "ChronoWarp", typeId: "ChronoWarp" },
        };
        const pointerTypes: unknown[] = [];
        const animations: unknown[] = [];
        const pointer = { setPointerType: (type: unknown) => pointerTypes.push(type) };
        const fx = {
            createChronoSphereAnim: (tile: unknown) => animations.push(tile),
            disposeChronoSphereAnim: () => undefined,
        };
        const mode = SpecialActionMode.factory(new Map([
            [source.name, source],
            [dependent.name, dependent],
        ]), source, fx, pointer, { play: () => undefined });
        const executed: unknown[] = [];
        mode.onExecute.subscribe((data) => executed.push(data));
        const firstTile = { rx: 4, ry: 5 };
        const secondTile = { rx: 9, ry: 10 };

        expect(mode.execute({ tile: firstTile })).toBe(false);
        expect(animations).toEqual([firstTile]);
        expect(executed).toEqual([]);
        expect(mode.execute({ tile: secondTile })).toBeUndefined();
        expect(executed).toEqual([{ tile: firstTile, tile2: secondTile }]);
        expect(pointerTypes.length).toBe(0);
    });

    test("scanner tracks SW.PostDependent separately", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: "[ChronoSphereSpecial]\nType=ChronoSphere\nSW.PostDependent=ChronoWarpSpecial\n",
        }]);
        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-post-dependent");

        expect(usage?.occurrences).toBe(1);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
