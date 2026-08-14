import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MixFile } from "../redalert2/src/data/MixFile";
import { VirtualFile } from "../redalert2/src/data/vfs/VirtualFile";
import { VirtualFileSystem } from "../redalert2/src/data/vfs/VirtualFileSystem";
import { ResourceLayer } from "../redalert2/src/data/vfs/ResourceLayer";

function archiveOrder(names: string[]): string[] {
    const priority = (name: string): [number, number, string] => {
        const lower = name.toLocaleLowerCase("en-US");
        const moExpand = lower.match(/^expandmo(\d+)\.mix$/);
        if (moExpand) return [0, -Number(moExpand[1]), lower];
        if (lower === "multimo.mix" || lower === "thememo.mix") return [1, 0, lower];
        const mdExpand = lower.match(/^expandmd(\d+)\.mix$/);
        if (mdExpand) return [2, -Number(mdExpand[1]), lower];
        const expand = lower.match(/^expand(\d+)\.mix$/);
        if (expand) return [3, -Number(expand[1]), lower];
        return [4, 0, lower];
    };
    return [...names].sort((left, right) => {
        const a = priority(left);
        const b = priority(right);
        return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
    });
}

/** Mount the user-owned MO MIX layers with the same precedence used by the audit. */
export function createMentalOmegaVfs(installRoot: string): { vfs: VirtualFileSystem; archives: string[] } {
    const mixFiles = readdirSync(installRoot)
        .filter((name) => /\.mix$/i.test(name))
        .filter((name) => /^(?:expandmo\d+|expandmd\d+|multimo|thememo|ra2md|multimd|ra2|multi|language|langmd)\.mix$/i.test(name))
        .map((name) => join(installRoot, name));
    const orderedPaths = archiveOrder(mixFiles.map((path) => path.split(/[\\/]/).pop()!))
        .map((name) => join(installRoot, name));
    const vfs = new VirtualFileSystem(undefined as any, {
        info: () => undefined,
        warn: (message) => console.warn(message),
        error: (message) => console.error(message),
    });

    for (const filename of orderedPaths) {
        const archiveName = filename.split(/[\\/]/).pop()!;
        const bytes = new Uint8Array(readFileSync(filename));
        const virtualFile = VirtualFile.fromBytes(bytes, filename);
        // MixFile emits development-only header diagnostics for the first
        // entries of every archive. They are not compatibility findings.
        const originalLog = console.log;
        console.log = (...args: unknown[]) => {
            if (typeof args[0] === "string" && args[0].startsWith("[Our]")) return;
            originalLog(...args);
        };
        let archive: MixFile;
        try {
            archive = new MixFile(virtualFile.stream);
        }
        finally {
            console.log = originalLog;
        }
        vfs.addArchive(archive, archiveName, {
            id: archiveName,
            layer: ResourceLayer.ModPatch,
            source: "mod",
            profile: "mental-omega",
            provenance: [filename],
        });
    }

    return {
        vfs,
        archives: orderedPaths.map((path) => path.split(/[\\/]/).pop()!),
    };
}
