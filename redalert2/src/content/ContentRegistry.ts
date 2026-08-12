import {
    INSTALLED_CONTENT_METADATA_FILE,
    type InstalledContentMetadata,
} from "@/content/ContentIdentity";
import { gamePathKey } from "@/engine/GamePath";
import { detectContentProfile, GAME_PROFILES, isGameProfileId, type GameProfileId } from "@/engine/GameProfile";

export type BuiltinContentId = "builtin:ra2" | "builtin:yr";
export type ContentSelectionId = BuiltinContentId | `mod:${string}`;

export interface ContentSelection {
    id: ContentSelectionId;
    kind: "builtin" | "mod";
    profileId: GameProfileId;
    modId?: string;
}

export interface ContentLibraryItem {
    id: ContentSelectionId;
    kind: "builtin" | "mod";
    name: string;
    version?: string;
    profileId: GameProfileId;
    baseProfile: "ra2" | "yr";
    extensions: readonly string[];
    installed: boolean;
    status: "ready" | "needs-base" | "unknown";
    modId?: string;
}

function isBuiltinContentId(value: string): value is BuiltinContentId {
    return value === "builtin:ra2" || value === "builtin:yr";
}

export function parseContentSelectionId(value: string | null | undefined): ContentSelectionId | undefined {
    if (!value) {
        return undefined;
    }
    if (isBuiltinContentId(value)) {
        return value;
    }
    if (!value.startsWith("mod:")) {
        return undefined;
    }
    const modId = value.slice("mod:".length);
    if (!modId || !/^[a-z0-9_-]+$/i.test(modId)) {
        return undefined;
    }
    return `mod:${modId}`;
}

function profileForBuiltin(id: BuiltinContentId): GameProfileId {
    return id === "builtin:yr" ? "yr" : "ra2";
}

function baseProfileForRuntime(profileId: GameProfileId): "ra2" | "yr" {
    return profileId === "ra2" ? "ra2" : "yr";
}

function parseMetadata(value: string): Partial<InstalledContentMetadata> | undefined {
    try {
        const parsed = JSON.parse(value) as Partial<InstalledContentMetadata>;
        if (typeof parsed !== "object" || parsed === null || typeof parsed.name !== "string") {
            return undefined;
        }
        return parsed;
    }
    catch {
        return undefined;
    }
}

function metadataProfile(metadata: Partial<InstalledContentMetadata> | undefined): GameProfileId | undefined {
    return metadata && isGameProfileId(metadata.runtimeProfile) ? metadata.runtimeProfile : undefined;
}

async function readGeneratedMetadata(directory: FileSystemDirectoryHandle): Promise<Partial<InstalledContentMetadata> | undefined> {
    try {
        const file = await directory.getFileHandle(INSTALLED_CONTENT_METADATA_FILE);
        return parseMetadata(await (await file.getFile()).text());
    }
    catch {
        return undefined;
    }
}

async function listFilesRecursive(directory: FileSystemDirectoryHandle, prefix = ""): Promise<string[]> {
    const files: string[] = [];
    for await (const [name, handle] of directory.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "file") {
            files.push(path);
        }
        else {
            files.push(...await listFilesRecursive(handle as FileSystemDirectoryHandle, path));
        }
    }
    return files;
}

function profileFromPaths(paths: Iterable<string>): GameProfileId | undefined {
    return detectContentProfile(paths);
}

/** Shared content catalog and explicit Mod Menu route resolver. */
export class ContentRegistry {
    /**
     * Resolve only an explicit selection made by the Mods screen. The native
     * profile is the app's baseline; the content query is written by
     * ModManager immediately before a full document reload. There is no
     * hidden localStorage selection or startup content picker.
     */
    async resolveSelection(options: {
        location?: Location;
        fallbackProfile?: GameProfileId;
    } = {}): Promise<ContentSelection> {
        const url = options.location ? new URL(options.location.href) : new URL(window.location.href);
        const fallbackProfile = options.fallbackProfile ?? "ra2";
        const explicitContent = parseContentSelectionId(url.searchParams.get("content"));
        const legacyMod = url.searchParams.get("mod");
        const requested = explicitContent ?? (legacyMod ? parseContentSelectionId(`mod:${legacyMod}`) : undefined);
        if (requested) {
            return await this.selectionFromId(requested, fallbackProfile);
        }
        if (fallbackProfile === "mental-omega") {
            // Compatibility for old MO flavor URLs/installations. The normal
            // path is still an explicit Mod Menu selection.
            return { id: "mod:mental-omega", kind: "mod", modId: "mental-omega", profileId: fallbackProfile };
        }
        const builtinId: BuiltinContentId = fallbackProfile === "yr" ? "builtin:yr" : "builtin:ra2";
        return { id: builtinId, kind: "builtin", profileId: profileForBuiltin(builtinId) };
    }

    async listLibrary(): Promise<ContentLibraryItem[]> {
        if (typeof navigator.storage?.getDirectory !== "function") {
            return this.builtinItems(new Set());
        }
        const root = await navigator.storage.getDirectory();
        const rootFiles: string[] = [];
        for await (const [name, handle] of root.entries()) {
            if (handle.kind === "file") {
                rootFiles.push(name);
            }
        }
        const baseProfiles = this.detectBaseProfiles(rootFiles);
        const items = this.builtinItems(baseProfiles);
        let modsDirectory: FileSystemDirectoryHandle;
        try {
            modsDirectory = await root.getDirectoryHandle("mods");
        }
        catch {
            return items;
        }
        for await (const [modId, handle] of modsDirectory.entries()) {
            if (handle.kind !== "directory") {
                continue;
            }
            const modDirectory = handle as FileSystemDirectoryHandle;
            const metadata = await readGeneratedMetadata(modDirectory);
            const files = metadata ? [] : await listFilesRecursive(modDirectory);
            const profileId = metadataProfile(metadata) ?? profileFromPaths(files);
            const resolvedProfile = profileId ?? "ra2";
            const baseProfile = metadata?.baseProfile === "ra2" || metadata?.baseProfile === "yr"
                ? metadata.baseProfile
                : baseProfileForRuntime(resolvedProfile);
            const extensions = Array.isArray(metadata?.extensions)
                ? metadata.extensions.filter((extension): extension is string => typeof extension === "string")
                : resolvedProfile === "mental-omega" ? ["ares"] : [];
            items.push({
                id: `mod:${modId}`,
                kind: "mod",
                modId,
                name: typeof metadata?.name === "string" && metadata.name.trim() ? metadata.name : modId,
                version: typeof metadata?.version === "string" ? metadata.version : undefined,
                profileId: resolvedProfile,
                baseProfile,
                extensions,
                installed: true,
                status: baseProfiles.has(baseProfile) ? "ready" : "needs-base",
            });
        }
        return items;
    }

    private async selectionFromId(id: ContentSelectionId, fallbackProfile: GameProfileId): Promise<ContentSelection> {
        if (isBuiltinContentId(id)) {
            return { id, kind: "builtin", profileId: profileForBuiltin(id) };
        }
        const modId = id.slice("mod:".length);
        const metadata = await this.findInstalledMetadata(modId);
        return {
            id,
            kind: "mod",
            modId,
            profileId: metadataProfile(metadata) ?? fallbackProfile,
        };
    }

    private async findInstalledMetadata(modId: string): Promise<Partial<InstalledContentMetadata> | undefined> {
        if (typeof navigator.storage?.getDirectory !== "function") {
            return undefined;
        }
        try {
            const root = await navigator.storage.getDirectory();
            const mods = await root.getDirectoryHandle("mods");
            const mod = await mods.getDirectoryHandle(modId);
            return await readGeneratedMetadata(mod);
        }
        catch {
            return undefined;
        }
    }

    private detectBaseProfiles(files: Iterable<string>): Set<"ra2" | "yr"> {
        const names = new Set([...files].map((file) => gamePathKey(file)));
        const result = new Set<"ra2" | "yr">();
        if (GAME_PROFILES.ra2.requiredFiles.every((file) => names.has(gamePathKey(file)))) {
            result.add("ra2");
        }
        if (GAME_PROFILES.yr.requiredFiles.every((file) => names.has(gamePathKey(file)))) {
            result.add("yr");
        }
        return result;
    }

    private builtinItems(baseProfiles: Set<"ra2" | "yr">): ContentLibraryItem[] {
        return [
            {
                id: "builtin:ra2",
                kind: "builtin",
                name: GAME_PROFILES.ra2.displayName,
                profileId: "ra2",
                baseProfile: "ra2",
                extensions: [],
                installed: baseProfiles.has("ra2"),
                status: baseProfiles.has("ra2") ? "ready" : "needs-base",
            },
            {
                id: "builtin:yr",
                kind: "builtin",
                name: GAME_PROFILES.yr.displayName,
                profileId: "yr",
                baseProfile: "yr",
                extensions: [],
                installed: baseProfiles.has("yr"),
                status: baseProfiles.has("yr") ? "ready" : "needs-base",
            },
        ];
    }
}
