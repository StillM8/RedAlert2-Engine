import { describe, expect, test } from "bun:test";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { MemArchive } from "@/data/vfs/MemArchive";
import { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
import { ResourceLayer } from "@/data/vfs/ResourceLayer";

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
});
