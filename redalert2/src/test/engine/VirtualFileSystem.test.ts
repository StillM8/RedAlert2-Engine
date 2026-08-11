import { describe, expect, test } from "bun:test";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { MemArchive } from "@/data/vfs/MemArchive";
import { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
import { ResourceLayer } from "@/data/vfs/ResourceLayer";
import { FileNotFoundError } from "@/data/vfs/FileNotFoundError";
import { GAME_PROFILES } from "@/engine/GameProfile";

function archiveWith(filename: string, contents: string): MemArchive {
    const archive = new MemArchive();
    archive.addFile(VirtualFile.fromBytes(new TextEncoder().encode(contents), filename));
    return archive;
}

function createVfs(): VirtualFileSystem {
    return new VirtualFileSystem(undefined as any, {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    });
}

describe("VirtualFileSystem resource precedence", () => {
    test("higher explicit layers win regardless of insertion order", () => {
        const vfs = createVfs();
        vfs.addArchive(archiveWith("rulesmd.ini", "base"), "ra2md.mix", {
            layer: ResourceLayer.Expansion,
            source: "game",
        });
        vfs.addArchive(archiveWith("rulesmd.ini", "mod"), "expandmo95.mix", {
            layer: ResourceLayer.ModPatch,
            source: "mod",
            profile: "mental-omega",
        });
        vfs.addArchive(archiveWith("rulesmd.ini", "loose"), "mem.archive", {
            layer: ResourceLayer.LooseOverride,
            source: "mod",
            profile: "mental-omega",
        });

        expect(vfs.openFile("RULESMD.INI").readAsString()).toBe("loose");
        const resolution = vfs.explain("rulesmd.ini");
        expect(resolution.found).toBe(true);
        expect(resolution.winner?.archive).toBe("mem.archive");
        expect(resolution.winner?.layer).toBe(ResourceLayer.LooseOverride);
        expect(resolution.shadowed.map((candidate) => candidate.archive)).toEqual([
            "expandmo95.mix",
            "ra2md.mix",
        ]);
    });

    test("keeps legacy insertion order for unannotated test/CDN archives", () => {
        const vfs = createVfs();
        vfs.addArchive(archiveWith("foo.ini", "first"), "first.archive");
        vfs.addArchive(archiveWith("foo.ini", "second"), "second.archive");

        expect(vfs.openFile("foo.ini").readAsString()).toBe("first");
        expect(vfs.debugListFileOwners("foo.ini")).toEqual([
            "first.archive",
            "second.archive",
        ]);
    });

    test("uses canonical archive identity and retains resource provenance", () => {
        const vfs = createVfs();
        vfs.addArchive(archiveWith("rulesmo.ini", "mod"), "Imported/MIX/EXPANDMO95.MIX", {
            layer: ResourceLayer.ModPatch,
            source: "mod",
            profile: "mental-omega",
            provenance: ["Imported/MIX/expandmo95.mix", "ra2md.mix"],
        });

        expect(vfs.hasArchive("imported\\mix\\expandmo95.mix")).toBe(true);
        const resolution = vfs.explain("RULESMO.INI");
        expect(resolution.winner?.provenance).toEqual([
            "Imported/MIX/expandmo95.mix",
            "ra2md.mix",
            "Imported/MIX/EXPANDMO95.MIX",
        ]);
    });

    test("falls back to a deterministic imported-storage leaf path", async () => {
        const files = new Map([
            ["a/expandmo95.mix", VirtualFile.fromBytes(new TextEncoder().encode("chosen"), "expandmo95.mix")],
            ["z/expandmo95.mix", VirtualFile.fromBytes(new TextEncoder().encode("other"), "expandmo95.mix")],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield "z/expandmo95.mix";
                yield "a/expandmo95.mix";
            },
            async openFile(filename: string) {
                const file = files.get(filename);
                if (!file) throw new FileNotFoundError(filename);
                return file;
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        const file = await vfs.openFileWithRfs("EXPANDMO95.MIX");
        expect(file?.readAsString()).toBe("chosen");
    });

    test("aliases standalone imported files to game-relative names", async () => {
        const files = new Map([
            ["Install/MIX/rulesmo.ini", VirtualFile.fromBytes(new TextEncoder().encode("[Rules]"), "rulesmo.ini")],
            ["Install/MIX/rules/units.ini", VirtualFile.fromBytes(new TextEncoder().encode("[Unit]"), "units.ini")],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield "Install/MIX/rulesmo.ini";
                yield "Install/MIX/rules/units.ini";
            },
            async openFile(filename: string) {
                const file = files.get(filename);
                if (!file) throw new FileNotFoundError(filename);
                return file;
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        await vfs.loadStandaloneFiles();

        expect(vfs.openFile("RULESMO.INI").readAsString()).toBe("[Rules]");
        expect(vfs.openFile("rules/UNITS.INI").readAsString()).toBe("[Unit]");
    });

    test("fails loudly when a profile-required implicit MIX is unavailable", async () => {
        const vfs = createVfs();
        await expect(vfs.loadImplicitMixFiles(3, GAME_PROFILES.ra2)).rejects.toThrow(/Required archive "language\.mix"/);
    });
});
