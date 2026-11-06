import { describe, expect, test } from "bun:test";
import {
    ACTIVE_CONTENT_STORAGE_KEY,
    ContentRegistry,
    parseContentSelectionId,
    persistContentSelection,
} from "@/content/ContentRegistry";

describe("content registry selection", () => {
    test("accepts built-in and mod selection ids but rejects unsafe ids", () => {
        expect(parseContentSelectionId("builtin:ra2")).toBe("builtin:ra2");
        expect(parseContentSelectionId("mod:mental-omega_336")).toBe("mod:mental-omega_336");
        expect(parseContentSelectionId("mod:../other-mod")).toBeUndefined();
        expect(parseContentSelectionId("mental-omega")).toBeUndefined();
    });

    test("resolves explicit Mod Menu routes", async () => {
        const registry = new ContentRegistry();
        await expect(registry.resolveSelection({
            location: { href: "https://example.test/index.html?content=builtin:yr" } as Location,
            fallbackProfile: "ra2",
        })).resolves.toMatchObject({ id: "builtin:yr", profileId: "yr" });

        const selection = await registry.resolveSelection({
            location: { href: "https://example.test/index.html?mod=mental-omega" } as Location,
            fallbackProfile: "yr",
        });
        expect(selection.id).toBe("mod:mental-omega");
        expect(selection.modId).toBe("mental-omega");
        expect(selection.profileId).toBe("yr");

        await expect(registry.resolveSelection({
            location: { href: "https://example.test/index.html" } as Location,
            fallbackProfile: "ra2",
        })).resolves.toMatchObject({ id: "builtin:ra2", profileId: "ra2" });
    });

    test("selects the persisted Mental Omega campaign profile from metadata", async () => {
        const metadata = {
            schemaVersion: 1,
            id: "mental-omega-campaign",
            name: "Mental Omega Campaign",
            runtimeProfile: "mental-omega",
            baseProfile: "yr",
            extensions: ["ares"],
            importedAt: new Date().toISOString(),
        };
        const metadataFile = {
            kind: "file",
            async getFile() {
                return { text: async () => JSON.stringify(metadata) };
            },
        };
        const modDirectory = {
            kind: "directory",
            async *entries() {
                yield [".ra2-content.json", metadataFile];
            },
            async getFileHandle(name: string) {
                if (name === ".ra2-content.json") {
                    return metadataFile;
                }
                throw new Error("NotFoundError");
            },
        };
        const modsDirectory = {
            kind: "directory",
            async *entries() {
                yield ["mental-omega-campaign", modDirectory];
            },
            async getDirectoryHandle(name: string) {
                if (name === "mental-omega-campaign") {
                    return modDirectory;
                }
                throw new Error("NotFoundError");
            },
        };
        const root = {
            kind: "directory",
            async *entries() {
                yield ["mods", modsDirectory];
            },
            async getDirectoryHandle(name: string) {
                if (name === "mods") {
                    return modsDirectory;
                }
                throw new Error("NotFoundError");
            },
        };
        const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { storage: { getDirectory: async () => root } },
        });
        try {
            const values = new Map<string, string>();
            const storage = {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => values.set(key, value),
                removeItem: (key: string) => values.delete(key),
            };
            const registry = new ContentRegistry();
            await expect(registry.resolveSelection({
                location: { href: "https://example.test/index.html?content=mod:mental-omega-campaign" } as Location,
                storage,
            })).resolves.toMatchObject({
                id: "mod:mental-omega-campaign",
                profileId: "mental-omega",
            });
            expect(values.get(ACTIVE_CONTENT_STORAGE_KEY)).toBe("mod:mental-omega-campaign");
            await expect(registry.resolveSelection({
                location: { href: "https://example.test/index.html" } as Location,
                storage,
            })).resolves.toMatchObject({
                id: "mod:mental-omega-campaign",
                profileId: "mental-omega",
            });
            const library = await registry.listLibrary();
            expect(library.find((item) => item.modId === "mental-omega-campaign")?.profileId).toBe("mental-omega");
        }
        finally {
            if (previousNavigator) {
                Object.defineProperty(globalThis, "navigator", previousNavigator);
            }
            else {
                delete (globalThis as { navigator?: unknown }).navigator;
            }
        }
    });

    test("persists the last Mods selection across a cold start", async () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        };
        const registry = new ContentRegistry();

        await expect(registry.resolveSelection({
            location: { href: "https://example.test/index.html?content=builtin:yr" } as Location,
            storage,
        })).resolves.toMatchObject({ id: "builtin:yr", profileId: "yr" });
        expect(values.get(ACTIVE_CONTENT_STORAGE_KEY)).toBe("builtin:yr");

        await expect(registry.resolveSelection({
            location: { href: "https://example.test/index.html" } as Location,
            storage,
        })).resolves.toMatchObject({ id: "builtin:yr", profileId: "yr" });

        persistContentSelection(undefined, storage);
        await expect(registry.resolveSelection({
            location: { href: "https://example.test/index.html" } as Location,
            storage,
        })).resolves.toMatchObject({ id: "builtin:ra2", profileId: "ra2" });
    });
});
