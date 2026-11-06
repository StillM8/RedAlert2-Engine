import { describe, expect, test } from "bun:test";
import { ContentRegistry } from "@/content/ContentRegistry";
import {
    CONTENT_IMPORT_BACKUP_PREFIX,
    CONTENT_IMPORT_IN_PROGRESS_FILE,
    CONTENT_IMPORT_STAGING_PREFIX,
    createInstalledContentMetadata,
    INSTALLED_CONTENT_METADATA_FILE,
} from "@/content/ContentIdentity";
import { importContentSourceToOpfs } from "@/content/InstalledContentImporter";
import type { ContentImportSource } from "@/content/PlatformContentProvider";

type MemoryEntry = MemoryDirectory | MemoryFileHandle;

interface MutableSource extends ContentImportSource {
    disposeCount: number;
}

interface MemoryWritable {
    write(data: string | Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
}

class MemoryController {
    metadataWriteFailures = 0;
}

class MemoryFileHandle {
    readonly kind = "file";
    data: Uint8Array;

    constructor(data = new Uint8Array()) {
        this.data = data;
    }

    async createWritable(): Promise<MemoryWritable> {
        let pending = new Uint8Array();
        const file = this;
        const append = (data: string | Uint8Array): void => {
            const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
            const next = new Uint8Array(pending.byteLength + bytes.byteLength);
            next.set(pending);
            next.set(bytes, pending.byteLength);
            pending = next;
        };
        return {
            write: async (data) => append(data),
            close: async () => {
                file.data = pending;
            },
            abort: async () => {
                pending = new Uint8Array();
            },
        };
    }

    async getFile(): Promise<{
        size: number;
        text(): Promise<string>;
        stream(): ReadableStream<Uint8Array>;
    }> {
        const data = this.data.slice();
        return {
            size: data.byteLength,
            text: async () => new TextDecoder().decode(data),
            stream: () => new ReadableStream<Uint8Array>({
                start(controller) {
                    if (data.byteLength) {
                        controller.enqueue(data);
                    }
                    controller.close();
                },
            }),
        };
    }
}

class MemoryDirectory {
    readonly kind = "directory";
    readonly children = new Map<string, MemoryEntry>();
    readonly failRemoveNames = new Set<string>();
    readonly controller: MemoryController;

    constructor(controller = new MemoryController()) {
        this.controller = controller;
    }

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
        const existing = this.children.get(name);
        if (existing instanceof MemoryDirectory) {
            return existing;
        }
        if (existing || !options?.create) {
            throw new Error(`Directory not found: ${name}`);
        }
        const directory = new MemoryDirectory(this.controller);
        this.children.set(name, directory);
        return directory;
    }

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
        if (name === INSTALLED_CONTENT_METADATA_FILE && this.controller.metadataWriteFailures > 0) {
            this.controller.metadataWriteFailures--;
            throw new Error("Injected metadata write failure");
        }
        const existing = this.children.get(name);
        if (existing instanceof MemoryFileHandle) {
            return existing;
        }
        if (existing || !options?.create) {
            throw new Error(`File not found: ${name}`);
        }
        const file = new MemoryFileHandle();
        this.children.set(name, file);
        return file;
    }

    async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
        for (const [name, entry] of this.children) {
            yield [name, entry as unknown as FileSystemHandle];
        }
    }

    async *keys(): AsyncIterableIterator<string> {
        yield* this.children.keys();
    }

    async *values(): AsyncIterableIterator<FileSystemHandle> {
        for (const entry of this.children.values()) {
            yield entry as unknown as FileSystemHandle;
        }
    }

    async removeEntry(name: string): Promise<void> {
        if (this.failRemoveNames.has(name)) {
            this.failRemoveNames.delete(name);
            throw new Error(`Injected remove failure: ${name}`);
        }
        if (!this.children.delete(name)) {
            throw new Error(`Entry not found: ${name}`);
        }
    }
}

function bytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function sourceFromFiles(options: {
    name?: string;
    files?: Record<string, Uint8Array>;
    failRead?: string;
    failStream?: string;
} = {}): MutableSource {
    const files = new Map<string, Uint8Array>(Object.entries(options.files ?? {
        "rulesmo.ini": bytes("[Rules]\n"),
        "artmo.ini": bytes("[Art]\n"),
        "expandmo95.mix": bytes("mix"),
    }));
    const source: MutableSource = {
        kind: "archives",
        name: options.name ?? "MentalOmega",
        files: [...files].map(([path, data]) => ({ path, size: data.byteLength })),
        async readFile(path: string): Promise<ReadableStream<Uint8Array>> {
            if (options.failRead === path) {
                throw new Error(`Injected read failure: ${path}`);
            }
            const data = files.get(path);
            if (!data) {
                throw new Error(`Missing source file: ${path}`);
            }
            return new ReadableStream<Uint8Array>({
                start(controller) {
                    if (options.failStream === path) {
                        const midpoint = Math.max(1, Math.floor(data.byteLength / 2));
                        controller.enqueue(data.slice(0, midpoint));
                        queueMicrotask(() => controller.error(new Error(`Injected stream failure: ${path}`)));
                        return;
                    }
                    controller.enqueue(data);
                    controller.close();
                },
            });
        },
        dispose(): void {
            source.disposeCount++;
        },
        disposeCount: 0,
    };
    return source;
}

async function findFile(root: MemoryDirectory, path: string, create = false): Promise<MemoryFileHandle> {
    const segments = path.split("/");
    const fileName = segments.pop();
    if (!fileName) {
        throw new Error("Missing file name");
    }
    let directory = root;
    for (const segment of segments) {
        directory = await directory.getDirectoryHandle(segment, { create });
    }
    return directory.getFileHandle(fileName, { create });
}

async function seedInstallation(
    root: MemoryDirectory,
    id: string,
    files: Record<string, string>,
    sourceName = "OldContent",
): Promise<MemoryDirectory> {
    const mods = await root.getDirectoryHandle("mods", { create: true });
    const target = await mods.getDirectoryHandle(id, { create: true });
    for (const [path, value] of Object.entries(files)) {
        const file = await findFile(target, path, true);
        file.data = bytes(value);
    }
    const metadata = createInstalledContentMetadata({
        id,
        name: sourceName,
        version: "imported",
        sourceName,
        sourceKind: "archives",
        baseProfile: "ra2",
        runtimeProfile: "ra2",
        extensions: [],
    });
    const metadataFile = await target.getFileHandle(INSTALLED_CONTENT_METADATA_FILE, { create: true });
    metadataFile.data = bytes(JSON.stringify(metadata));
    return target;
}

async function snapshotBytes(directory: MemoryDirectory): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const visit = async (current: MemoryDirectory, prefix: string): Promise<void> => {
        for (const [name, entry] of current.children) {
            const path = prefix ? `${prefix}/${name}` : name;
            if (entry instanceof MemoryDirectory) {
                await visit(entry, path);
            }
            else {
                result[path] = [...entry.data].join(",");
            }
        }
    };
    await visit(directory, "");
    return result;
}

async function withNavigator<T>(root: MemoryDirectory, callback: () => Promise<T>): Promise<T> {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { storage: { getDirectory: async () => root } },
    });
    try {
        return await callback();
    }
    finally {
        if (previousNavigator) {
            Object.defineProperty(globalThis, "navigator", previousNavigator);
        }
        else {
            delete (globalThis as { navigator?: unknown }).navigator;
        }
    }
}

async function expectNoTransactionEntries(mods: MemoryDirectory): Promise<void> {
    for (const name of mods.children.keys()) {
        expect(name.startsWith(CONTENT_IMPORT_STAGING_PREFIX)).toBe(false);
        expect(name.startsWith(CONTENT_IMPORT_BACKUP_PREFIX)).toBe(false);
    }
}

function enableDirectoryMoves(root: MemoryDirectory): void {
    const locations = new Map<MemoryDirectory, { parent: MemoryDirectory; name: string }>();
    const visit = (directory: MemoryDirectory, parent: MemoryDirectory, name: string): void => {
        locations.set(directory, { parent, name });
        for (const [childName, child] of directory.children) {
            if (child instanceof MemoryDirectory) {
                visit(child, directory, childName);
            }
        }
    };
    for (const [name, child] of root.children) {
        if (child instanceof MemoryDirectory) {
            visit(child, root, name);
        }
    }
    for (const [directory, location] of locations) {
        Object.defineProperty(directory, "move", {
            configurable: true,
            value: async (destinationParent: FileSystemDirectoryHandle, destinationName?: string) => {
                const target = destinationParent as unknown as MemoryDirectory;
                if (!(target instanceof MemoryDirectory) || location.parent.children.get(location.name) !== directory) {
                    throw new Error("Injected invalid directory move");
                }
                const nextName = destinationName ?? location.name;
                if (target.children.has(nextName)) {
                    throw new Error(`Injected directory move collision: ${nextName}`);
                }
                location.parent.children.delete(location.name);
                target.children.set(nextName, directory);
                location.parent = target;
                location.name = nextName;
            },
        });
    }
}

async function expectOldInstallationPreserved(
    root: MemoryDirectory,
    id: string,
    source: MutableSource,
    before: Record<string, string>,
): Promise<void> {
    const mods = await root.getDirectoryHandle("mods");
    const target = await mods.getDirectoryHandle(id);
    expect(await snapshotBytes(target)).toEqual(before);
    expect(target.children.has(CONTENT_IMPORT_IN_PROGRESS_FILE)).toBe(false);
    await expectNoTransactionEntries(mods);
    source.dispose();
}

describe("transactional installed content import", () => {
    test("copies extracted Mental Omega files and commits profile metadata", async () => {
        const root = new MemoryDirectory();
        const source = sourceFromFiles();
        await withNavigator(root, async () => {
            const result = await importContentSourceToOpfs(source, "mental-omega-test");
            expect(result.runtimeProfile).toBe("mental-omega");
            expect(result.baseProfile).toBe("yr");
            const mods = await root.getDirectoryHandle("mods");
            const target = await mods.getDirectoryHandle("mental-omega-test");
            expect(target.children.has(CONTENT_IMPORT_IN_PROGRESS_FILE)).toBe(false);
            const metadataFile = await target.getFileHandle(INSTALLED_CONTENT_METADATA_FILE);
            const metadata = JSON.parse(await (await metadataFile.getFile()).text()) as Record<string, unknown>;
            expect(metadata.sourceKind).toBe("archives");
            expect(metadata.runtimeProfile).toBe("mental-omega");
            expect(metadata.extensions).toEqual(["ares"]);
            expect((await findFile(target, "rulesmo.ini")).data.byteLength).toBeGreaterThan(0);
            expect((await findFile(target, "artmo.ini")).data.byteLength).toBeGreaterThan(0);
            expect((await findFile(target, "expandmo95.mix")).data.byteLength).toBeGreaterThan(0);
            await expectNoTransactionEntries(mods);
        });
        source.dispose();
    });

    test("persists campaign profile metadata inputs", async () => {
        const root = new MemoryDirectory();
        const source = sourceFromFiles({
            name: "CampaignPackage",
            files: {
                "missionmo.ini": bytes("[MissionMO]\n"),
                "mapselmo.ini": bytes("[MapSelMO]\n"),
                "INI/BattleClient01.ini": bytes("[BattleClient]\n"),
                "MissionsMO/Chapter01/mission.map": bytes("campaign"),
                "campaign.mix": bytes("mix"),
            },
        });
        await withNavigator(root, async () => {
            const result = await importContentSourceToOpfs(source, "campaign-package", undefined, {
                metadata: {
                    runtimeProfile: "mental-omega",
                    baseProfile: "yr",
                    extensions: ["ares"],
                    version: "campaign",
                },
            });
            expect(result.runtimeProfile).toBe("mental-omega");
            expect(result.baseProfile).toBe("yr");
            const target = await (await root.getDirectoryHandle("mods")).getDirectoryHandle("campaign-package");
            const metadata = JSON.parse(await (await (await target.getFileHandle(INSTALLED_CONTENT_METADATA_FILE)).getFile()).text()) as Record<string, unknown>;
            expect(metadata.runtimeProfile).toBe("mental-omega");
            expect(metadata.baseProfile).toBe("yr");
            expect(metadata.extensions).toEqual(["ares"]);
            expect(metadata.version).toBe("campaign");
        });
        source.dispose();
    });

    test("preserves the old installation when the first file cannot be read", async () => {
        const root = new MemoryDirectory();
        const target = await seedInstallation(root, "replace-me", {
            "old.txt": "old bytes",
            "nested/old.bin": "old nested bytes",
        });
        const before = await snapshotBytes(target);
        const source = sourceFromFiles({ failRead: "rulesmo.ini" });
        await withNavigator(root, async () => {
            await expect(importContentSourceToOpfs(source, "replace-me")).rejects.toThrow(/Injected read failure/);
            await expectOldInstallationPreserved(root, "replace-me", source, before);
        });
    });

    test("preserves the old installation when a source stream fails mid-copy", async () => {
        const root = new MemoryDirectory();
        const target = await seedInstallation(root, "replace-me", { "old.txt": "old bytes" });
        const before = await snapshotBytes(target);
        const source = sourceFromFiles({ failStream: "artmo.ini" });
        await withNavigator(root, async () => {
            await expect(importContentSourceToOpfs(source, "replace-me")).rejects.toThrow(/Injected stream failure/);
            await expectOldInstallationPreserved(root, "replace-me", source, before);
        });
    });

    test("preserves the old installation when staged metadata cannot be written", async () => {
        const root = new MemoryDirectory();
        const target = await seedInstallation(root, "replace-me", { "old.txt": "old bytes" });
        const before = await snapshotBytes(target);
        root.controller.metadataWriteFailures = 1;
        const source = sourceFromFiles();
        await withNavigator(root, async () => {
            await expect(importContentSourceToOpfs(source, "replace-me")).rejects.toThrow(/Injected metadata write failure/);
            await expectOldInstallationPreserved(root, "replace-me", source, before);
        });
    });

    test("replaces an installation only after staging and removes obsolete content", async () => {
        const root = new MemoryDirectory();
        await seedInstallation(root, "replace-me", {
            "old.txt": "old bytes",
            "obsolete/old.bin": "obsolete bytes",
        });
        const source = sourceFromFiles({
            name: "Replacement",
            files: {
                "rulesmo.ini": bytes("new rules"),
                "artmo.ini": bytes("new art"),
                "expandmo95.mix": bytes("new mix"),
                "new/nested.bin": bytes("new nested"),
            },
        });
        await withNavigator(root, async () => {
            const result = await importContentSourceToOpfs(source, "replace-me");
            expect(result.id).toBe("replace-me");
            const mods = await root.getDirectoryHandle("mods");
            const target = await mods.getDirectoryHandle("replace-me");
            expect((await findFile(target, "rulesmo.ini")).data).toEqual(bytes("new rules"));
            expect((await findFile(target, "new/nested.bin")).data).toEqual(bytes("new nested"));
            await expect(findFile(target, "old.txt")).rejects.toThrow();
            await expect(findFile(target, "obsolete/old.bin")).rejects.toThrow();
            expect(target.children.has(CONTENT_IMPORT_IN_PROGRESS_FILE)).toBe(false);
            await expectNoTransactionEntries(mods);
        });
        source.dispose();
    });

    test("uses native directory move when the OPFS implementation provides it", async () => {
        const root = new MemoryDirectory();
        await seedInstallation(root, "replace-me", { "old.txt": "old bytes" });
        enableDirectoryMoves(root);
        const source = sourceFromFiles({ name: "Moved Replacement" });
        await withNavigator(root, async () => {
            const result = await importContentSourceToOpfs(source, "replace-me");
            expect(result.id).toBe("replace-me");
            const mods = await root.getDirectoryHandle("mods");
            const target = await mods.getDirectoryHandle("replace-me");
            expect((await findFile(target, "rulesmo.ini")).data.byteLength).toBeGreaterThan(0);
            expect(target.children.has(CONTENT_IMPORT_IN_PROGRESS_FILE)).toBe(false);
            await expectNoTransactionEntries(mods);
        });
        source.dispose();
    });

    test("cleans stale staging without exposing it as installed content", async () => {
        const root = new MemoryDirectory();
        const mods = await root.getDirectoryHandle("mods", { create: true });
        const staleName = `${CONTENT_IMPORT_STAGING_PREFIX}old-transaction`;
        const stale = await mods.getDirectoryHandle(staleName, { create: true });
        const staleMetadata = await stale.getFileHandle(INSTALLED_CONTENT_METADATA_FILE, { create: true });
        staleMetadata.data = bytes(JSON.stringify({ name: "stale" }));
        const registryItems = await withNavigator(root, () => new ContentRegistry().listLibrary());
        expect(registryItems.some((item) => item.kind === "mod")).toBe(false);
        const source = sourceFromFiles();
        await withNavigator(root, async () => {
            await importContentSourceToOpfs(source, "fresh-mod");
            await expect(mods.getDirectoryHandle(staleName)).rejects.toThrow(/not found/);
            await expectNoTransactionEntries(mods);
        });
        source.dispose();
    });

    test("preserves requested and generated IDs across repeated imports", async () => {
        const root = new MemoryDirectory();
        const firstSource = sourceFromFiles({ name: "Generated Mod" });
        const requestedSource = sourceFromFiles({ name: "Requested Source" });
        await withNavigator(root, async () => {
            const generated = await importContentSourceToOpfs(firstSource);
            expect(generated.id).toBe("generated-mod");
            const repeated = await importContentSourceToOpfs(sourceFromFiles({ name: "Generated Mod" }));
            expect(repeated.id).toBe("generated-mod");
            const requested = await importContentSourceToOpfs(requestedSource, "requested-id");
            expect(requested.id).toBe("requested-id");
            const mods = await root.getDirectoryHandle("mods");
            expect(mods.children.has("generated-mod")).toBe(true);
            expect(mods.children.has("requested-id")).toBe(true);
            expect(mods.children.has("generated-mod-2")).toBe(false);
            await expectNoTransactionEntries(mods);
        });
        firstSource.dispose();
        requestedSource.dispose();
    });

    test("restores the prior bytes when replacement cleanup fails", async () => {
        const root = new MemoryDirectory();
        const oldTarget = await seedInstallation(root, "replace-me", {
            "old.txt": "old bytes",
            "obsolete.txt": "obsolete bytes",
        });
        const before = await snapshotBytes(oldTarget);
        oldTarget.failRemoveNames.add("obsolete.txt");
        const source = sourceFromFiles();
        await withNavigator(root, async () => {
            await expect(importContentSourceToOpfs(source, "replace-me")).rejects.toThrow(/Injected remove failure/);
            const mods = await root.getDirectoryHandle("mods");
            const target = await mods.getDirectoryHandle("replace-me");
            expect(await snapshotBytes(target)).toEqual(before);
            expect(target.children.has(CONTENT_IMPORT_IN_PROGRESS_FILE)).toBe(false);
            await expectNoTransactionEntries(mods);
        });
        source.dispose();
    });

    test("fails closed with a preserved backup when rollback cannot remove the partial target", async () => {
        const root = new MemoryDirectory();
        const oldTarget = await seedInstallation(root, "replace-me", {
            "old.txt": "old bytes",
            "obsolete.txt": "obsolete bytes",
        });
        const before = await snapshotBytes(oldTarget);
        oldTarget.failRemoveNames.add("obsolete.txt");
        const mods = await root.getDirectoryHandle("mods");
        mods.failRemoveNames.add("replace-me");
        const source = sourceFromFiles();
        await withNavigator(root, async () => {
            await expect(importContentSourceToOpfs(source, "replace-me")).rejects.toThrow(/fail-closed/);
            const backupNames = [...mods.children.keys()].filter((name) => name.startsWith(CONTENT_IMPORT_BACKUP_PREFIX));
            expect(backupNames).toHaveLength(1);
            expect(snapshotBytes(oldTarget)).not.toEqual(before);
            expect(mods.children.has(CONTENT_IMPORT_IN_PROGRESS_FILE)).toBe(false);

        });
        source.dispose();
    });
});
