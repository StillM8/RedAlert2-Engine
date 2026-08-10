import { IniFile } from "@/data/IniFile";
import type { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
import { gamePathKey } from "@/engine/GamePath";

export type CompatibilityStatus = "parsed" | "implemented" | "verified" | "unknown";

export interface CompatibilityDiagnostic {
    file: string;
    section: string;
    key: string;
    value: string;
    status: CompatibilityStatus;
    capability: string;
}

export interface CompatibilityReport {
    filesScanned: number;
    mapFilesScanned: number;
    extensionKeys: number;
    diagnostics: CompatibilityDiagnostic[];
    byCapability: Record<string, number>;
}

interface CapabilityRecord {
    status: CompatibilityStatus;
    capability: string;
}

/**
 * The registry deliberately starts conservative. A key can be promoted from
 * parsed to implemented and verified only when its normalized runtime model
 * and a fixture exist. This prevents MO from appearing compatible merely
 * because its INI parser ignored an Ares extension.
 */
const ARES_REGISTRY = new Map<string, CapabilityRecord>();

function extensionCapability(key: string, sectionName: string): string | undefined {
    const keyMatch = key.match(/^(ares|phobos)(?:[.:_-]?)(.*)$/i);
    const sectionMatch = sectionName.match(/^(ares|phobos)(?:[.:_-]?)(.*)$/i);
    const match = keyMatch ?? (sectionMatch && [sectionMatch[0], sectionMatch[1], sectionMatch[2]]);
    if (match) {
        const namespace = match[1].toLowerCase();
        const name = (match[2] || sectionName).replace(/^[.:_-]+/, "").toLowerCase();
        return `${namespace}.${name || "section"}`;
    }
    return undefined;
}

export class CompatibilityScanner {
    static async scan(vfs: VirtualFileSystem): Promise<CompatibilityReport> {
        const diagnostics: CompatibilityDiagnostic[] = [];
        const allFiles = vfs.listFiles();
        const files = allFiles.filter((filename) => /\.ini$/i.test(filename));
        const mapFiles = allFiles.filter((filename) => /\.(?:map|mmx|yro)$/i.test(filename));
        for (const filename of files) {
            let ini: IniFile;
            try {
                ini = new IniFile(vfs.openFile(filename));
            }
            catch (error) {
                console.warn(`[CompatibilityScanner] Could not parse ${filename}`, error);
                continue;
            }
            for (const section of ini.sections.values()) {
                for (const [key, rawValue] of section.entries) {
                    const capability = extensionCapability(key, section.name);
                    if (!capability) continue;
                    const registryKey = `${gamePathKey(filename)}::${key.toLowerCase()}`;
                    const record = ARES_REGISTRY.get(registryKey) ?? ARES_REGISTRY.get(key.toLowerCase()) ?? {
                        status: "unknown" as const,
                        capability,
                    };
                    diagnostics.push({
                        file: filename,
                        section: section.name,
                        key,
                        value: Array.isArray(rawValue) ? rawValue.join(",") : String(rawValue),
                        status: record.status,
                        capability: record.capability,
                    });
                }
            }
        }
        const byCapability: Record<string, number> = {};
        for (const diagnostic of diagnostics) {
            byCapability[diagnostic.capability] = (byCapability[diagnostic.capability] ?? 0) + 1;
        }
        return {
            filesScanned: files.length,
            mapFilesScanned: mapFiles.length,
            extensionKeys: diagnostics.length,
            diagnostics,
            byCapability,
        };
    }

    static register(key: string, record: CapabilityRecord): void {
        ARES_REGISTRY.set(key.toLowerCase(), record);
    }
}
