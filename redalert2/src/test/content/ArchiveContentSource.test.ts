import { describe, expect, test } from "bun:test";
import sevenZipFactory from "7z-wasm";
import { extractArchiveContentSource } from "@/content/ArchiveContentSource";
import type { ArchiveModuleFactoryOptions, ArchiveWasmModule } from "@/content/ArchiveContentSource";
import { detectContentProfile } from "@/engine/GameProfile";
import type { ContentImportSource } from "@/content/PlatformContentProvider";

const encoder = new TextEncoder();
const wasmBinaryPromise = Bun.file(new URL("../../../public/7zz.wasm", import.meta.url)).arrayBuffer();

interface ArchiveFixture {
    name: string;
    entries: Record<string, string | Uint8Array>;
}

interface MutableSource extends ContentImportSource {
    disposeCount: number;
}

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const value of data) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.byteLength;
    }
    return result;
}

function zipBytes(entries: Record<string, string | Uint8Array>): Uint8Array {
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let localOffset = 0;
    for (const [rawName, value] of Object.entries(entries)) {
        const name = encoder.encode(rawName);
        const data = typeof value === "string" ? encoder.encode(value) : value;
        const crc = crc32(data);
        const local = new Uint8Array(30 + name.byteLength + data.byteLength);
        const localView = new DataView(local.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0, true);
        localView.setUint16(8, 0, true);
        localView.setUint16(10, 0, true);
        localView.setUint16(12, 0, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, data.byteLength, true);
        localView.setUint32(22, data.byteLength, true);
        localView.setUint16(26, name.byteLength, true);
        local.set(name, 30);
        local.set(data, 30 + name.byteLength);
        localParts.push(local);
        const central = new Uint8Array(46 + name.byteLength);
        const centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint16(12, 0, true);
        centralView.setUint16(14, 0, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, data.byteLength, true);
        centralView.setUint32(24, data.byteLength, true);
        centralView.setUint16(28, name.byteLength, true);
        centralView.setUint32(42, localOffset, true);
        central.set(name, 46);
        centralParts.push(central);
        localOffset += local.byteLength;
    }
    const central = concat(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, localParts.length, true);
    endView.setUint16(10, localParts.length, true);
    endView.setUint32(12, central.byteLength, true);
    endView.setUint32(16, localOffset, true);
    return concat([...localParts, central, end]);
}

function sourceFromFixtures(fixtures: readonly ArchiveFixture[]): MutableSource {
    const archives = fixtures.map((fixture) => ({
        name: fixture.name,
        bytes: zipBytes(fixture.entries),
    }));
    const byPath = new Map(archives.map((archive) => [archive.name, archive.bytes]));
    const source: MutableSource = {
        kind: "archives",
        name: archives.length === 1 ? archives[0].name : "imported-content",
        files: archives.map((archive) => ({ path: archive.name, size: archive.bytes.byteLength })),
        async readFile(path: string): Promise<ReadableStream<Uint8Array>> {
            const bytes = byPath.get(path);
            if (!bytes) {
                throw new Error(`Missing fixture archive: ${path}`);
            }
            return new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(bytes);
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

function sourceFromBytes(name: string, bytes: Uint8Array): MutableSource {
    const source: MutableSource = {
        kind: "archives",
        name,
        files: [{ path: name, size: bytes.byteLength }],
        readFile: async () => new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes);
                controller.close();
            },
        }),
        dispose(): void {
            source.disposeCount++;
        },
        disposeCount: 0,
    };
    return source;
}

async function createRealModule(options: ArchiveModuleFactoryOptions): Promise<ArchiveWasmModule> {
    const wasmBinary = await wasmBinaryPromise;
    return sevenZipFactory({
        ...options,
        wasmBinary,
    }) as unknown as Promise<ArchiveWasmModule>;
}

async function extract(
    fixtures: readonly ArchiveFixture[],
    onProgress?: (text: string) => void,
): Promise<{ source: MutableSource; result: ContentImportSource; moduleDisposeCount: () => number }> {
    const source = sourceFromFixtures(fixtures);
    let moduleDisposeCount = 0;
    const result = await extractArchiveContentSource(source, onProgress, {
        createModule: async (options) => {
            const module = await createRealModule(options);
            const originalDispose = module.dispose;
            module.dispose = () => {
                moduleDisposeCount++;
                originalDispose?.();
            };
            return module;
        },
    });
    return { source, result, moduleDisposeCount: () => moduleDisposeCount };
}

async function sourceText(source: ContentImportSource, path: string): Promise<string> {
    return new Response(await source.readFile(path)).text();
}

describe("browser archive content extraction", () => {
    test("rejects traversal entries before extraction and disposes the source", async () => {
        const source = sourceFromFixtures([{
            name: "unsafe.zip",
            entries: {
                "../outside.txt": "outside",
                "safe.txt": "safe",
            },
        }]);
        let moduleDisposeCount = 0;
        await expect(extractArchiveContentSource(source, undefined, {
            createModule: async (options) => {
                const module = await createRealModule(options);
                module.dispose = () => {
                    moduleDisposeCount++;
                };
                return module;
            },
        })).rejects.toMatchObject({ name: "InvalidArchiveError" });
        expect(source.disposeCount).toBe(1);
        expect(moduleDisposeCount).toBe(1);
    });

    test("rejects absolute archive paths", async () => {
        const source = sourceFromFixtures([{
            name: "absolute.zip",
            entries: { "/outside.txt": "outside" },
        }]);
        await expect(extractArchiveContentSource(source, undefined, {
            createModule: createRealModule,
        })).rejects.toMatchObject({ name: "InvalidArchiveError" });
        expect(source.disposeCount).toBe(1);
    });

    test("does not strip a root when archive entries are mixed", async () => {
        const { result, source } = await extract([{
            name: "mixed.zip",
            entries: {
                "root/file.txt": "file",
                "other.txt": "other",
            },
        }]);
        try {
            expect(result.files.map((file) => file.path)).toEqual(["other.txt", "root/file.txt"]);
        }
        finally {
            result.dispose();
            expect(source.disposeCount).toBe(1);
        }
    });

    test("strips one common root, preserves nested paths, and detects Mental Omega", async () => {
        const progress: string[] = [];
        const { result, source, moduleDisposeCount } = await extract([{
            name: "MentalOmega.zip",
            entries: {
                "MentalOmega/rulesmo.ini": "[Rules]\n",
                "MentalOmega/artmo.ini": "[Art]\n",
                "MentalOmega/nested/expandmo95.mix": "mix",
            },
        }], (text) => progress.push(text));
        try {
            expect(result.files.map((file) => file.path)).toEqual([
                "nested/expandmo95.mix",
                "rulesmo.ini",
                "artmo.ini",
            ].sort());
            expect(await sourceText(result, "nested/expandmo95.mix")).toBe("mix");
            expect(detectContentProfile(result.files.map((file) => file.path))).toBe("mental-omega");
            expect(progress.some((text) => text.includes("Extracting archive 1/1"))).toBe(true);
            expect(moduleDisposeCount()).toBe(1);
        }
        finally {
            result.dispose();
            expect(source.disposeCount).toBe(1);
        }
    });

    test("merges multiple archives without flattening nested files", async () => {
        const { result, source } = await extract([
            { name: "base.zip", entries: { "base/rulesmo.ini": "rules" } },
            { name: "extras.zip", entries: { "extras/mapsmo/example.map": "map" } },
        ]);
        try {
            expect(result.files.map((file) => file.path)).toEqual(["mapsmo/example.map", "rulesmo.ini"]);
            expect(await sourceText(result, "mapsmo/example.map")).toBe("map");
        }
        finally {
            result.dispose();
            expect(source.disposeCount).toBe(1);
        }
    });

    test("rejects deterministic case-insensitive collisions across archives", async () => {
        const source = sourceFromFixtures([
            { name: "a.zip", entries: { "rulesmo.ini": "first" } },
            { name: "b.zip", entries: { "RULESMO.INI": "second" } },
        ]);
        await expect(extractArchiveContentSource(source, undefined, {
            createModule: createRealModule,
        })).rejects.toThrow(/collision/i);
        expect(source.disposeCount).toBe(1);
    });

    test("rejects extraction failures and cleans temporary files", async () => {
        const bytes = zipBytes({ "bad.txt": "hello" });
        bytes[30 + "bad.txt".length] ^= 1;
        const source = sourceFromBytes("corrupt.zip", bytes);
        await expect(extractArchiveContentSource(source, undefined, {
            createModule: createRealModule,
        })).rejects.toMatchObject({ name: "ArchiveExtractionError" });
        expect(source.disposeCount).toBe(1);
    });

    test("rejects unsupported and invalid archives", async () => {
        const unsupported = sourceFromFixtures([{ name: "content.tar", entries: { "a.txt": "a" } }]);
        await expect(extractArchiveContentSource(unsupported, undefined, {
            createModule: createRealModule,
        })).rejects.toMatchObject({ name: "InvalidArchiveError" });
        expect(unsupported.disposeCount).toBe(1);

        let invalidDisposeCount = 0;
        const invalidSource: ContentImportSource = {
            kind: "archives",
            name: "content.zip",
            files: [{ path: "content.zip", size: 3 }],
            readFile: async () => new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode("bad"));
                    controller.close();
                },
            }),
            dispose: () => {
                invalidDisposeCount++;
            },
        };
        await expect(extractArchiveContentSource(invalidSource, undefined, {
            createModule: createRealModule,
        })).rejects.toMatchObject({ name: "InvalidArchiveError" });
        expect(invalidDisposeCount).toBe(1);
    });
});
