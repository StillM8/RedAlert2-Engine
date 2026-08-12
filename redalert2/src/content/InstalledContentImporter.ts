import { gamePathKey, normalizeGamePath } from "@/engine/GamePath";
import {
    allocateContentId,
    createInstalledContentMetadata,
    INSTALLED_CONTENT_METADATA_FILE,
    normalizeContentId,
} from "@/content/ContentIdentity";
import type { ContentImportSource } from "@/content/PlatformContentProvider";
import { detectContentProfile, type GameProfileId } from "@/engine/GameProfile";

export interface InstalledContentImportResult {
    id: string;
    name: string;
    version: string;
    sourceKind: ContentImportSource["kind"];
    baseProfile: "ra2" | "yr";
    runtimeProfile: GameProfileId;
    extensions: readonly string[];
}

interface ImportedFile {
    sourcePath: string;
    normalizedPath: string;
    size: number;
}

/**
 * Copy a platform-selected source into the shared OPFS mod library. This is
 * deliberately independent from Android/iOS/Windows picker APIs.
 */
export async function importContentSourceToOpfs(
    source: ContentImportSource,
    requestedId?: string,
    onProgress?: (text: string) => void,
): Promise<InstalledContentImportResult> {
    if (typeof navigator.storage?.getDirectory !== "function") {
        throw new Error("Persistent content storage is unavailable");
    }
    const root = await navigator.storage.getDirectory();
    const modsDir = await root.getDirectoryHandle("mods", { create: true });
    const existingIds: string[] = [];
    for await (const entry of modsDir.keys()) {
        existingIds.push(entry);
    }

    let contentId = allocateContentId(requestedId ?? source.name, existingIds, {
        reuseExisting: requestedId !== undefined,
    });
    if (requestedId === undefined && source.name) {
        // A generated manifest makes repeated imports of the same named
        // source stable without letting an unrelated old mod with the same
        // display name get overwritten.
        const candidateKey = gamePathKey(normalizeContentId(source.name));
        const existingCandidate = existingIds.find((id) => gamePathKey(id) === candidateKey);
        if (existingCandidate) {
            try {
                const existingDirectory = await modsDir.getDirectoryHandle(existingCandidate);
                const metadataHandle = await existingDirectory.getFileHandle(INSTALLED_CONTENT_METADATA_FILE);
                const existingMetadata = JSON.parse(await (await metadataHandle.getFile()).text()) as {
                    sourceName?: unknown;
                };
                if (typeof existingMetadata.sourceName === "string" &&
                    normalizeContentId(existingMetadata.sourceName) === normalizeContentId(source.name)) {
                    contentId = existingCandidate;
                }
            }
            catch {
                // An old/manual mod without generated metadata is never
                // replaced implicitly; it receives a collision-safe id.
            }
        }
    }
    const files: ImportedFile[] = [];
    const seenPaths = new Set<string>();
    for (const sourceFile of source.files) {
        const normalizedPath = normalizeGamePath(sourceFile.path);
        const pathKey = gamePathKey(normalizedPath);
        if (seenPaths.has(pathKey)) {
            throw new Error(`Duplicate imported content path: ${sourceFile.path}`);
        }
        seenPaths.add(pathKey);
        files.push({
            sourcePath: sourceFile.path,
            normalizedPath,
            size: sourceFile.size,
        });
    }
    if (!files.length) {
        throw new Error("The selected content contains no readable files");
    }

    const target = await modsDir.getDirectoryHandle(contentId, { create: true });
    for await (const entry of target.keys()) {
        await target.removeEntry(entry, { recursive: true });
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let copiedBytes = 0;
    for (const file of files) {
        const pathSegments = file.normalizedPath.split("/");
        const fileName = pathSegments.pop();
        if (!fileName) {
            throw new Error(`Imported content path has no filename: ${file.sourcePath}`);
        }
        let targetDirectory = target;
        for (const segment of pathSegments) {
            targetDirectory = await targetDirectory.getDirectoryHandle(segment, { create: true });
        }
        const targetFile = await targetDirectory.getFileHandle(fileName, { create: true });
        const writable = await targetFile.createWritable();
        try {
            const stream = await source.readFile(file.normalizedPath);
            await stream.pipeTo(writable);
        }
        catch (error) {
            await writable.abort();
            throw error;
        }
        copiedBytes += file.size;
        onProgress?.(`Importing content... ${(copiedBytes / 1048576).toFixed(0)} / ${(totalBytes / 1048576).toFixed(0)} MB`);
    }

    const contentPaths = files.map((file) => file.normalizedPath);
    const runtimeProfile: GameProfileId = detectContentProfile(contentPaths);
    const isMentalOmega = runtimeProfile === "mental-omega";
    const baseProfile: "ra2" | "yr" = isMentalOmega || runtimeProfile === "yr" ? "yr" : "ra2";
    const extensions = isMentalOmega ? ["ares"] : [];
    const metadata = createInstalledContentMetadata({
        id: contentId,
        name: source.name ?? contentId,
        version: "imported",
        sourceName: source.name,
        sourceKind: source.kind,
        baseProfile,
        runtimeProfile,
        extensions,
    });
    const metadataFile = await target.getFileHandle(INSTALLED_CONTENT_METADATA_FILE, { create: true });
    const metadataWriter = await metadataFile.createWritable();
    await metadataWriter.write(JSON.stringify(metadata, null, 2));
    await metadataWriter.close();

    return {
        id: contentId,
        name: metadata.name,
        version: metadata.version ?? "imported",
        sourceKind: source.kind,
        baseProfile,
        runtimeProfile,
        extensions,
    };
}
