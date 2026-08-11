import { describe, expect, test } from "bun:test";
import { IniSourceLoader } from "@/engine/IniSourceLoader";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { MemArchive } from "@/data/vfs/MemArchive";
import { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
import { ResourceLayer } from "@/data/vfs/ResourceLayer";
import { IniFile } from "@/data/IniFile";

function createVfs(files: Record<string, string>): VirtualFileSystem {
    const archive = new MemArchive();
    for (const [filename, contents] of Object.entries(files)) {
        archive.addFile(VirtualFile.fromBytes(new TextEncoder().encode(contents), filename));
    }
    const vfs = new VirtualFileSystem(undefined as any, {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    });
    vfs.addArchive(archive, "expandmo95.mix", {
        layer: ResourceLayer.ModCore,
        source: "mod",
        profile: "mental-omega",
    });
    return vfs;
}

describe("Ares effective INI source loading", () => {
    test("treats section and key casing as one canonical identity across layers", () => {
        const retail = new IniFile(`[Building]\nHealth=100\n[AudioVisual]\nConditionYellow=.5\n`);
        const profile = new IniFile(`[building]\nhealth=200\n[AUDIOVISUAL]\nconditionyellow=.7\n`);

        retail.mergeWith(profile);

        expect(retail.getSection("BUILDING")?.getNumber("HEALTH")).toBe(200);
        expect(retail.getSection("audiovisual")?.getNumber("CONDITIONYELLOW")).toBe(.7);
        expect(retail.getOrderedSections().filter((section) => section.name !== "__ROOT__")).toHaveLength(2);
    });

    test("merges root and nested includes depth-first with later values winning", () => {
        const vfs = createVfs({
            "rulesmo.ini": `[ #include ]\n1=rules/units.ini\n2=rules/buildings.ini\n[Test]\nValue=root\n`,
            "rules/units.ini": `[#include]\n1=rules/shared.ini\n[Test]\nValue=units\nUnits=yes\n`,
            "rules/shared.ini": `[Test]\nValue=shared\nShared=yes\n`,
            "rules/buildings.ini": `[Test]\nValue=buildings\nBuildings=yes\n`,
        });
        const effective = new IniSourceLoader(vfs).loadEffectiveIni("RULESMO.INI")!;

        expect(effective.ini.getSection("[#include]")).toBeUndefined();
        expect(effective.ini.getSection("Test")?.getString("Value")).toBe("buildings");
        expect(effective.ini.getSection("Test")?.getBool("Units")).toBe(true);
        expect(effective.ini.getSection("Test")?.getBool("Shared")).toBe(true);
        expect(effective.ini.getSection("Test")?.getBool("Buildings")).toBe(true);
        expect(effective.graph.nodes.map((node) => node.file)).toEqual([
            "RULESMO.INI",
            "rules/units.ini",
            "rules/shared.ini",
            "rules/buildings.ini",
        ]);

        const explanation = effective.explain("Test", "Value")!;
        expect(explanation.winner?.file).toBe("rules/buildings.ini");
        expect(explanation.shadowed.map((source) => source.file)).toEqual([
            "RULESMO.INI",
            "rules/units.ini",
            "rules/shared.ini",
        ]);
        expect(explanation.winner?.resolution?.winner?.archive).toBe("expandmo95.mix");
    });

    test("resolves case-insensitive paths and known MIX entries without enumeration", () => {
        const vfs = createVfs({
            "rulesmo.ini": `[#include]\n1=RULES/UNITS.INI\n`,
            "rules/units.ini": `[Unit]\nStrength=100\n`,
        });
        const effective = new IniSourceLoader(vfs).loadEffectiveIni("rulesmo.ini")!;
        expect(effective.ini.getSection("Unit")?.getString("Strength")).toBe("100");
        expect(effective.graph.diagnostics).toHaveLength(0);
    });

    test("resolves each source file once while retaining per-key provenance", () => {
        const vfs = createVfs({
            "rulesmo.ini": `[Root]\nA=yes\nB=yes\n`,
        });
        const originalResolve = vfs.resolve.bind(vfs);
        let resolveCalls = 0;
        vfs.resolve = ((filename: string) => {
            resolveCalls++;
            return originalResolve(filename);
        }) as typeof vfs.resolve;

        const effective = new IniSourceLoader(vfs).loadEffectiveIni("rulesmo.ini")!;

        expect(resolveCalls).toBe(1);
        expect(effective.explain("Root", "A")?.winner?.resolution?.winner?.archive).toBe("expandmo95.mix");
        expect(effective.explain("Root", "B")?.winner?.resolution?.winner?.archive).toBe("expandmo95.mix");
    });

    test("reports missing includes with the VFS resolution", () => {
        const vfs = createVfs({
            "rulesmo.ini": `[#include]\n1=missing.ini\n`,
        });
        const effective = new IniSourceLoader(vfs).loadEffectiveIni("rulesmo.ini")!;
        expect(effective.graph.diagnostics).toHaveLength(1);
        expect(effective.graph.diagnostics[0].code).toBe("ARES_INCLUDE_MISSING");
        expect(effective.graph.diagnostics[0].include).toBe("missing.ini");
        expect(effective.graph.diagnostics[0].resolution?.found).toBe(false);
    });

    test("detects recursive includes and loads each file only once", () => {
        const vfs = createVfs({
            "a.ini": `[#include]\n1=b.ini\n2=b.ini\n[Root]\nA=yes\n`,
            "b.ini": `[#include]\n1=c.ini\n[Root]\nB=yes\n`,
            "c.ini": `[#include]\n1=a.ini\n[Root]\nC=yes\n`,
        });
        const effective = new IniSourceLoader(vfs).loadEffectiveIni("a.ini")!;
        expect(effective.graph.nodes.map((node) => node.file)).toEqual(["a.ini", "b.ini", "c.ini"]);
        expect(effective.graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            "ARES_INCLUDE_CYCLE",
            "ARES_INCLUDE_DUPLICATE",
        ]);
        expect(effective.ini.getSection("Root")?.getBool("A")).toBe(true);
        expect(effective.ini.getSection("Root")?.getBool("B")).toBe(true);
        expect(effective.ini.getSection("Root")?.getBool("C")).toBe(true);
    });
});
