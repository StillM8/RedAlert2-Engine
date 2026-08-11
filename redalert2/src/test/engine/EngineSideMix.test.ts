import { describe, expect, test } from "bun:test";
import { MemArchive } from "@/data/vfs/MemArchive";
import { ResourceLayer } from "@/data/vfs/ResourceLayer";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
import { Engine } from "@/engine/Engine";

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

describe("Engine side MIX unloading", () => {
    test("removes the previous side archives before the next side is mounted", () => {
        const previousVfs = Engine.vfs;
        const vfs = createVfs();
        try {
            Engine.vfs = vfs;
            vfs.addArchive(archiveWith("sidebar.pal", "gdi"), "sidec01.mix", {
                layer: ResourceLayer.BaseGame,
                source: "game",
            });
            vfs.addArchive(archiveWith("sidebar.pal", "gdi-md"), "sidec01md.mix", {
                layer: ResourceLayer.Expansion,
                source: "game",
            });
            Engine.markSideMixDataLoaded(["sidec01.mix", "sidec01md.mix"]);

            Engine.unloadSideMixData(["sidec04.mix", "sidec04md.mix"]);

            expect(vfs.hasArchive("sidec01.mix")).toBe(false);
            expect(vfs.hasArchive("sidec01md.mix")).toBe(false);

            vfs.addArchive(archiveWith("sidebar.pal", "foehn"), "sidec04.mix", {
                layer: ResourceLayer.BaseGame,
                source: "game",
            });
            expect(vfs.openFile("sidebar.pal").readAsString()).toBe("foehn");
        }
        finally {
            Engine.vfs = previousVfs;
        }
    });
});
