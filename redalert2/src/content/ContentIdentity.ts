import { gamePathKey } from "@/engine/GamePath";
import type { GameProfileId } from "@/engine/GameProfile";

export const INSTALLED_CONTENT_METADATA_FILE = ".ra2-content.json";
export const INSTALLED_CONTENT_METADATA_VERSION = 1;

export interface InstalledContentMetadata {
    schemaVersion: number;
    id: string;
    name: string;
    version?: string;
    sourceName?: string;
    sourceKind?: "directory" | "archives";
    baseProfile?: "ra2" | "yr";
    runtimeProfile?: GameProfileId;
    extensions?: readonly string[];
    importedAt: string;
}

/** Convert a display/source name into a stable, filesystem-safe content id. */
export function normalizeContentId(value: string | undefined, fallback = "imported-mod"): string {
    const normalized = (value ?? "")
        .trim()
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");
    return normalized || fallback;
}

/**
 * Reuse an exact existing id for a re-import/update, otherwise add a suffix
 * instead of replacing a different installation with the same display name.
 */
export function allocateContentId(
    candidate: string | undefined,
    existingIds: Iterable<string>,
    options: { reuseExisting?: boolean } = {},
): string {
    const base = normalizeContentId(candidate);
    const existing = new Map<string, string>();
    for (const id of existingIds) {
        existing.set(gamePathKey(id), id);
    }
    const exact = existing.get(gamePathKey(base));
    if (exact && options.reuseExisting !== false) {
        return exact;
    }
    let counter = 2;
    let result = base;
    while (existing.has(gamePathKey(result))) {
        result = `${base}-${counter++}`;
    }
    return result;
}

export function createInstalledContentMetadata(options: {
    id: string;
    name?: string;
    version?: string;
    sourceName?: string;
    sourceKind?: "directory" | "archives";
    baseProfile?: "ra2" | "yr";
    runtimeProfile?: GameProfileId;
    extensions?: readonly string[];
    importedAt?: string;
}): InstalledContentMetadata {
    return {
        schemaVersion: INSTALLED_CONTENT_METADATA_VERSION,
        id: options.id,
        name: options.name?.trim() || options.id,
        version: options.version,
        sourceName: options.sourceName,
        sourceKind: options.sourceKind,
        baseProfile: options.baseProfile,
        runtimeProfile: options.runtimeProfile,
        extensions: options.extensions,
        importedAt: options.importedAt ?? new Date().toISOString(),
    };
}
