import { describe, expect, test } from 'bun:test';
import { ModManager } from '@/gui/screen/mainMenu/modSel/ModManager';

interface FakeDirectory {
    files: Map<string, string>;
    getDirectory(name: string, create: boolean): Promise<FakeDirectory>;
    containsEntry(name: string): Promise<boolean>;
    getRawFile(name: string): Promise<{ text(): Promise<string> }>;
}

function fakeDir(files: Record<string, string>): FakeDirectory {
    const dir: FakeDirectory = {
        files: new Map(Object.entries(files)),
        async getDirectory(name: string, create: boolean) {
            if (this.files.has(name) || create) {
                return fakeDir({});
            }
            throw new Error(`Directory ${name} not found`);
        },
        async containsEntry(name: string) {
            return this.files.has(name);
        },
        async getRawFile(name: string) {
            const contents = this.files.get(name);
            if (contents === undefined) {
                throw new Error(`File ${name} not found`);
            }
            return { text: async () => contents };
        },
    };
    return dir;
}

const locationStub = { href: "https://example.test/" } as Location;
const loaderStub = { loadText: async () => "" };

describe('ModManager.scanModCompatibility', () => {
    test('scans loose INIs when the mod directory exposes them', async () => {
        const modsRoot = fakeDir({
            "mo-mod": "",
        });
        const modDir = fakeDir({
            "rulesmo.ini": [
                "[ArmorTypes]",
                "0=MOIron",
                "[SomeUnit]",
                "Foundation=Custom",
                "Foundation.0=0,0",
                "[SomeSW]",
                "Type=GenericWarhead",
                "SW.Damage=500",
                "SW.Warhead=MOBlast",
                "",
            ].join("\n"),
            "artmo.ini": "[SomeAnim]\nCustomPalette=some.pal\n",
        });
        // Override getDirectory so the mod folder resolves to the mod INIs.
        (modsRoot as any).getDirectory = async (name: string) => {
            if (name === "mo-mod") {
                return modDir;
            }
            throw new Error("missing");
        };
        const manager = new ModManager(locationStub, modsRoot as any, loaderStub as any);
        const scan = await manager.scanModCompatibility("mo-mod");

        expect(scan.sources.sort()).toEqual(["artmo.ini", "rulesmo.ini"]);
        expect(scan.missingSources).toContain("rules.ini");
        expect(scan.missingSources).toContain("aimo.ini");
        const ids = scan.featureUsage.map((usage) => usage.featureId);
        expect(ids).toContain("ares.additional-armor-types");
        expect(ids).toContain("ares.custom-foundations");
        expect(ids).toContain("ares.custom-superweapons");
        expect(ids).toContain("ares.custom-animation-palettes");
        expect(scan.uniqueExtensionKeys).toBeGreaterThan(0);
    });

    test('returns an empty report for a missing mod', async () => {
        const modsRoot = fakeDir({});
        const manager = new ModManager(locationStub, modsRoot as any, loaderStub as any);
        const scan = await manager.scanModCompatibility("missing-mod");
        expect(scan.sources).toEqual([]);
        expect(scan.featureUsage).toEqual([]);
        expect(scan.missingSources).toEqual([]);
    });
});
