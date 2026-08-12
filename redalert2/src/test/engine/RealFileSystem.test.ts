import { describe, expect, test } from "bun:test";
import { RealFileSystem } from "@/data/vfs/RealFileSystem";

interface FakeEntry {
    name: string;
    kind: "file" | "directory";
    entries?: FakeEntry[];
}

function fakeDirectory(name: string, entries: FakeEntry[]): FileSystemDirectoryHandle {
    return {
        name,
        kind: "directory",
        async *entries() {
            for (const entry of entries) {
                yield [entry.name, entry.kind === "directory"
                    ? fakeDirectory(entry.name, entry.entries ?? [])
                    : { name: entry.name, kind: "file" } as unknown as FileSystemFileHandle] as [string, FileSystemHandle];
            }
        },
    } as unknown as FileSystemDirectoryHandle;
}

describe("RealFileSystem root isolation", () => {
    test("does not recursively enumerate unselected managed directories", async () => {
        const root = fakeDirectory("game", [
            { name: "ra2.mix", kind: "file" },
            {
                name: "mods",
                kind: "directory",
                entries: [{
                    name: "other-mod",
                    kind: "directory",
                    entries: [{ name: "rules.ini", kind: "file" }],
                }],
            },
            {
                name: "maps",
                kind: "directory",
                entries: [{ name: "other-map.mmx", kind: "file" }],
            },
        ]);
        const selectedMod = fakeDirectory("selected-mod", [
            { name: "rules.ini", kind: "file" },
        ]);
        const rfs = new RealFileSystem({
            excludedRootDirectories: ["mods", "maps"],
        });
        rfs.addRootDirectoryHandle(root);
        rfs.addDirectoryHandle(selectedMod);

        const entries: string[] = [];
        for await (const entry of rfs.getEntriesRecursive()) {
            entries.push(entry);
        }

        expect(entries).toEqual(["ra2.mix", "rules.ini"]);
        expect(entries).not.toContain("mods/other-mod/rules.ini");
        expect(entries).not.toContain("maps/other-map.mmx");
    });

    test("prefers the selected overlay when resolving nested profile archives by leaf", async () => {
        const root = fakeDirectory("game", [
            { name: "expandmo99.mix", kind: "file" },
        ]);
        const selectedMod = fakeDirectory("selected-mod", [
            {
                name: "Install",
                kind: "directory",
                entries: [{ name: "expandmo99.mix", kind: "file" }],
            },
        ]);
        const rfs = new RealFileSystem();
        rfs.addRootDirectoryHandle(root);
        rfs.addDirectoryHandle(selectedMod);

        await expect(rfs.findEntryByLeaf("expandmo99.mix")).resolves.toBe("Install/expandmo99.mix");
    });
});
