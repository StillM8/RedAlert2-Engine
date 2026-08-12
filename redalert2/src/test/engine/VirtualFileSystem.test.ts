import { describe, expect, test } from "bun:test";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import { MemArchive } from "@/data/vfs/MemArchive";
import { isCampaignOnlyMixFilename, VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
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
            ["Install/MIX/sidebar.pal", VirtualFile.fromBytes(new Uint8Array([1, 2, 3]), "sidebar.pal")],
            ["Install/MIX/radar.shp", VirtualFile.fromBytes(new Uint8Array([4, 5, 6]), "radar.shp")],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield "Install/MIX/rulesmo.ini";
                yield "Install/MIX/rules/units.ini";
                yield "Install/MIX/sidebar.pal";
                yield "Install/MIX/radar.shp";
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
        expect(vfs.openFile("SIDEBAR.PAL").getBytes()).toEqual(new Uint8Array([1, 2, 3]));
        expect(vfs.openFile("radar.shp").getBytes()).toEqual(new Uint8Array([4, 5, 6]));
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

    test("inherits parent layer when a side MIX is loaded from a mod container", async () => {
        const nestedMixBytes = createMixBytes([
            ["tab00.shp", new Uint8Array([1, 2, 3])],
        ]);
        const outerMix = createMix([["sidec04.mix", nestedMixBytes]]);
        const vfs = createVfs();
        vfs.addArchive(outerMix, "expandmo96.mix", {
            layer: ResourceLayer.ModPatch,
            source: "mod",
            profile: "mental-omega",
            provenance: ["imported/expandmo96.mix"],
        });

        await vfs.addMixFile("sidec04.mix");

        const resolution = vfs.explain("tab00.shp");
        expect(resolution.winner).toMatchObject({
            archive: "sidec04.mix",
            layer: ResourceLayer.ModPatch,
            priority: ResourceLayer.ModPatch,
            source: "mod",
            profile: "mental-omega",
            provenance: ["imported/expandmo96.mix", "expandmo96.mix", "sidec04.mix"],
        });
    });

    test("discovers Ares side MIX archives nested in a mod container", async () => {
        const nestedMixBytes = createMixBytes([
            ["tab00.shp", new Uint8Array([4, 5, 6])],
        ]);
        const outerMix = createMix([["sidec04.mix", nestedMixBytes]]);
        const vfs = createVfs();
        vfs.addArchive(outerMix, "expandmo96.mix", {
            layer: ResourceLayer.ModPatch,
            source: "mod",
            profile: "mental-omega",
        });

        await vfs.loadNestedMixFile("sidec04.mix");

        expect(vfs.hasArchive("sidec04.mix")).toBe(true);
        expect(vfs.openFile("tab00.shp").getBytes()).toEqual(new Uint8Array([4, 5, 6]));
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

    test("rechecks extension audio bags after nested MIX discovery", async () => {
        const nestedMix = createMixBytes([
            ["audio01.bag", new Uint8Array([1, 2, 3, 4])],
            ["audio01.idx", createIdxBytes("nestedvoice")],
        ]);
        const files = new Map<string, Uint8Array>([
            ["ra2.mix", createMixBytes([["expandmo96.mix", nestedMix]])],
            ["language.mix", createEmptyMixBytes()],
            ["multi.mix", createEmptyMixBytes()],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield* files.keys();
            },
            async openFile(filename: string) {
                const bytes = files.get(filename.toLocaleLowerCase("en-US"));
                if (!bytes) throw new FileNotFoundError(filename);
                return VirtualFile.fromBytes(bytes, filename);
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        await vfs.loadImplicitMixFiles(EngineType.RedAlert2, GAME_PROFILES.ra2);
        expect(vfs.hasArchive("audio01.bag")).toBe(false);

        await vfs.loadNestedMixFiles(EngineType.RedAlert2, GAME_PROFILES["mental-omega"]);

        expect(vfs.hasArchive("expandmo96.mix")).toBe(true);
        expect(vfs.hasArchive("audio01.bag")).toBe(true);
        expect(vfs.openFile("nestedvoice.wav").getSize()).toBeGreaterThan(4);
    });

    test("mounts non-numbered profile MIX containers from imported storage", async () => {
        const files = new Map<string, Uint8Array>([
            ["mapsmo03.mix", createEmptyMixBytes()],
            ["multimo.mix", createEmptyMixBytes()],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield* files.keys();
            },
            async openFile(filename: string) {
                const bytes = files.get(filename.toLocaleLowerCase("en-US"));
                if (!bytes) throw new FileNotFoundError(filename);
                return VirtualFile.fromBytes(bytes, filename);
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        await vfs.loadExtraMixFiles(EngineType.YurisRevenge, GAME_PROFILES["mental-omega"]);

        expect(vfs.hasArchive("mapsmo03.mix")).toBe(true);
        expect(vfs.hasArchive("multimo.mix")).toBe(true);
    });

    test("leaves campaign-only MIX containers out of the multiplayer boot mount", async () => {
        const files = new Map<string, Uint8Array>([
            ["maps01.mix", createEmptyMixBytes()],
            ["movies01.mix", createEmptyMixBytes()],
            ["movmd03.mix", createEmptyMixBytes()],
            ["missionsmo.mix", createEmptyMixBytes()],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield* files.keys();
            },
            async openFile(filename: string) {
                const bytes = files.get(filename.toLocaleLowerCase("en-US"));
                if (!bytes) throw new FileNotFoundError(filename);
                return VirtualFile.fromBytes(bytes, filename);
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        expect(isCampaignOnlyMixFilename("movies01.mix")).toBe(true);
        expect(isCampaignOnlyMixFilename("movmd03.mix")).toBe(true);
        expect(isCampaignOnlyMixFilename("missionsmo.mix")).toBe(true);
        expect(isCampaignOnlyMixFilename("maps01.mix")).toBe(false);

        await vfs.loadExtraMixFiles(EngineType.YurisRevenge, GAME_PROFILES["mental-omega"]);

        expect(vfs.hasArchive("maps01.mix")).toBe(true);
        expect(vfs.hasArchive("movies01.mix")).toBe(false);
        expect(vfs.hasArchive("movmd03.mix")).toBe(false);
        expect(vfs.hasArchive("missionsmo.mix")).toBe(false);
    });

    test("defers large profile MIX layers until a content consumer requests them", async () => {
        const profileCore = createMixBytes([
            ["rulesmo.ini", new TextEncoder().encode("[Rules]")],
            ["artmo.ini", new TextEncoder().encode("[Art]")],
            ["aimo.ini", new TextEncoder().encode("[AI]")],
        ]);
        const files = new Map<string, Uint8Array>([
            ["expandmo99.mix", profileCore],
            ["expandmo95.mix", createEmptyMixBytes()],
            ["multimo.mix", createEmptyMixBytes()],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield* files.keys();
            },
            async openFile(filename: string) {
                const bytes = files.get(filename.toLocaleLowerCase("en-US"));
                if (!bytes) throw new FileNotFoundError(filename);
                return VirtualFile.fromBytes(bytes, filename);
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        await vfs.loadExtraMixFiles(EngineType.YurisRevenge, GAME_PROFILES["mental-omega"], {
            deferAfterProfileFiles: true,
        });

        expect(vfs.hasArchive("expandmo99.mix")).toBe(true);
        expect(vfs.hasArchive("expandmo95.mix")).toBe(false);
        expect(vfs.hasArchive("multimo.mix")).toBe(true);
        expect(vfs.openFile("rulesmo.ini").readAsString()).toBe("[Rules]");

        await vfs.loadDeferredExtraMixFiles(EngineType.YurisRevenge, GAME_PROFILES["mental-omega"]);

        expect(vfs.hasArchive("expandmo95.mix")).toBe(true);
    });

    test("falls back to the base MIX when an active overlay has the same filename", async () => {
        const baseMix = createMixBytes([
            ["rulesmo.ini", new TextEncoder().encode("[Rules]\nBase=yes")],
            ["base-only.ini", new TextEncoder().encode("base")],
        ]);
        const overlayMix = createMixBytes([
            ["overlay-only.ini", new TextEncoder().encode("overlay")],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield "expandmo99.mix";
            },
            async openFile(filename: string) {
                if (filename.toLocaleLowerCase() !== "expandmo99.mix") {
                    throw new FileNotFoundError(filename);
                }
                return VirtualFile.fromBytes(baseMix, filename);
            },
            async openFilesFromLayers(filename: string) {
                if (filename.toLocaleLowerCase() !== "expandmo99.mix") {
                    return [];
                }
                return [
                    { file: VirtualFile.fromBytes(baseMix, "expandmo99.mix"), directoryIndex: 0 },
                    { file: VirtualFile.fromBytes(overlayMix, "expandmo99.mix"), directoryIndex: 1 },
                ];
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        await vfs.loadExtraMixFiles(EngineType.YurisRevenge, GAME_PROFILES["mental-omega"]);

        expect(vfs.openFile("rulesmo.ini").readAsString()).toContain("Base=yes");
        expect(vfs.openFile("base-only.ini").readAsString()).toBe("base");
        expect(vfs.openFile("overlay-only.ini").readAsString()).toBe("overlay");
        expect(vfs.debugListFileOwners("rulesmo.ini")).toEqual(["expandmo99.mix"]);
    });

    test("treats file-manager duplicate MIX names as a full archive plus patch", async () => {
        const patchMix = createMixBytes([
            ["overlay-only.ini", new TextEncoder().encode("overlay")],
        ]);
        const baseMix = new Uint8Array([
            ...createMixBytes([
                ["rulesmo.ini", new TextEncoder().encode("[Rules]\nBase=yes")],
                ["base-only.ini", new TextEncoder().encode("base")],
            ]),
            ...new Uint8Array(128),
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield "expandmo99.mix";
                yield "expandmo99 (1).mix";
            },
            async openFile(filename: string) {
                throw new FileNotFoundError(filename);
            },
            async openFilesFromLayers(filename: string) {
                if (filename.toLocaleLowerCase() !== "expandmo99.mix") {
                    return [];
                }
                return [
                    { file: VirtualFile.fromBytes(patchMix, "expandmo99.mix"), directoryIndex: 1 },
                    { file: VirtualFile.fromBytes(baseMix, "expandmo99 (1).mix"), directoryIndex: 1 },
                ];
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        await vfs.loadExtraMixFiles(EngineType.YurisRevenge, GAME_PROFILES["mental-omega"]);

        expect(vfs.openFile("rulesmo.ini").readAsString()).toContain("Base=yes");
        expect(vfs.openFile("base-only.ini").readAsString()).toBe("base");
        expect(vfs.openFile("overlay-only.ini").readAsString()).toBe("overlay");
        expect(vfs.listArchives()).toContain("expandmo99.mix");
        expect(vfs.listArchives()).not.toContain("expandmo99 (1).mix");
    });

    test("defers standalone map archives without deferring profile MIX files", async () => {
        const files = new Map<string, Uint8Array>([
            ["arena.mmx", createEmptyMixBytes()],
            ["arena.yro", createEmptyMixBytes()],
            ["mapsmo03.mix", createEmptyMixBytes()],
        ]);
        const rfs = {
            async *getEntriesRecursive() {
                yield* files.keys();
            },
            async openFile(filename: string) {
                const bytes = files.get(filename.toLocaleLowerCase("en-US"));
                if (!bytes) throw new FileNotFoundError(filename);
                return VirtualFile.fromBytes(bytes, filename);
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        await vfs.loadExtraMixFiles(EngineType.YurisRevenge, GAME_PROFILES["mental-omega"], {
            deferMapArchives: true,
        });

        expect(vfs.hasArchive("mapsmo03.mix")).toBe(true);
        expect(vfs.hasArchive("arena.mmx")).toBe(false);
        expect(vfs.hasArchive("arena.yro")).toBe(false);

        await vfs.loadDeferredMapArchives(EngineType.YurisRevenge, GAME_PROFILES["mental-omega"]);

        expect(vfs.hasArchive("arena.mmx")).toBe(true);
        expect(vfs.hasArchive("arena.yro")).toBe(true);
    });

    test("retries deferred map archives after a transient open failure", async () => {
        const bytes = createEmptyMixBytes();
        let openAttempts = 0;
        const rfs = {
            async *getEntriesRecursive() {
                yield "arena.mmx";
            },
            async openFile(filename: string) {
                if (filename.toLocaleLowerCase("en-US") === "arena.mmx") {
                    openAttempts++;
                    if (openAttempts === 1) throw new FileNotFoundError(filename);
                    return VirtualFile.fromBytes(bytes, filename);
                }
                throw new FileNotFoundError(filename);
            },
        } as any;
        const vfs = new VirtualFileSystem(rfs, {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        });

        await expect(vfs.loadExtraMixFiles(EngineType.RedAlert2, GAME_PROFILES.ra2, {
            deferMapArchives: true,
        })).resolves.toBeUndefined();
        let firstAttemptFailed = false;
        try {
            await vfs.loadDeferredMapArchives(EngineType.RedAlert2, GAME_PROFILES.ra2);
        }
        catch (error) {
            firstAttemptFailed = error instanceof FileNotFoundError;
        }
        expect(firstAttemptFailed).toBe(true);
        await vfs.loadDeferredMapArchives(EngineType.RedAlert2, GAME_PROFILES.ra2);
        await vfs.loadDeferredMapArchives(EngineType.RedAlert2, GAME_PROFILES.ra2);

        expect(vfs.hasArchive("arena.mmx")).toBe(true);
        expect(openAttempts).toBe(2);
    });
});
