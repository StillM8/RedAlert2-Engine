import { gamePathKey, normalizeGamePath } from "@/engine/GamePath";
import {
    allocateContentId,
    CONTENT_IMPORT_BACKUP_PREFIX,
    CONTENT_IMPORT_IN_PROGRESS_FILE,
    CONTENT_IMPORT_STAGING_PREFIX,
    createInstalledContentMetadata,
    INSTALLED_CONTENT_METADATA_FILE,
    INSTALLED_CONTENT_METADATA_VERSION,
    isContentImportStagingName,
    isContentImportTransactionName,
    normalizeContentId,
    type InstalledContentMetadata,
} from "@/content/ContentIdentity";
import type { ContentImportSource } from "@/content/PlatformContentProvider";
import { detectContentProfile, isGameProfileId, type GameProfileId } from "@/engine/GameProfile";

export interface InstalledContentImportResult {
    id: string;
    name: string;
    version: string;
    sourceKind: ContentImportSource["kind"];
    baseProfile: "ra2" | "yr";
    runtimeProfile: GameProfileId;
    extensions: readonly string[];
}

export interface InstalledContentImportMetadataInput {
    baseProfile?: "ra2" | "yr";
    runtimeProfile?: GameProfileId;
    profile?: GameProfileId;
    profileId?: GameProfileId;
    extensions?: readonly string[];
    version?: string;
}

export interface InstalledContentImportOptions {
    metadata?: InstalledContentImportMetadataInput;
}

export type ImportedContentSource = ContentImportSource & {
    metadata?: InstalledContentImportMetadataInput;
    baseProfile?: "ra2" | "yr";
    runtimeProfile?: GameProfileId;
    profile?: GameProfileId;
    profileId?: GameProfileId;
    extensions?: readonly string[];
    version?: string;
};

interface ImportedFile {
    sourcePath: string;
    normalizedPath: string;
    size: number;
}

interface ExpectedContent {
    id: string;
    files: Map<string, ImportedFile>;
    directories: Set<string>;
    directoryPaths: Set<string>;
    metadata: InstalledContentMetadata;
    runtimeProfile: GameProfileId;
    baseProfile: "ra2" | "yr";
    extensions: readonly string[];
}

interface SnapshotFile {
    path: string;
    handle: FileSystemFileHandle;
}

interface DirectorySnapshot {
    files: Map<string, SnapshotFile>;
    directories: Set<string>;
}

interface DirectoryMoveHandle extends FileSystemDirectoryHandle {
    move?: (destination: FileSystemDirectoryHandle, name?: string) => Promise<unknown>;
}

interface ValidationOptions {
    allowUnexpected: boolean;
    marker: "required" | "absent";
}

class MoveUnavailableError extends Error {
    constructor() {
        super("Directory move is unavailable");
        this.name = "MoveUnavailableError";
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isNotFoundError(error: unknown): boolean {
    const name = (error as { name?: unknown } | undefined)?.name;
    if (name === "NotFoundError") {
        return true;
    }
    return /(?:not found|notfounderror|no such file|entry not found|directory not found|file not found)/i.test(errorMessage(error));
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function pathDepth(path: string): number {
    return path ? path.split("/").length : 0;
}

function transactionSuffix(): string {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function findDirectory(
    parent: FileSystemDirectoryHandle,
    name: string,
): Promise<FileSystemDirectoryHandle | undefined> {
    try {
        return await parent.getDirectoryHandle(name);
    }
    catch (error) {
        if (isNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }
}

async function findFile(
    parent: FileSystemDirectoryHandle,
    name: string,
): Promise<FileSystemFileHandle | undefined> {
    try {
        return await parent.getFileHandle(name);
    }
    catch (error) {
        if (isNotFoundError(error)) {
            return undefined;
        }
        throw error;
    }
}

async function removeEntry(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    try {
        await parent.removeEntry(name, { recursive: true });
        return true;
    }
    catch (error) {
        if (isNotFoundError(error)) {
            return false;
        }
        throw error;
    }
}

async function directoryEntries(directory: FileSystemDirectoryHandle): Promise<[string, FileSystemHandle][]> {
    const candidate = directory as unknown as {
        entries?: unknown;
    };
    if (typeof candidate.entries === "function") {
        const entries: [string, FileSystemHandle][] = [];
        for await (const entry of (candidate.entries as () => AsyncIterable<[string, FileSystemHandle]>)()) {
            entries.push(entry);
        }
        return entries;
    }
    if (candidate.entries instanceof Map) {
        return [...candidate.entries].map(([name, entry]) => [name, entry as FileSystemHandle]);
    }
    const keys = (directory as unknown as { keys?: unknown }).keys;
    if (typeof keys === "function") {
        const entries: [string, FileSystemHandle][] = [];
        for await (const name of (keys as () => AsyncIterable<string>).call(directory)) {
            try {
                entries.push([name, await directory.getDirectoryHandle(name)]);
            }
            catch {
                entries.push([name, await directory.getFileHandle(name)]);
            }
        }
        return entries;
    }
    throw new Error("Content directory does not support enumeration");
}

async function cleanupStaleStagingEntries(modsDirectory: FileSystemDirectoryHandle): Promise<void> {
    let entries: [string, FileSystemHandle][] = [];
    try {
        entries = await directoryEntries(modsDirectory);
    }
    catch {
        return;
    }
    for (const [name] of entries) {
        if (!isContentImportStagingName(name)) {
            continue;
        }
        try {
            await removeEntry(modsDirectory, name);
        }
        catch {
        }
    }
}

async function createUniqueTransactionName(
    modsDirectory: FileSystemDirectoryHandle,
    prefix: string,
    contentId: string,
): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
        const name = `${prefix}${contentId}-${transactionSuffix()}-${attempt}`;
        let occupied = false;
        try {
            await modsDirectory.getDirectoryHandle(name);
            occupied = true;
        }
        catch (error) {
            if (!isNotFoundError(error)) {
                try {
                    await modsDirectory.getFileHandle(name);
                    occupied = true;
                }
                catch (fileError) {
                    if (!isNotFoundError(fileError)) {
                        throw fileError;
                    }
                }
            }
        }
        if (!occupied) {
            return name;
        }
    }
    throw new Error("Could not allocate a unique content import directory");
}

function prepareImportedFiles(source: ContentImportSource): ImportedFile[] {
    const files: ImportedFile[] = [];
    const fileKeys = new Set<string>();
    const directoryKeys = new Set<string>();
    for (const sourceFile of source.files) {
        if (!Number.isSafeInteger(sourceFile.size) || sourceFile.size < 0) {
            throw new Error(`Imported content has an invalid size: "${sourceFile.path}"`);
        }
        const normalizedPath = normalizeGamePath(sourceFile.path);
        const pathKey = gamePathKey(normalizedPath);
        if (pathKey === gamePathKey(INSTALLED_CONTENT_METADATA_FILE) ||
            pathKey === gamePathKey(CONTENT_IMPORT_IN_PROGRESS_FILE)) {
            throw new Error(`Imported content uses a reserved path: "${sourceFile.path}"`);
        }
        if (fileKeys.has(pathKey)) {
            throw new Error(`Duplicate imported content path: "${sourceFile.path}"`);
        }
        if (directoryKeys.has(pathKey)) {
            throw new Error(`Imported content contains a path collision: "${sourceFile.path}"`);
        }
        const segments = normalizedPath.split("/");
        for (let index = 1; index < segments.length; index++) {
            const ancestorKey = gamePathKey(segments.slice(0, index).join("/"));
            if (fileKeys.has(ancestorKey)) {
                throw new Error(`Imported content contains a file/directory collision: "${sourceFile.path}"`);
            }
            directoryKeys.add(ancestorKey);
        }
        fileKeys.add(pathKey);
        files.push({
            sourcePath: sourceFile.path,
            normalizedPath,
            size: sourceFile.size,
        });
    }
    if (!files.length) {
        throw new Error("The selected content contains no readable files");
    }
    return files;
}

function expectedDirectoryPaths(files: readonly ImportedFile[]): Set<string> {
    const directories = new Set<string>([""]);
    for (const file of files) {
        const segments = file.normalizedPath.split("/");
        for (let index = 1; index < segments.length; index++) {
            directories.add(segments.slice(0, index).join("/"));
        }
    }
    return directories;
}

function createExpectedContent(
    contentId: string,
    source: ImportedContentSource,
    files: readonly ImportedFile[],
    metadataInput?: InstalledContentImportMetadataInput,
): ExpectedContent {
    const sourceWithMetadata = source;
    const suppliedMetadata = metadataInput
        ? { ...sourceWithMetadata.metadata, ...metadataInput }
        : sourceWithMetadata.metadata;
    const suppliedRuntimeProfile = suppliedMetadata?.runtimeProfile ?? suppliedMetadata?.profile ??
        suppliedMetadata?.profileId ?? sourceWithMetadata.runtimeProfile ?? sourceWithMetadata.profile ??
        sourceWithMetadata.profileId;
    if (suppliedRuntimeProfile !== undefined && !isGameProfileId(suppliedRuntimeProfile)) {
        throw new Error("Imported content metadata contains an invalid runtime profile");
    }
    const detectedProfile = detectContentProfile(files.map((file) => file.normalizedPath));
    if (!isGameProfileId(detectedProfile)) {
        throw new Error("Imported content profile detection returned an invalid profile");
    }
    const runtimeProfile = suppliedRuntimeProfile ?? detectedProfile;
    const isMentalOmega = runtimeProfile === "mental-omega";
    const suppliedBaseProfile = suppliedMetadata?.baseProfile ?? sourceWithMetadata.baseProfile;
    const baseProfile: "ra2" | "yr" = isMentalOmega || runtimeProfile === "yr"
        ? "yr"
        : suppliedBaseProfile === "yr" ? "yr" : "ra2";
    const extensions = suppliedMetadata?.extensions ?? sourceWithMetadata.extensions ??
        (isMentalOmega ? ["ares"] : []);
    const metadata = createInstalledContentMetadata({
        id: contentId,
        name: source.name ?? contentId,
        version: suppliedMetadata?.version ?? sourceWithMetadata.version ?? "imported",
        sourceName: source.name,
        sourceKind: source.kind,
        baseProfile,
        runtimeProfile,
        extensions: [...extensions],
    });
    const directoryPaths = expectedDirectoryPaths(files);
    return {
        id: contentId,
        files: new Map(files.map((file) => [gamePathKey(file.normalizedPath), file])),
        directories: new Set([...directoryPaths].map((path) => path ? gamePathKey(path) : "")),
        directoryPaths,
        metadata,
        runtimeProfile,
        baseProfile,
        extensions,
    };
}

async function snapshotDirectory(root: FileSystemDirectoryHandle): Promise<DirectorySnapshot> {
    const files = new Map<string, SnapshotFile>();
    const directories = new Set<string>([""]);
    const visit = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
        const entries = await directoryEntries(directory);
        entries.sort(([left], [right]) => compareText(left, right));
        for (const [name, handle] of entries) {
            const path = normalizeGamePath(prefix ? `${prefix}/${name}` : name);
            if (files.has(path) || directories.has(path)) {
                throw new Error(`Content directory contains a duplicate path: "${path}"`);
            }
            if (handle.kind === "directory") {
                directories.add(path);
                await visit(handle as FileSystemDirectoryHandle, path);
            }
            else if (handle.kind === "file") {
                files.set(path, { path, handle: handle as FileSystemFileHandle });
            }
            else {
                throw new Error(`Content directory contains an unsupported entry: "${path}"`);
            }
        }
    };
    await visit(root, "");
    return { files, directories };
}

async function directoryAndFileName(
    root: FileSystemDirectoryHandle,
    path: string,
    create: boolean,
): Promise<{ directory: FileSystemDirectoryHandle; fileName: string }> {
    const segments = path.split("/");
    const fileName = segments.pop();
    if (!fileName) {
        throw new Error(`Content path has no filename: "${path}"`);
    }
    let directory = root;
    for (const segment of segments) {
        directory = await directory.getDirectoryHandle(segment, { create });
    }
    return { directory, fileName };
}

async function abortWritable(writable: FileSystemWritableFileStream, reason: unknown): Promise<void> {
    try {
        await writable.abort(reason);
    }
    catch {
    }
}

async function writeFileContents(file: FileSystemFileHandle, contents: string | Uint8Array): Promise<void> {
    const writable = await file.createWritable();
    let closed = false;
    try {
        await writable.write(contents as unknown as FileSystemWriteChunkType);
        await writable.close();
        closed = true;
    }
    catch (error) {
        if (!closed) {
            await abortWritable(writable, error);
        }
        throw error;
    }
}

async function writeReadableToFile(file: FileSystemFileHandle, stream: ReadableStream<Uint8Array>): Promise<void> {
    const writable = await file.createWritable();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let closed = false;
    try {
        reader = stream.getReader();
        while (true) {
            const result = await reader.read();
            if (result.done) {
                break;
            }
            if (result.value.byteLength) {
                await writable.write(result.value as unknown as FileSystemWriteChunkType);
            }
        }
        await writable.close();
        closed = true;
    }
    catch (error) {
        if (reader) {
            try {
                await reader.cancel(error);
            }
            catch {
            }
        }
        if (!closed) {
            await abortWritable(writable, error);
        }
        throw error;
    }
    finally {
        if (reader) {
            try {
                reader.releaseLock();
            }
            catch {
            }
        }
    }
}

interface FileStreamSource {
    stream?: () => ReadableStream<Uint8Array>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    text?: () => Promise<string>;
}

async function readableFileStream(file: File): Promise<ReadableStream<Uint8Array>> {
    const source = file as unknown as FileStreamSource;
    if (typeof source.stream === "function") {
        return source.stream();
    }
    if (typeof source.arrayBuffer === "function") {
        return new ReadableStream<Uint8Array>({
            start: async (controller) => {
                try {
                    controller.enqueue(new Uint8Array(await source.arrayBuffer!()));
                    controller.close();
                }
                catch (error) {
                    controller.error(error);
                }
            },
        });
    }
    if (typeof source.text === "function") {
        return new ReadableStream<Uint8Array>({
            start: async (controller) => {
                try {
                    controller.enqueue(new TextEncoder().encode(await source.text!()));
                    controller.close();
                }
                catch (error) {
                    controller.error(error);
                }
            },
        });
    }
    throw new Error("Content file does not provide a readable stream");
}

function parseMetadata(value: string): Partial<InstalledContentMetadata> | undefined {
    try {
        const parsed = JSON.parse(value) as Partial<InstalledContentMetadata>;
        if (typeof parsed !== "object" || parsed === null) {
            return undefined;
        }
        return parsed;
    }
    catch {
        return undefined;
    }
}

function importMarkerValue(id: string, sourceName?: string): string {
    return JSON.stringify({
        schemaVersion: 1,
        kind: "staging",
        id,
        sourceName,
    });
}

function validateMetadata(metadata: Partial<InstalledContentMetadata>, expected: ExpectedContent): void {
    const extensions = metadata.extensions;
    if (metadata.schemaVersion !== INSTALLED_CONTENT_METADATA_VERSION ||
        metadata.id !== expected.id ||
        metadata.name !== expected.metadata.name ||
        metadata.version !== expected.metadata.version ||
        metadata.sourceKind !== expected.metadata.sourceKind ||
        metadata.sourceName !== expected.metadata.sourceName ||
        metadata.baseProfile !== expected.baseProfile ||
        metadata.runtimeProfile !== expected.runtimeProfile ||
        !Array.isArray(extensions) ||
        extensions.length !== expected.extensions.length ||
        extensions.some((extension, index) => extension !== expected.extensions[index]) ||
        typeof metadata.importedAt !== "string" ||
        !Number.isFinite(Date.parse(metadata.importedAt))) {
        throw new Error("Staged content metadata is invalid");
    }
}

async function validateDirectory(
    directory: FileSystemDirectoryHandle,
    expected: ExpectedContent,
    options: ValidationOptions,
): Promise<void> {
    const snapshot = await snapshotDirectory(directory);
    const actualKeys = new Set<string>();
    for (const file of snapshot.files.values()) {
        if (file.path === CONTENT_IMPORT_IN_PROGRESS_FILE || file.path === INSTALLED_CONTENT_METADATA_FILE) {
            continue;
        }
        const key = gamePathKey(file.path);
        if (actualKeys.has(key)) {
            throw new Error(`Staged content contains duplicate normalized path: "${file.path}"`);
        }
        actualKeys.add(key);
        const expectedFile = expected.files.get(key);
        if (!expectedFile) {
            if (!options.allowUnexpected) {
                throw new Error(`Staged content contains an unexpected path: "${file.path}"`);
            }
            continue;
        }
        const actual = await file.handle.getFile();
        if (expectedFile.size > 0 && actual.size !== expectedFile.size) {
            throw new Error(`Staged content has an incomplete file: "${file.path}"`);
        }
    }
    for (const key of expected.files.keys()) {
        if (!actualKeys.has(key)) {
            throw new Error(`Staged content is missing an expected path: "${key}"`);
        }
    }
    if (!options.allowUnexpected) {
        for (const path of snapshot.directories) {
            if (path && !expected.directories.has(gamePathKey(path))) {
                throw new Error(`Staged content contains an unexpected directory: "${path}"`);
            }
        }
    }
    const metadataFile = snapshot.files.get(INSTALLED_CONTENT_METADATA_FILE);
    if (!metadataFile) {
        throw new Error("Staged content is missing its metadata");
    }
    const metadata = parseMetadata(await (await metadataFile.handle.getFile()).text());
    if (!metadata) {
        throw new Error("Staged content metadata could not be parsed");
    }
    validateMetadata(metadata, expected);
    const markerFile = snapshot.files.get(CONTENT_IMPORT_IN_PROGRESS_FILE);
    if (options.marker === "required") {
        if (!markerFile) {
            throw new Error("Staged content is missing its import marker");
        }
        const marker = parseMetadata(await (await markerFile.handle.getFile()).text());
        if (marker?.id !== expected.id || marker?.schemaVersion !== 1) {
            throw new Error("Staged content import marker is invalid");
        }
    }
    else if (markerFile) {
        throw new Error("Committed content still has an import marker");
    }
}

function copyOrder(path: string): number {
    if (path === CONTENT_IMPORT_IN_PROGRESS_FILE) {
        return 0;
    }
    if (path === INSTALLED_CONTENT_METADATA_FILE) {
        return 2;
    }
    return 1;
}

async function copyDirectoryContents(
    source: FileSystemDirectoryHandle,
    destination: FileSystemDirectoryHandle,
): Promise<void> {
    const snapshot = await snapshotDirectory(source);
    const directories = [...snapshot.directories]
        .filter((path) => !!path)
        .sort((left, right) => pathDepth(left) - pathDepth(right) || compareText(left, right));
    for (const path of directories) {
        await directoryAndFileName(destination, `${path}/placeholder`, true);
    }
    const files = [...snapshot.files.values()].sort((left, right) =>
        copyOrder(left.path) - copyOrder(right.path) || compareText(left.path, right.path));
    for (const file of files) {
        const destinationPath = await directoryAndFileName(destination, file.path, true);
        const destinationFile = await destinationPath.directory.getFileHandle(destinationPath.fileName, { create: true });
        const sourceFile = await file.handle.getFile();
        await writeReadableToFile(destinationFile, await readableFileStream(sourceFile));
    }
}

async function filesEqual(
    left: FileSystemFileHandle,
    right: FileSystemFileHandle,
): Promise<boolean> {
    const leftFile = await left.getFile();
    const rightFile = await right.getFile();
    if (leftFile.size !== rightFile.size) {
        return false;
    }
    const leftReader = (await readableFileStream(leftFile)).getReader();
    const rightReader = (await readableFileStream(rightFile)).getReader();
    let leftComplete = false;
    let rightComplete = false;
    try {
        while (true) {
            const [leftResult, rightResult] = await Promise.all([
                leftReader.read(),
                rightReader.read(),
            ]);
            if (leftResult.done || rightResult.done) {
                leftComplete = leftResult.done;
                rightComplete = rightResult.done;
                return leftComplete && rightComplete;
            }
            if (leftResult.value.byteLength !== rightResult.value.byteLength) {
                return false;
            }
            for (let index = 0; index < leftResult.value.byteLength; index++) {
                if (leftResult.value[index] !== rightResult.value[index]) {
                    return false;
                }
            }
        }
    }
    finally {
        if (!leftComplete) {
            try {
                await leftReader.cancel();
            }
            catch {
            }
        }
        if (!rightComplete) {
            try {
                await rightReader.cancel();
            }
            catch {
            }
        }
        try {
            leftReader.releaseLock();
        }
        catch {
        }
        try {
            rightReader.releaseLock();
        }
        catch {
        }
    }
}

async function directoriesEqual(
    left: FileSystemDirectoryHandle,
    right: FileSystemDirectoryHandle,
): Promise<boolean> {
    const leftSnapshot = await snapshotDirectory(left);
    const rightSnapshot = await snapshotDirectory(right);
    if (leftSnapshot.directories.size !== rightSnapshot.directories.size) {
        return false;
    }
    for (const path of leftSnapshot.directories) {
        if (!rightSnapshot.directories.has(path)) {
            return false;
        }
    }
    if (leftSnapshot.files.size !== rightSnapshot.files.size) {
        return false;
    }
    for (const [path, leftFile] of leftSnapshot.files) {
        const rightFile = rightSnapshot.files.get(path);
        if (!rightFile || !await filesEqual(leftFile.handle, rightFile.handle)) {
            return false;
        }
    }
    return true;
}

async function removeObsoleteEntries(
    directory: FileSystemDirectoryHandle,
    expected: ExpectedContent,
): Promise<void> {
    let snapshot = await snapshotDirectory(directory);
    const obsoleteDirectories = [...snapshot.directories]
        .filter((path) => path && !expected.directoryPaths.has(path))
        .sort((left, right) => pathDepth(right) - pathDepth(left) || compareText(right, left));
    for (const path of obsoleteDirectories) {
        const location = await directoryAndFileName(directory, path, false);
        if (!await removeEntry(location.directory, location.fileName)) {
            throw new Error(`Could not remove obsolete content directory: "${path}"`);
        }
    }
    snapshot = await snapshotDirectory(directory);
    const obsoleteFiles = [...snapshot.files.values()]
        .filter((file) => file.path !== CONTENT_IMPORT_IN_PROGRESS_FILE && file.path !== INSTALLED_CONTENT_METADATA_FILE)
        .filter((file) => {
            const expectedFile = expected.files.get(gamePathKey(file.path));
            return !expectedFile || expectedFile.normalizedPath !== file.path;
        })
        .sort((left, right) => pathDepth(right.path) - pathDepth(left.path) || compareText(right.path, left.path));
    for (const file of obsoleteFiles) {
        const location = await directoryAndFileName(directory, file.path, false);
        if (!await removeEntry(location.directory, location.fileName)) {
            throw new Error(`Could not remove obsolete content file: "${file.path}"`);
        }
    }
}

async function cleanupCommittedDirectory(
    directory: FileSystemDirectoryHandle,
    expected: ExpectedContent,
): Promise<void> {
    await validateDirectory(directory, expected, { allowUnexpected: true, marker: "required" });
    await removeObsoleteEntries(directory, expected);
    if (!await removeEntry(directory, CONTENT_IMPORT_IN_PROGRESS_FILE)) {
        throw new Error("Could not remove the content import marker");
    }
    await validateDirectory(directory, expected, { allowUnexpected: false, marker: "absent" });
}

async function createBackup(
    modsDirectory: FileSystemDirectoryHandle,
    targetName: string,
    backupName: string,
): Promise<FileSystemDirectoryHandle> {
    const source = await findDirectory(modsDirectory, targetName);
    if (!source) {
        throw new Error(`Installed content directory disappeared: "${targetName}"`);
    }
    const backup = await modsDirectory.getDirectoryHandle(backupName, { create: true });
    try {
        await copyDirectoryContents(source, backup);
        if (!await directoriesEqual(source, backup)) {
            throw new Error(`Installed content backup is incomplete: "${targetName}"`);
        }
        return backup;
    }
    catch (error) {
        try {
            await removeEntry(modsDirectory, backupName);
        }
        catch {
        }
        throw error;
    }
}

function moveFunction(handle: FileSystemDirectoryHandle): ((destination: FileSystemDirectoryHandle, name?: string) => Promise<unknown>) | undefined {
    const move = (handle as DirectoryMoveHandle).move;
    return typeof move === "function" ? move.bind(handle) : undefined;
}

async function moveDirectory(
    handle: FileSystemDirectoryHandle,
    destinationParent: FileSystemDirectoryHandle,
    destinationName: string,
    sourceName: string,
): Promise<void> {
    const move = moveFunction(handle);
    if (!move) {
        throw new MoveUnavailableError();
    }
    try {
        await move(destinationParent, destinationName);
    }
    catch (error) {
        const source = await findDirectory(destinationParent, sourceName);
        const destination = await findDirectory(destinationParent, destinationName);
        if (!source && destination) {
            return;
        }
        throw error;
    }
    const source = await findDirectory(destinationParent, sourceName);
    const destination = await findDirectory(destinationParent, destinationName);
    if (source || !destination) {
        throw new Error(`Content directory move did not complete: "${sourceName}"`);
    }
}

async function cleanupStagingOnly(
    modsDirectory: FileSystemDirectoryHandle,
    stagingName: string,
): Promise<void> {
    if (!isContentImportStagingName(stagingName)) {
        throw new Error(`Refusing to clean a non-staging content directory: "${stagingName}"`);
    }
    await removeEntry(modsDirectory, stagingName);
}

async function rollbackMovedDirectory(
    modsDirectory: FileSystemDirectoryHandle,
    targetName: string,
    backupName: string,
    stagingName: string,
): Promise<void> {
    const backup = await findDirectory(modsDirectory, backupName);
    if (!backup) {
        throw new Error(`Content rollback backup is missing: "${backupName}"`);
    }
    const target = await findDirectory(modsDirectory, targetName);
    if (target) {
        if (!await removeEntry(modsDirectory, targetName)) {
            throw new Error(`Could not remove partial content directory: "${targetName}"`);
        }
    }
    try {
        await moveDirectory(backup, modsDirectory, targetName, backupName);
    }
    catch (error) {
        throw new Error(`Content rollback could not restore the prior installation: ${errorMessage(error)}`, { cause: error });
    }
    try {
        await cleanupStagingOnly(modsDirectory, stagingName);
    }
    catch {
    }
}

async function rollbackCopiedDirectory(
    modsDirectory: FileSystemDirectoryHandle,
    targetName: string,
    backupName: string,
): Promise<void> {
    const backup = await findDirectory(modsDirectory, backupName);
    if (!backup) {
        throw new Error(`Content rollback backup is missing: "${backupName}"`);
    }
    const target = await findDirectory(modsDirectory, targetName);
    if (target && !await removeEntry(modsDirectory, targetName)) {
        throw new Error(`Could not remove partial content directory: "${targetName}"`);
    }
    const restored = await modsDirectory.getDirectoryHandle(targetName, { create: true });
    const backupSnapshot = await snapshotDirectory(backup);
    const backupHasMarker = backupSnapshot.files.has(CONTENT_IMPORT_IN_PROGRESS_FILE);
    try {
        await writeFileContents(
            await restored.getFileHandle(CONTENT_IMPORT_IN_PROGRESS_FILE, { create: true }),
            importMarkerValue(targetName),
        );
        await copyDirectoryContents(backup, restored);
        if (!backupHasMarker && !await removeEntry(restored, CONTENT_IMPORT_IN_PROGRESS_FILE)) {
            throw new Error("Could not remove the rollback marker");
        }
        if (!await directoriesEqual(backup, restored)) {
            throw new Error("Content rollback copy is incomplete");
        }
        try {
            await removeEntry(modsDirectory, backupName);
        }
        catch {
        }
    }
    catch (error) {
        throw new Error(`Content rollback could not restore the prior installation: ${errorMessage(error)}`, { cause: error });
    }
}

async function cleanupFailedTarget(
    modsDirectory: FileSystemDirectoryHandle,
    targetName: string,
): Promise<void> {
    const target = await findDirectory(modsDirectory, targetName);
    if (!target) {
        return;
    }
    try {
        await writeFileContents(
            await target.getFileHandle(CONTENT_IMPORT_IN_PROGRESS_FILE, { create: true }),
            importMarkerValue(targetName),
        );
    }
    catch {
    }
    try {
        await removeEntry(modsDirectory, targetName);
    }
    catch (error) {
        throw new Error(`Could not clean failed content directory: ${errorMessage(error)}`, { cause: error });
    }
}

async function commitWithMove(
    modsDirectory: FileSystemDirectoryHandle,
    contentId: string,
    stagingName: string,
    stagingDirectory: FileSystemDirectoryHandle,
    expected: ExpectedContent,
): Promise<void> {
    const existing = await findDirectory(modsDirectory, contentId);
    if (!existing) {
        let newMoved = false;
        try {
            await moveDirectory(stagingDirectory, modsDirectory, contentId, stagingName);
            newMoved = true;
            const target = await findDirectory(modsDirectory, contentId);
            if (!target) {
                throw new Error("Committed content directory is missing");
            }
            await cleanupCommittedDirectory(target, expected);
        }
        catch (error) {
            if (newMoved) {
                try {
                    await cleanupFailedTarget(modsDirectory, contentId);
                }
                catch (cleanupError) {
                    throw new Error(`Content replacement failed and cleanup is fail-closed: ${errorMessage(cleanupError)}`, {
                        cause: error,
                    });
                }
            }
            throw error;
        }
        return;
    }
    const backupName = await createUniqueTransactionName(
        modsDirectory,
        CONTENT_IMPORT_BACKUP_PREFIX,
        contentId,
    );
    let oldMoved = false;
    let backupVerified = false;
    try {
        await moveDirectory(existing, modsDirectory, backupName, contentId);
        oldMoved = true;
        const backup = await findDirectory(modsDirectory, backupName);
        if (!backup || !await directoriesEqual(existing, backup)) {
            throw new Error("Installed content backup is incomplete");
        }
        backupVerified = true;
        await moveDirectory(stagingDirectory, modsDirectory, contentId, stagingName);
        const target = await findDirectory(modsDirectory, contentId);
        if (!target) {
            throw new Error("Committed content directory is missing");
        }
        await cleanupCommittedDirectory(target, expected);
    }
    catch (error) {
        if (oldMoved && !backupVerified) {
            throw new Error("Content replacement failed and the prior installation backup could not be validated", {
                cause: error,
            });
        }
        if (oldMoved) {
            try {
                await rollbackMovedDirectory(modsDirectory, contentId, backupName, stagingName);
            }
            catch (rollbackError) {
                throw new Error(`Content replacement failed and rollback is fail-closed: ${errorMessage(rollbackError)}`, {
                    cause: error,
                });
            }
        }
        throw error;
    }
    try {
        await removeEntry(modsDirectory, backupName);
    }
    catch {
    }
}

async function commitWithCopy(
    modsDirectory: FileSystemDirectoryHandle,
    contentId: string,
    stagingName: string,
    stagingDirectory: FileSystemDirectoryHandle,
    expected: ExpectedContent,
): Promise<void> {
    const existing = await findDirectory(modsDirectory, contentId);
    const backupName = existing
        ? await createUniqueTransactionName(modsDirectory, CONTENT_IMPORT_BACKUP_PREFIX, contentId)
        : undefined;
    if (existing && backupName) {
        await createBackup(modsDirectory, contentId, backupName);
    }
    try {
        const target = existing ?? await modsDirectory.getDirectoryHandle(contentId, { create: true });
        await writeFileContents(
            await target.getFileHandle(CONTENT_IMPORT_IN_PROGRESS_FILE, { create: true }),
            importMarkerValue(contentId, expected.metadata.sourceName ?? expected.metadata.name),
        );
        await copyDirectoryContents(stagingDirectory, target);
        await cleanupCommittedDirectory(target, expected);
    }
    catch (error) {
        let rollbackError: unknown;
        try {
            if (backupName) {
                await rollbackCopiedDirectory(modsDirectory, contentId, backupName);
            }
            else {
                await cleanupFailedTarget(modsDirectory, contentId);
            }
        }
        catch (failure) {
            rollbackError = failure;
        }
        if (rollbackError) {
            throw new Error(`Content replacement failed and rollback is fail-closed: ${errorMessage(rollbackError)}`, {
                cause: error,
            });
        }
        throw error;
    }
    try {
        await removeEntry(modsDirectory, stagingName);
    }
    catch {
    }
    if (backupName) {
        try {
            await removeEntry(modsDirectory, backupName);
        }
        catch {
        }
    }
}

function importResult(expected: ExpectedContent, source: ContentImportSource): InstalledContentImportResult {
    return {
        id: expected.id,
        name: expected.metadata.name,
        version: expected.metadata.version ?? "imported",
        sourceKind: source.kind,
        baseProfile: expected.baseProfile,
        runtimeProfile: expected.runtimeProfile,
        extensions: expected.extensions,
    };
}

export async function importContentSourceToOpfs(
    source: ImportedContentSource,
    requestedId?: string,
    onProgress?: (text: string) => void,
    options?: InstalledContentImportOptions,
): Promise<InstalledContentImportResult> {
    if (typeof navigator.storage?.getDirectory !== "function") {
        throw new Error("Persistent content storage is unavailable");
    }
    const root = await navigator.storage.getDirectory();
    const modsDirectory = await root.getDirectoryHandle("mods", { create: true });
    await cleanupStaleStagingEntries(modsDirectory);
    const existingIds: string[] = [];
    for (const [entry] of await directoryEntries(modsDirectory)) {
        if (!isContentImportTransactionName(entry)) {
            existingIds.push(entry);
        }
    }
    let contentId = allocateContentId(requestedId ?? source.name, existingIds, {
        reuseExisting: requestedId !== undefined,
    });
    if (requestedId === undefined && source.name) {
        const candidateKey = gamePathKey(normalizeContentId(source.name));
        const existingCandidate = existingIds.find((id) => gamePathKey(id) === candidateKey);
        if (existingCandidate) {
            try {
                const existingDirectory = await findDirectory(modsDirectory, existingCandidate);
                if (existingDirectory) {
                    const metadataFile = await findFile(existingDirectory, INSTALLED_CONTENT_METADATA_FILE);
                    const existingMetadata = metadataFile
                        ? parseMetadata(await (await metadataFile.getFile()).text())
                        : undefined;
                    if (existingMetadata && typeof existingMetadata.sourceName === "string" &&
                        normalizeContentId(existingMetadata.sourceName) === normalizeContentId(source.name)) {
                        contentId = existingCandidate;
                    }
                }
            }
            catch {
            }
        }
    }
    const files = prepareImportedFiles(source);
    const stagingName = await createUniqueTransactionName(
        modsDirectory,
        CONTENT_IMPORT_STAGING_PREFIX,
        contentId,
    );
    const stagingDirectory = await modsDirectory.getDirectoryHandle(stagingName, { create: true });
    try {
        await writeFileContents(
            await stagingDirectory.getFileHandle(CONTENT_IMPORT_IN_PROGRESS_FILE, { create: true }),
            importMarkerValue(contentId, source.name ?? contentId),
        );
        const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
        let copiedBytes = 0;
        for (const file of files) {
            const location = await directoryAndFileName(stagingDirectory, file.normalizedPath, true);
            const targetFile = await location.directory.getFileHandle(location.fileName, { create: true });
            const stream = await source.readFile(file.normalizedPath);
            await writeReadableToFile(targetFile, stream);
            copiedBytes += file.size;
            onProgress?.(`Importing content... ${(copiedBytes / 1048576).toFixed(0)} / ${(totalBytes / 1048576).toFixed(0)} MB`);
        }
        const expected = createExpectedContent(contentId, source, files, options?.metadata);
        const metadataFile = await stagingDirectory.getFileHandle(INSTALLED_CONTENT_METADATA_FILE, { create: true });
        await writeFileContents(metadataFile, JSON.stringify(expected.metadata, null, 2));
        await validateDirectory(stagingDirectory, expected, { allowUnexpected: false, marker: "required" });
        try {
            if (moveFunction(stagingDirectory)) {
                await commitWithMove(
                    modsDirectory,
                    contentId,
                    stagingName,
                    stagingDirectory,
                    expected,
                );
            }
            else {
                await commitWithCopy(
                    modsDirectory,
                    contentId,
                    stagingName,
                    stagingDirectory,
                    expected,
                );
            }
        }
        catch (error) {
            if (error instanceof MoveUnavailableError) {
                await commitWithCopy(
                    modsDirectory,
                    contentId,
                    stagingName,
                    stagingDirectory,
                    expected,
                );
            }
            else {
                throw error;
            }
        }
        return importResult(expected, source);
    }
    catch (error) {
        try {
            await cleanupStagingOnly(modsDirectory, stagingName);
        }
        catch (cleanupError) {
            throw new Error(`Content import failed and staging cleanup is fail-closed: ${errorMessage(cleanupError)}`, {
                cause: error,
            });
        }
        throw error;
    }
}
