import {
    CONTENT_IMPORT_IN_PROGRESS_FILE,
    INSTALLED_CONTENT_METADATA_FILE,
    type InstalledContentMetadata,
} from "@/content/ContentIdentity";
import { gamePathKey } from "@/engine/GamePath";
import { GAME_PROFILES, isGameProfileId, type GameProfileId } from "@/engine/GameProfile";

export type BuiltinContentId = "builtin:ra2" | "builtin:yr";
export type ContentSelectionId = BuiltinContentId | `mod:${string}`;
export const ACTIVE_CONTENT_STORAGE_KEY = "_ra2_active_content";

export interface ContentSelectionStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

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

async function hasImportInProgressMarker(directory: FileSystemDirectoryHandle): Promise<boolean> {
    try {
        await directory.getFileHandle(CONTENT_IMPORT_IN_PROGRESS_FILE);
        return true;
    }
    catch {
        return false;
    }
}

function getDefaultSelectionStorage(): ContentSelectionStorage | undefined {
    try {
        return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
    }
    catch {
        return undefined;
    }
}

export function readPersistedContentSelection(storage = getDefaultSelectionStorage()): ContentSelectionId | undefined {
    if (!storage) {
        return undefined;
    }
    try {
        return parseContentSelectionId(storage.getItem(ACTIVE_CONTENT_STORAGE_KEY));
    }
    catch {
        return undefined;
    }
}

export function persistContentSelection(
    id: ContentSelectionId | undefined,
    storage = getDefaultSelectionStorage(),
): void {
    if (!storage) {
        return;
    }
    try {
        if (id) {
            storage.setItem(ACTIVE_CONTENT_STORAGE_KEY, id);
        }
        else {
            storage.removeItem(ACTIVE_CONTENT_STORAGE_KEY);
        }
    }
    catch {
        // Private browsing and embedded WebViews can reject localStorage.
        // The URL route still handles the current reload in that case.
    }
}

/** Shared content catalog and explicit Mod Menu route resolver. */
export class ContentRegistry {
    /**
     * Resolve the route written by the Mods screen, then its persisted copy
     * for the next cold start. There is no separate startup content picker:
     * the persisted route is simply the last successful Mods selection.
     */
    async resolveSelection(options: {
        location?: Location;
        fallbackProfile?: GameProfileId;
        storage?: ContentSelectionStorage;
    } = {}): Promise<ContentSelection> {
        const url = options.location ? new URL(options.location.href) : new URL(window.location.href);
        const fallbackProfile = options.fallbackProfile ?? "ra2";
        const explicitContent = parseContentSelectionId(url.searchParams.get("content"));
        const legacyMod = url.searchParams.get("mod");
        const requested = explicitContent ?? (legacyMod ? parseContentSelectionId(`mod:${legacyMod}`) : undefined);
        if (requested) {
            const selection = await this.selectionFromId(requested, fallbackProfile);
            if (selection) {
                persistContentSelection(selection.id, options.storage);
                return selection;
            }
        }

        const persistedId = readPersistedContentSelection(options.storage);
        if (persistedId) {
            const persistedSelection = await this.selectionFromId(persistedId, fallbackProfile);
            const isAvailable = persistedSelection
                ? await this.isSelectionAvailable(persistedSelection.id)
                : false;
            if (persistedSelection && isAvailable !== false) {
                return persistedSelection;
            }
            // A deleted mod or removed base game must not trap the next boot
            // in a dead route. The user can select it again after reinstalling.
            persistContentSelection(undefined, options.storage);
        }

        // RA2 is the neutral first-boot baseline. YR, MO, and every other
        // content package become active only through Menu -> Mods.
        const builtinId: BuiltinContentId = "builtin:ra2";
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
            // Only completed UI imports belong in the selectable library.
            // This also hides an interrupted Android/WebView copy until the
            // user retries it, rather than booting a partial resource graph.
            if (!metadata || await hasImportInProgressMarker(modDirectory)) {
                continue;
            }
            const profileId = metadataProfile(metadata) ?? "ra2";
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

    private async selectionFromId(id: ContentSelectionId, fallbackProfile: GameProfileId): Promise<ContentSelection | undefined> {
        if (isBuiltinContentId(id)) {
            return { id, kind: "builtin", profileId: profileForBuiltin(id) };
        }
        const modId = id.slice("mod:".length);
        const installed = await this.findInstalledMod(modId);
        if (installed?.exists === false) {
            return undefined;
        }
        return {
            id,
            kind: "mod",
            modId,
            profileId: metadataProfile(installed?.metadata) ?? installed?.profileId ?? fallbackProfile,
        };
    }

    private async findInstalledMod(modId: string): Promise<{
        exists: boolean;
        metadata?: Partial<InstalledContentMetadata>;
        profileId?: GameProfileId;
    } | undefined> {
        if (typeof navigator.storage?.getDirectory !== "function") {
            return undefined;
        }
        try {
            const root = await navigator.storage.getDirectory();
            const mods = await root.getDirectoryHandle("mods");
            const mod = await mods.getDirectoryHandle(modId);
            const metadata = await readGeneratedMetadata(mod);
            if (!metadata || await hasImportInProgressMarker(mod)) {
                return { exists: false };
            }
            return {
                exists: true,
                metadata,
                profileId: metadataProfile(metadata),
            };
        }
        catch {
            return { exists: false };
        }
    }

    private async isSelectionAvailable(id: ContentSelectionId): Promise<boolean | undefined> {
        if (id.startsWith("mod:")) {
            return (await this.findInstalledMod(id.slice("mod:".length)))?.exists;
        }
        if (!isBuiltinContentId(id)) {
            return undefined;
        }
        if (typeof navigator.storage?.getDirectory !== "function") {
            return undefined;
        }
        try {
            const root = await navigator.storage.getDirectory();
            const rootFiles: string[] = [];
            for await (const [name, handle] of root.entries()) {
                if (handle.kind === "file") {
                    rootFiles.push(name);
                }
            }
            return this.detectBaseProfiles(rootFiles).has(baseProfileForRuntime(profileForBuiltin(id)));
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
