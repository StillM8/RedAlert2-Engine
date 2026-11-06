import sevenZipFactory from "7z-wasm";
import { gamePathKey, gamePathLeaf, normalizeGamePath } from "@/engine/GamePath";
import { ArchiveExtractionError } from "@/engine/gameRes/importError/ArchiveExtractionError";
import { InvalidArchiveError } from "@/engine/gameRes/importError/InvalidArchiveError";
import type {
    ContentImportFile,
    ContentImportProgress,
    ContentImportSource,
} from "@/content/PlatformContentProvider";

const SUPPORTED_ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar"]);
const SUPPORTED_ARCHIVE_TYPES = /^(?:zip|7z|rar\d*)$/i;

export interface ArchiveWasmNode {
    mode?: number;
    contents?: Record<string, ArchiveWasmNode> | Uint8Array;
}

export interface ArchiveWasmFileSystem {
    chdir(path: string): void;
    cwd(): string;
    mkdir(path: string, mode?: number): unknown;
    chmod?(path: string, mode: number, dontFollow?: boolean): void;
    unlink(path: string): void;
    rmdir?(path: string): void;
    open(path: string, flags: string): number;
    read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
    write(fd: number, buffer: Uint8Array, offset: number, length: number, position: number, canOwn?: boolean): number;
    close(fd: number): void;
    stat(path: string): { size: number };
    lookupPath(path: string, options?: { follow?: boolean }): { node: ArchiveWasmNode };
    isDir?(mode: number): boolean;
    isFile?(mode: number): boolean;
    isLink?(mode: number): boolean;
}

export interface ArchiveWasmModule {
    FS: ArchiveWasmFileSystem;
    callMain(args: string[]): unknown;
    dispose?(): void;
    terminate?(): void;
}

export interface ArchiveModuleFactoryOptions {
    locateFile(path: string): string;
    print(line: string): void;
    printErr(line: string): void;
    quit(code: number, status?: unknown): void;
    wasmBinary?: ArrayBuffer;
}

export type ArchiveModuleFactory = (options: ArchiveModuleFactoryOptions) => Promise<ArchiveWasmModule>;

export interface ArchiveExtractionOptions {
    createModule?: ArchiveModuleFactory;
    wasmPath?: string;
    wasmBinary?: ArrayBuffer;
}

export interface ArchiveListingEntry {
    rawPath: string;
    path: string;
    directory: boolean;
    type?: string;
}

export interface ParsedArchiveListing {
    entries: ArchiveListingEntry[];
    type?: string;
}

interface ArchiveInputFile extends ContentImportFile {
    normalizedPath: string;
    key: string;
}

interface InMemoryContentFile {
    path: string;
    data: Uint8Array;
    archivePath: string;
}

interface ActualArchiveFile {
    path: string;
    key: string;
    fsPath: string;
}

interface MergedArchiveContent {
    files: Map<string, InMemoryContentFile>;
    directories: Map<string, string>;
}

interface ArchiveCommandResult {
    exitCode: number;
    output: string;
    errors: string;
    status?: unknown;
    thrown?: unknown;
}

interface ArchiveSession {
    module: ArchiveWasmModule;
    temporaryRoots: Set<string>;
    run(args: string[]): ArchiveCommandResult;
    dispose(): void;
}

const defaultArchiveModuleFactory = sevenZipFactory as unknown as ArchiveModuleFactory;

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function ancestorKeys(path: string): string[] {
    const parts = normalizeGamePath(path).split("/");
    const result: string[] = [];
    for (let index = 1; index < parts.length; index++) {
        result.push(gamePathKey(parts.slice(0, index).join("/")));
    }
    return result;
}

function report(onProgress: ContentImportProgress | undefined, text: string): void {
    onProgress?.(text);
}

function archiveError(message: string, cause?: unknown): ArchiveExtractionError {
    return new ArchiveExtractionError(message, cause === undefined ? undefined : { cause });
}

function invalidArchive(message: string, cause?: unknown): InvalidArchiveError {
    return new InvalidArchiveError(message, cause === undefined ? undefined : { cause });
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function archiveExtension(path: string): string {
    const leaf = gamePathLeaf(path);
    const dot = leaf.lastIndexOf(".");
    return dot < 0 ? "" : leaf.slice(dot).toLocaleLowerCase("en-US");
}

function archiveTypeIsSupported(type: string | undefined): boolean {
    return !type || SUPPORTED_ARCHIVE_TYPES.test(type.trim());
}

function validateArchiveInputs(source: ContentImportSource): ArchiveInputFile[] {
    if (source.kind !== "archives") {
        throw invalidArchive("The selected content is not an archive source");
    }
    if (!source.files.length) {
        throw invalidArchive("The selected archive source contains no files");
    }
    const seen = new Map<string, ArchiveInputFile>();
    const result: ArchiveInputFile[] = [];
    const orderedFiles = [...source.files].sort((left, right) =>
        compareText(left.path.toLocaleLowerCase("en-US"), right.path.toLocaleLowerCase("en-US")) ||
        compareText(left.path, right.path));
    for (const file of orderedFiles) {
        let normalizedPath: string;
        try {
            normalizedPath = normalizeGamePath(file.path);
        }
        catch (error) {
            throw invalidArchive(`Unsafe archive path "${file.path}"`, error);
        }
        const key = gamePathKey(normalizedPath);
        const previous = seen.get(key);
        if (previous) {
            throw invalidArchive(`Duplicate archive path "${file.path}" and "${previous.path}"`);
        }
        if (!Number.isSafeInteger(file.size) || file.size < 0) {
            throw invalidArchive(`Archive has an invalid size: "${file.path}"`);
        }
        if (!SUPPORTED_ARCHIVE_EXTENSIONS.has(archiveExtension(normalizedPath))) {
            throw invalidArchive(`Unsupported archive format: "${file.path}"`);
        }
        const input: ArchiveInputFile = {
            path: file.path,
            normalizedPath,
            key,
            size: file.size,
        };
        seen.set(key, input);
        result.push(input);
    }
    return result.sort((left, right) => compareText(left.key, right.key) || compareText(left.normalizedPath, right.normalizedPath));
}

function statusMessage(status: unknown): string | undefined {
    if (!status || typeof status !== "object") {
        return undefined;
    }
    const message = (status as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
}

function commandCause(result: ArchiveCommandResult): Error {
    const details = [
        statusMessage(result.status),
        result.errors,
        result.thrown === undefined ? undefined : errorMessage(result.thrown),
        result.exitCode === 0 ? undefined : `7-Zip exited with code ${result.exitCode}`,
    ].filter((value): value is string => !!value).join("\n").trim();
    return new Error(details || "7-Zip command failed");
}

function makeArchiveDirectoriesWritable(fs: ArchiveWasmFileSystem): void {
    const chmod = fs.chmod;
    if (chmod) {
        fs.chmod = function(this: ArchiveWasmFileSystem, path: string, mode: number, dontFollow?: boolean): void {
            return chmod.call(this, path, mode | 0o700, dontFollow);
        };
    }
    const mkdir = fs.mkdir;
    fs.mkdir = function(this: ArchiveWasmFileSystem, path: string, mode = 0o777): unknown {
        return mkdir.call(this, path, mode | 0o700);
    };
}

function isDirectoryNode(fs: ArchiveWasmFileSystem, node: ArchiveWasmNode): boolean {
    if (node.mode !== undefined && fs.isDir) {
        return fs.isDir(node.mode);
    }
    const contents = node.contents;
    return !!contents && typeof contents === "object" && !ArrayBuffer.isView(contents) && !(contents instanceof ArrayBuffer);
}

function removeTree(fs: ArchiveWasmFileSystem, path: string): void {
    let node: ArchiveWasmNode;
    try {
        node = fs.lookupPath(path, { follow: false }).node;
    }
    catch {
        try {
            fs.unlink(path);
        }
        catch {
        }
        return;
    }
    if (isDirectoryNode(fs, node)) {
        const contents = node.contents;
        if (contents && !(contents instanceof Uint8Array)) {
            for (const name of Object.keys(contents)) {
                if (name !== "." && name !== "..") {
                    removeTree(fs, `${path}/${name}`);
                }
            }
        }
        try {
            fs.rmdir?.(path);
        }
        catch {
        }
        return;
    }
    try {
        fs.unlink(path);
    }
    catch {
    }
}

function disposeSession(session: ArchiveSession): void {
    try {
        session.module.FS.chdir("/");
    }
    catch {
    }
    try {
        session.dispose();
    }
    catch {
    }
    try {
        session.module.dispose?.();
    }
    catch {
    }
    try {
        session.module.terminate?.();
    }
    catch {
    }
}

async function createArchiveSession(options: ArchiveExtractionOptions): Promise<ArchiveSession> {
    let output: string[] = [];
    let errors: string[] = [];
    let exitCode: number | undefined;
    let exitStatus: unknown;
    const factoryOptions: ArchiveModuleFactoryOptions = {
        locateFile: (path) => path === "7zz.wasm" ? options.wasmPath ?? "/7zz.wasm" : path,
        print: (line) => output.push(String(line)),
        printErr: (line) => errors.push(String(line)),
        quit: (code, status) => {
            exitCode = typeof code === "number" ? code : 0;
            exitStatus = status;
        },
    };
    if (options.wasmBinary !== undefined) {
        factoryOptions.wasmBinary = options.wasmBinary;
    }
    let module: ArchiveWasmModule;
    try {
        module = await (options.createModule ?? defaultArchiveModuleFactory)(factoryOptions);
        makeArchiveDirectoriesWritable(module.FS);
    }
    catch (error) {
        throw archiveError("Could not initialize the archive extractor", error);
    }
    const run = (args: string[]): ArchiveCommandResult => {
        output = [];
        errors = [];
        exitCode = undefined;
        exitStatus = undefined;
        let thrown: unknown;
        let returned: unknown;
        try {
            returned = module.callMain(args);
            if (typeof returned === "number") {
                exitCode = returned;
            }
        }
        catch (error) {
            thrown = error;
        }
        const thrownStatus = thrown && typeof thrown === "object"
            ? (thrown as { status?: unknown }).status
            : undefined;
        const finalExitCode = exitCode ?? (typeof thrownStatus === "number" ? thrownStatus : thrown === undefined ? 0 : 1);
        return {
            exitCode: finalExitCode,
            output: output.join("\n"),
            errors: errors.join("\n"),
            status: exitStatus,
            thrown,
        };
    };
    const temporaryRoots = new Set<string>();
    return {
        module,
        temporaryRoots,
        run,
        dispose: () => {
            for (const root of temporaryRoots) {
                removeTree(module.FS, root);
            }
            temporaryRoots.clear();
        },
    };
}

function temporaryRoot(index: number): string {
    const cryptoApi = globalThis.crypto;
    const suffix = typeof cryptoApi?.randomUUID === "function"
        ? cryptoApi.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `/tmp/ra2-browser-archive-${index}-${suffix}`;
}

async function writeSourceStream(
    fs: ArchiveWasmFileSystem,
    fd: number,
    stream: ReadableStream<Uint8Array>,
): Promise<number> {
    const reader = stream.getReader();
    let offset = 0;
    try {
        while (true) {
            const result = await reader.read();
            if (result.done) {
                break;
            }
            const chunk = result.value;
            if (!chunk?.byteLength) {
                continue;
            }
            const written = fs.write(fd, chunk, 0, chunk.byteLength, offset, false);
            if (typeof written === "number" && written !== chunk.byteLength) {
                throw new Error(`Could not write archive data at byte ${offset}`);
            }
            offset += chunk.byteLength;
        }
    }
    finally {
        reader.releaseLock();
    }
    return offset;
}

function commandFailed(result: ArchiveCommandResult): boolean {
    return result.thrown !== undefined || result.exitCode !== 0;
}

function isRootDirectoryMarker(rawPath: string, directory: boolean): boolean {
    if (!directory) {
        return false;
    }
    const segments = rawPath.replace(/\\/g, "/").split("/");
    return segments.every((segment) => !segment || segment === ".");
}

function parseArchiveType(lines: string[], separator: number): string | undefined {
    for (let index = 0; index < separator; index++) {
        const match = /^Type = (.*)$/.exec(lines[index]);
        if (match) {
            return match[1].trim();
        }
    }
    return undefined;
}

function parseArchiveListing(output: string, archivePath: string): ParsedArchiveListing {
    const lines = output.split(/\r?\n/);
    const separator = lines.findIndex((line) => line.trim() === "----------");
    if (separator < 0) {
        throw invalidArchive(`Archive "${archivePath}" has an invalid file listing`);
    }
    const archiveType = parseArchiveType(lines, separator);
    if (!archiveTypeIsSupported(archiveType)) {
        throw invalidArchive(`Unsupported archive format in "${archivePath}"`);
    }
    const entries: ArchiveListingEntry[] = [];
    let current: { rawPath: string; directory: boolean; type?: string } | undefined;
    const finish = (): void => {
        if (!current) {
            return;
        }
        if (isRootDirectoryMarker(current.rawPath, current.directory)) {
            current = undefined;
            return;
        }
        if (/[\u0000-\u001f\u007f]/.test(current.rawPath)) {
            throw invalidArchive(`Unsafe archive path "${current.rawPath}" in "${archivePath}"`);
        }
        let path: string;
        try {
            path = normalizeGamePath(current.rawPath);
        }
        catch (error) {
            throw invalidArchive(`Unsafe archive path "${current.rawPath}" in "${archivePath}"`, error);
        }
        entries.push({
            rawPath: current.rawPath,
            path,
            directory: current.directory,
            type: current.type,
        });
        current = undefined;
    };
    for (let index = separator + 1; index < lines.length; index++) {
        const line = lines[index];
        const pathMatch = /^Path = (.*)$/.exec(line);
        if (pathMatch) {
            finish();
            current = { rawPath: pathMatch[1], directory: false };
            continue;
        }
        if (!current) {
            continue;
        }
        const folderMatch = /^Folder = (.*)$/.exec(line);
        if (folderMatch) {
            current.directory = folderMatch[1].trim() === "+";
        }
        const typeMatch = /^Type = (.*)$/.exec(line);
        if (typeMatch) {
            current.type = typeMatch[1].trim();
        }
    }
    finish();
    if (!entries.length) {
        throw invalidArchive(`Archive "${archivePath}" contains no entries`);
    }
    const normalizedEntries = entries.sort((left, right) => {
        const leftKey = gamePathKey(left.path);
        const rightKey = gamePathKey(right.path);
        return compareText(leftKey, rightKey) || compareText(left.rawPath, right.rawPath);
    });
    const exact = new Map<string, ArchiveListingEntry>();
    for (const entry of normalizedEntries) {
        const key = gamePathKey(entry.path);
        if (exact.has(key)) {
            throw invalidArchive(`Archive "${archivePath}" contains duplicate normalized path "${entry.path}"`);
        }
        exact.set(key, entry);
    }
    const fileKeys = new Set(normalizedEntries.filter((entry) => !entry.directory).map((entry) => gamePathKey(entry.path)));
    for (const entry of normalizedEntries) {
        const parts = entry.path.split("/");
        for (let index = 1; index < parts.length; index++) {
            const parent = gamePathKey(parts.slice(0, index).join("/"));
            if (fileKeys.has(parent)) {
                throw invalidArchive(`Archive "${archivePath}" contains a file/directory collision at "${entry.path}"`);
            }
        }
    }
    return { entries: normalizedEntries, type: archiveType };
}

export function normalizeArchiveEntryPath(path: string): string {
    return normalizeGamePath(path);
}

export function stripCommonArchiveRoot(
    paths: readonly string[],
    directoryPaths: readonly string[] = [],
): string[] {
    const files = paths.map((path) => normalizeGamePath(path));
    if (!files.length) {
        return [];
    }
    const firstParts = files[0].split("/");
    if (firstParts.length < 2) {
        return files;
    }
    const rootKey = gamePathKey(firstParts[0]);
    if (files.some((path) => {
        const parts = path.split("/");
        return parts.length < 2 || gamePathKey(parts[0]) !== rootKey;
    })) {
        return files;
    }
    const directories = directoryPaths.map((path) => normalizeGamePath(path));
    const allEntriesUnderRoot = directories.every((path) => {
        const parts = path.split("/");
        if (parts.length === 1) {
            return gamePathKey(parts[0]) === rootKey;
        }
        return gamePathKey(parts[0]) === rootKey;
    });
    if (!allEntriesUnderRoot) {
        return files;
    }
    return files.map((path) => path.split("/").slice(1).join("/"));
}

function collectActualFiles(fs: ArchiveWasmFileSystem, rootPath: string): ActualArchiveFile[] {
    const files: ActualArchiveFile[] = [];
    const root = fs.lookupPath(rootPath, { follow: false }).node;
    const visit = (node: ArchiveWasmNode, prefix: string): void => {
        const contents = node.contents;
        if (!contents || contents instanceof Uint8Array || ArrayBuffer.isView(contents)) {
            return;
        }
        for (const name of Object.keys(contents).sort(compareText)) {
            if (name === "." || name === "..") {
                continue;
            }
            const fsPath = prefix ? `${prefix}/${name}` : name;
            const child = contents[name];
            if (child.mode !== undefined && fs.isLink?.(child.mode)) {
                throw new Error(`Archive contains a symbolic link: "${fsPath}"`);
            }
            let path: string;
            try {
                path = normalizeGamePath(fsPath);
            }
            catch (error) {
                throw new Error(`Archive produced an unsafe path: "${fsPath}"`, { cause: error });
            }
            if (isDirectoryNode(fs, child)) {
                visit(child, fsPath);
            }
            else {
                if (child.mode !== undefined && fs.isFile && !fs.isFile(child.mode)) {
                    throw new Error(`Archive produced an unsupported entry: "${fsPath}"`);
                }
                files.push({
                    path,
                    key: gamePathKey(path),
                    fsPath,
                });
            }
        }
    };
    visit(root, "");
    return files.sort((left, right) => compareText(left.key, right.key) || compareText(left.path, right.path));
}

function readExtractedFile(fs: ArchiveWasmFileSystem, path: string): Uint8Array {
    const size = fs.stat(path).size;
    if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error(`Extracted file has an invalid size: "${path}"`);
    }
    const data = new Uint8Array(size);
    if (size === 0) {
        return data;
    }
    const fd = fs.open(path, "r");
    try {
        let offset = 0;
        while (offset < data.length) {
            const read = fs.read(fd, data, offset, data.length - offset, offset);
            if (read <= 0) {
                throw new Error(`Could not read extracted file "${path}"`);
            }
            offset += read;
        }
    }
    finally {
        fs.close(fd);
    }
    return data;
}

function createInMemorySource(
    name: string | undefined,
    files: readonly InMemoryContentFile[],
): ContentImportSource {
    const sortedFiles = [...files].sort((left, right) => compareText(gamePathKey(left.path), gamePathKey(right.path)) || compareText(left.path, right.path));
    const byPath = new Map<string, InMemoryContentFile>();
    for (const file of sortedFiles) {
        byPath.set(gamePathKey(file.path), file);
    }
    let disposed = false;
    return {
        kind: "archives",
        name,
        files: sortedFiles.map((file) => ({ path: file.path, size: file.data.byteLength })),
        async readFile(path: string): Promise<ReadableStream<Uint8Array>> {
            if (disposed) {
                throw new Error("The extracted archive source has been disposed");
            }
            const normalizedPath = normalizeGamePath(path);
            const file = byPath.get(gamePathKey(normalizedPath));
            if (!file) {
                throw new Error(`Extracted archive file is missing: "${path}"`);
            }
            const data = file.data;
            return new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(data);
                    controller.close();
                },
            });
        },
        dispose(): void {
            disposed = true;
            byPath.clear();
        },
    };
}

async function extractOneArchive(
    session: ArchiveSession,
    source: ContentImportSource,
    archive: ArchiveInputFile,
    archiveIndex: number,
    archiveCount: number,
    merged: MergedArchiveContent,
    onProgress?: ContentImportProgress,
): Promise<void> {
    const fs = session.module.FS;
    const label = archive.normalizedPath;
    const rootPath = temporaryRoot(archiveIndex);
    session.temporaryRoots.add(rootPath);
    const outputPath = `${rootPath}/output`;
    const inputPath = `${rootPath}/input${archiveExtension(label)}`;
    try {
        report(onProgress, `Preparing archive ${archiveIndex + 1}/${archiveCount}: ${label}`);
        fs.mkdir(rootPath);
        fs.mkdir(outputPath);
        const fd = fs.open(inputPath, "w+");
        let archiveBytes = 0;
        try {
            const stream = await source.readFile(archive.normalizedPath);
            archiveBytes = await writeSourceStream(fs, fd, stream);
        }
        finally {
            fs.close(fd);
        }
        report(onProgress, `Loaded ${archiveBytes} bytes from ${label}`);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        fs.chdir("/");
        const listingResult = session.run(["l", "-slt", inputPath]);
        if (commandFailed(listingResult)) {
            throw invalidArchive(`Archive "${label}" is invalid or unreadable`, commandCause(listingResult));
        }
        const listing = parseArchiveListing(listingResult.output, label);
        const expected = new Map<string, ArchiveListingEntry>();
        for (const entry of listing.entries) {
            if (!entry.directory) {
                expected.set(gamePathKey(entry.path), entry);
            }
        }
        if (!expected.size) {
            throw invalidArchive(`Archive "${label}" contains no readable files`);
        }
        report(onProgress, `Extracting archive ${archiveIndex + 1}/${archiveCount}: ${label}`);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        fs.chdir(outputPath);
        const extractionResult = session.run(["x", "-ssc-", "-aos", inputPath]);
        if (commandFailed(extractionResult)) {
            const cause = commandCause(extractionResult);
            if (/out of memory|allocation/i.test(cause.message)) {
                throw new RangeError(`Archive extraction ran out of memory for "${label}"`, { cause });
            }
            throw archiveError(`Archive extraction failed for "${label}"`, cause);
        }
        const actualFiles = collectActualFiles(fs, outputPath);
        if (!actualFiles.length) {
            throw archiveError(`Archive extraction produced no readable files for "${label}"`);
        }
        const directoryPaths = listing.entries.filter((entry) => entry.directory).map((entry) => entry.path);
        const originalPaths = [...expected.values()].map((entry) => entry.path);
        const strippedPaths = stripCommonArchiveRoot(originalPaths, directoryPaths);
        const strippedByKey = new Map<string, string>();
        originalPaths.forEach((path, index) => strippedByKey.set(gamePathKey(path), strippedPaths[index]!));
        const localFiles = new Map<string, InMemoryContentFile>();
        for (let index = 0; index < actualFiles.length; index++) {
            const actual = actualFiles[index];
            const expectedEntry = expected.get(actual.key);
            if (!expectedEntry) {
                throw archiveError(`Archive extraction produced an unexpected file "${actual.path}" in "${label}"`);
            }
            const outputPathForFile = strippedByKey.get(actual.key);
            if (!outputPathForFile || localFiles.has(actual.key)) {
                throw archiveError(`Archive extraction produced a duplicate path "${actual.path}" in "${label}"`);
            }
            const data = readExtractedFile(fs, actual.fsPath);
            try {
                fs.unlink(actual.fsPath);
            }
            catch {
            }
            localFiles.set(actual.key, {
                path: outputPathForFile,
                data,
                archivePath: label,
            });
            report(onProgress, `Read ${index + 1}/${actualFiles.length} files from ${label}`);
        }
        for (const key of expected.keys()) {
            if (!localFiles.has(key)) {
                throw archiveError(`Archive extraction did not produce "${key}" from "${label}"`);
            }
        }
        const localDirectories = new Map<string, string>();
        for (const file of localFiles.values()) {
            for (const key of ancestorKeys(file.path)) {
                localDirectories.set(key, label);
            }
        }
        for (const [key, origin] of [...localDirectories.entries()].sort(([left], [right]) => compareText(left, right))) {
            const fileCollision = merged.files.get(key);
            if (fileCollision) {
                throw archiveError(`Archive path collision "${fileCollision.path}" from "${fileCollision.archivePath}" conflicts with directory "${key}" from "${origin}"`);
            }
            for (const ancestor of ancestorKeys(key)) {
                const fileAtAncestor = merged.files.get(ancestor);
                if (fileAtAncestor) {
                    throw archiveError(`Archive path collision "${fileAtAncestor.path}" from "${fileAtAncestor.archivePath}" conflicts with directory "${key}" from "${origin}"`);
                }
            }
        }
        for (const file of [...localFiles.values()].sort((left, right) => compareText(gamePathKey(left.path), gamePathKey(right.path)))) {
            const key = gamePathKey(file.path);
            const previous = merged.files.get(key);
            if (previous) {
                throw archiveError(`Archive path collision "${file.path}" appears in "${previous.archivePath}" and "${label}"`);
            }
            const directoryOrigin = merged.directories.get(key);
            if (directoryOrigin) {
                throw archiveError(`Archive path collision "${file.path}" from "${label}" conflicts with directory from "${directoryOrigin}"`);
            }
            for (const ancestor of ancestorKeys(file.path)) {
                const fileAtAncestor = merged.files.get(ancestor);
                if (fileAtAncestor) {
                    throw archiveError(`Archive path collision "${file.path}" from "${label}" is under file "${fileAtAncestor.path}" from "${fileAtAncestor.archivePath}"`);
                }
            }
        }
        for (const [key, origin] of localDirectories) {
            if (!merged.directories.has(key)) {
                merged.directories.set(key, origin);
            }
            for (const ancestor of ancestorKeys(key)) {
                if (!merged.directories.has(ancestor)) {
                    merged.directories.set(ancestor, origin);
                }
            }
        }
        for (const [key, file] of localFiles) {
            merged.files.set(key, file);
        }
        report(onProgress, `Extracted ${localFiles.size} files from ${label}`);
    }
    catch (error) {
        if (error instanceof InvalidArchiveError || error instanceof ArchiveExtractionError || error instanceof RangeError) {
            throw error;
        }
        throw archiveError(`Could not extract archive "${label}": ${errorMessage(error)}`, error);
    }
    finally {
        try {
            fs.chdir("/");
        }
        catch {
        }
        try {
            removeTree(fs, rootPath);
        }
        catch {
        }
        session.temporaryRoots.delete(rootPath);
    }
}

export async function extractArchiveContentSource(
    source: ContentImportSource,
    onProgress?: ContentImportProgress,
    options: ArchiveExtractionOptions = {},
): Promise<ContentImportSource> {
    let session: ArchiveSession | undefined;
    let output: ContentImportSource | undefined;
    let failed = false;
    let failure: unknown;
    try {
        const archives = validateArchiveInputs(source);
        report(onProgress, `Preparing ${archives.length} archive${archives.length === 1 ? "" : "s"} for import...`);
        report(onProgress, "Loading archive extractor...");
        session = await createArchiveSession(options);
        const merged: MergedArchiveContent = {
            files: new Map<string, InMemoryContentFile>(),
            directories: new Map<string, string>(),
        };
        for (let index = 0; index < archives.length; index++) {
            await extractOneArchive(session, source, archives[index], index, archives.length, merged, onProgress);
        }
        if (!merged.files.size) {
            throw invalidArchive("The selected archives contain no readable files");
        }
        report(onProgress, `Prepared ${merged.files.size} extracted files for import...`);
        output = createInMemorySource(
            source.name ?? (archives.length === 1 ? archives[0].normalizedPath : "imported-content"),
            [...merged.files.values()],
        );
    }
    catch (error) {
        failed = true;
        failure = error;
    }
    if (session) {
        try {
            disposeSession(session);
        }
        catch (error) {
            if (!failed) {
                failed = true;
                failure = error;
            }
        }
    }
    try {
        await source.dispose();
    }
    catch (error) {
        if (!failed) {
            failed = true;
            failure = error;
        }
    }
    if (failed) {
        try {
            await output?.dispose();
        }
        catch {
        }
        throw failure;
    }
    return output!;
}
