import { describe, expect, test } from "bun:test";
import {
    createAresPcxCameoAssetManifest,
    isAresPcxCameoSize,
    normalizeAresPcxCameos,
    resolveAresSidebarCameo,
    resolveAresTechnoCameo,
    type AresPcxCameoFields,
} from "@/extensions/ares/AresPcxCameos";

describe("Ares PCX cameo normalization and resolution", () => {
    test("preserves authored asset case and safely omits malformed PCX names", () => {
        const fields: AresPcxCameoFields = {
            cameoPcx: "  UnitIcon.PCX  ",
            altCameoPcx: "EliteIcon", // Ares requires the .pcx extension.
            sidebarPcx: "  SpecialIcon.PcX ",
            cameo: "UnitShp",
            altCameo: "EliteShp",
            sidebarImage: "LegacySidebar",
        };
        const before = structuredClone(fields);

        expect(normalizeAresPcxCameos(fields)).toEqual({
            cameoPcx: "UnitIcon.PCX",
            altCameoPcx: undefined,
            sidebarPcx: "SpecialIcon.PcX",
            cameo: "UnitShp",
            altCameo: "EliteShp",
            sidebarImage: "LegacySidebar",
        });
        expect(fields).toEqual(before);
    });

    test("uses PCX before legacy cameo and follows promoted fallback precedence", () => {
        const definition = normalizeAresPcxCameos({
            cameoPcx: "Base.PCX",
            altCameoPcx: "Elite.PCX",
            cameo: "base.shp",
            altCameo: "elite.shp",
        });

        expect(resolveAresTechnoCameo(definition, false)).toEqual({
            source: "pcx",
            field: "CameoPCX",
            assetName: "Base.PCX",
        });
        expect(resolveAresTechnoCameo(definition, true)).toEqual({
            source: "pcx",
            field: "AltCameoPCX",
            assetName: "Elite.PCX",
        });

        const noAltPcx = normalizeAresPcxCameos({
            cameoPcx: "Base.PCX",
            cameo: "base.shp",
            altCameo: "elite.shp",
        });
        expect(resolveAresTechnoCameo(noAltPcx, true)).toEqual({
            source: "pcx",
            field: "CameoPCX",
            assetName: "Base.PCX",
        });

        const legacyOnly = normalizeAresPcxCameos({ cameo: "base.shp", altCameo: "elite.shp" });
        expect(resolveAresTechnoCameo(legacyOnly, true)).toEqual({
            source: "legacy",
            field: "AltCameo",
            assetName: "elite.shp",
        });
    });

    test("prefers SidebarPCX and falls back to the legacy sidebar image", () => {
        const definition = normalizeAresPcxCameos({
            sidebarPcx: "  StrategicIcon.PcX ",
            sidebarImage: "LegacyIcon",
        });
        expect(resolveAresSidebarCameo(definition)).toEqual({
            source: "pcx",
            field: "SidebarPCX",
            assetName: "StrategicIcon.PcX",
        });

        const fallback = normalizeAresPcxCameos({
            sidebarPcx: "not-an-image",
            sidebarImage: "LegacyIcon",
        });
        expect(resolveAresSidebarCameo(fallback)).toEqual({
            source: "legacy",
            field: "SidebarImage",
            assetName: "LegacyIcon",
        });
        expect(resolveAresSidebarCameo(normalizeAresPcxCameos({}))).toEqual({ source: "none" });
    });

    test("collects available PCXs separately while retaining legacy SHP names", () => {
        const manifest = createAresPcxCameoAssetManifest(
            ["unit.shp", "elite.shp"],
            [
                normalizeAresPcxCameos({
                    cameoPcx: "UnitIcon.PCX",
                    altCameoPcx: "EliteIcon.PCX",
                    sidebarPcx: "SidebarIcon.PCX",
                }),
                normalizeAresPcxCameos({ cameoPcx: "uniticon.pcx" }),
            ],
            (filename) => filename !== "SidebarIcon.PCX",
        );

        expect(manifest).toEqual({
            shpFilenames: ["unit.shp", "elite.shp"],
            pcxFilenames: ["UnitIcon.PCX", "EliteIcon.PCX"],
        });
    });

    test("accepts only the documented 60x48 cameo surface", () => {
        expect(isAresPcxCameoSize(60, 48)).toBe(true);
        expect(isAresPcxCameoSize(48, 60)).toBe(false);
        expect(isAresPcxCameoSize(60, 47)).toBe(false);
    });
});
