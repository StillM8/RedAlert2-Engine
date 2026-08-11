import { describe, expect, test } from "bun:test";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { MemArchive } from "@/data/vfs/MemArchive";
import { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
import { ResourceLayer } from "@/data/vfs/ResourceLayer";
import { FileNotFoundError } from "@/data/vfs/FileNotFoundError";
import { GAME_PROFILES } from "@/engine/GameProfile";
import { EngineType } from "@/engine/EngineType";
import { DataStream } from "@/data/DataStream";
import { MixEntry } from "@/data/MixEntry";
import { MixFile } from "@/data/MixFile";

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

function createMixBytes(entries: Array<[string, Uint8Array]>): Uint8Array {
    const headerSize = 6 + entries.length * MixEntry.size;
    const totalSize = headerSize + entries.reduce((size, [, bytes]) => size + bytes.length, 0);
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    view.setUint16(0, entries.length, true);
    view.setUint32(2, 0, true);
    let offset = 0;
    for (let index = 0; index < entries.length; index++) {
        const [filename, bytes] = entries[index];
        const entryOffset = 6 + index * MixEntry.size;
        view.setUint32(entryOffset, MixEntry.hashFilename(filename), true);
        view.setUint32(entryOffset + 4, offset, true);
        view.setUint32(entryOffset + 8, bytes.length, true);
        new Uint8Array(buffer, headerSize + offset, bytes.length).set(bytes);
        offset += bytes.length;
    }
    return new Uint8Array(buffer);
}

function createMix(entries: Array<[string, Uint8Array]>): MixFile {
    return new MixFile(new DataStream(createMixBytes(entries)));
}

function createEmptyMixBytes(): Uint8Array {
    const bytes = createMixBytes([]);
    // MixFile distinguishes the TD header from a Westwood flags word using
    // the first four bytes. Keep an empty fixture on the TD path.
    bytes[3] = 1;
    return bytes;
}

function createIdxBytes(filename: string): Uint8Array {
    const bytes = new Uint8Array(36 + 16);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("GABA"), 0);
    view.setInt32(4, 2, true);
    view.setInt32(8, 1, true);
    bytes.set(new TextEncoder().encode(filename), 12);
    view.setUint32(28, 0, true);
    view.setUint32(32, 4, true);
    view.setUint32(36, 22050, true);
    view.setUint32(40, 0x02, true);
    view.setUint32(44, 0, true);
    return bytes;
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

    test("reuses the imported-storage index across resource consumers", async () => {
        let scans = 0;
        const files = new Map([
            ["maps/arena.map", VirtualFile.fromBytes(new TextEncoder().encode("map"), "arena.map")],
            ["rulesmo.ini", VirtualFile.fromBytes(new TextEncoder().encode("[Rules]"), "rulesmo.ini")],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                scans++;
                yield* files.keys();
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
        expect(await vfs.listRfsFiles()).toEqual(["rulesmo.ini", "maps/arena.map"]);
        expect(scans).toBe(1);
    });

    test("discovers known nested MIX names and preserves parent provenance", async () => {
        const nestedBytes = new TextEncoder().encode("[General]\nName=MO\n");
        const nestedMixBytes = createMixBytes([["rulesmo.ini", nestedBytes]]);
        const outerMix = createMix([["expandmo95.mix", nestedMixBytes]]);
        const vfs = createVfs();
        vfs.addArchive(outerMix, "ra2.mix", { layer: ResourceLayer.BaseGame, source: "game" });

        await vfs.loadNestedMixFiles(EngineType.YurisRevenge, GAME_PROFILES["mental-omega"]);

        expect(vfs.openFile("rulesmo.ini").readAsString()).toBe("[General]\nName=MO\n");
        expect(vfs.explain("rulesmo.ini").winner?.provenance).toEqual([
            "ra2.mix",
            "expandmo95.mix",
        ]);
    });

    test("fails loudly when a profile-required implicit MIX is unavailable", async () => {
        const vfs = createVfs();
        await expect(vfs.loadImplicitMixFiles(3, GAME_PROFILES.ra2)).rejects.toThrow(/Required archive "language\.mix"/);
    });

    test("discovers Ares extension audio bags from imported storage", async () => {
        const files = new Map([
            ["ra2.mix", VirtualFile.fromBytes(createEmptyMixBytes(), "ra2.mix")],
            ["language.mix", VirtualFile.fromBytes(createEmptyMixBytes(), "language.mix")],
            ["multi.mix", VirtualFile.fromBytes(createEmptyMixBytes(), "multi.mix")],
            ["audio01.bag", VirtualFile.fromBytes(new Uint8Array([1, 2, 3, 4]), "audio01.bag")],
            ["audio01.idx", VirtualFile.fromBytes(createIdxBytes("aresvoice"), "audio01.idx")],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield* files.keys();
            },
            async openFile(filename: string) {
                const file = files.get(filename.toLocaleLowerCase("en-US"));
                if (!file) throw new FileNotFoundError(filename);
                return file;
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        await vfs.loadImplicitMixFiles(EngineType.RedAlert2, GAME_PROFILES.ra2);

        expect(vfs.hasArchive("audio01.bag")).toBe(true);
        expect(vfs.openFile("aresvoice.wav").getSize()).toBeGreaterThan(4);
    });
});
