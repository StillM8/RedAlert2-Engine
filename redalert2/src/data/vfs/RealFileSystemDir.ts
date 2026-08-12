import { StorageQuotaError } from "./StorageQuotaError";
import { gamePathKey, normalizeGamePath } from "../../engine/GamePath";
import { FileNotFoundError } from "./FileNotFoundError";
import { IOError } from "./IOError";
import { NameNotAllowedError } from "./NameNotAllowedError";
import { VirtualFile } from "./VirtualFile";

type DirectoryIndex = Map<string, { name: string; kind: "file" | "directory" }>;
const directoryIndexes = new WeakMap<FileSystemDirectoryHandle, Promise<DirectoryIndex>>();

export interface RecursiveEntryOptions {
    /** Directory names to skip before descending from this directory's root. */
    skipRootDirectories?: ReadonlySet<string>;
}

export class RealFileSystemDir {
    private handle: FileSystemDirectoryHandle;
    public caseSensitive: boolean;
    constructor(handle: FileSystemDirectoryHandle, caseSensitive: boolean = false) {
        this.handle = handle;
        this.caseSensitive = caseSensitive;
    }
    getNativeHandle(): FileSystemDirectoryHandle {
        return this.handle;
    }
    get name(): string {
        return this.handle.name;
    }
    async *getEntries(): AsyncGenerator<string, void, undefined> {
        try {
            for await (const [key, _handle] of this.handle.entries()) {
                yield key;
            }
        }
        catch (e: any) {
            if (e.name === "NotFoundError") {
                throw new FileNotFoundError(`Directory \"${this.handle.name}\" not found`, e);
            }
            if (e instanceof DOMException) {
                throw new IOError(`Directory \"${this.handle.name}\" could not be read (${e.name})`, e);
            }
            throw e;
        }
    }

    /** Enumerate files below this directory using game-style relative paths. */
    async *getEntriesRecursive(prefix: string = "", options?: RecursiveEntryOptions): AsyncGenerator<string, void, undefined> {
        try {
            for await (const [key, entryHandle] of this.handle.entries()) {
                const entryPath = prefix ? `${prefix}/${key}` : key;
                if (entryHandle.kind === "file") {
                    yield entryPath;
                }
                else {
                    if (!prefix && options?.skipRootDirectories?.has(gamePathKey(key))) {
                        continue;
                    }
                    const child = new RealFileSystemDir(
                        entryHandle as FileSystemDirectoryHandle,
                        this.caseSensitive,
                    );
                    yield* child.getEntriesRecursive(entryPath);
                }
            }
        }
        catch (e: any) {
            if (e.name === "NotFoundError") {
                throw new FileNotFoundError(`Directory \"${this.handle.name}\" not found`, e);
            }
            if (e instanceof DOMException) {
                throw new IOError(`Directory \"${this.handle.name}\" could not be read (${e.name})`, e);
            }
            throw e;
        }
    }
    async listEntries(): Promise<string[]> {
        const entries: string[] = [];
        for await (const entry of this.getEntries()) {
            entries.push(entry);
        }
        return entries;
    }
    async *getFileHandles(): AsyncGenerator<FileSystemFileHandle, void, undefined> {
        try {
            for await (const entryHandle of this.handle.values()) {
                if (entryHandle.kind === "file") {
                    yield entryHandle as FileSystemFileHandle;
                }
            }
        }
        catch (e: any) {
            if (e.name === "NotFoundError") {
                throw new FileNotFoundError(`Directory \"${this.handle.name}\" not found`, e);
            }
            if (e instanceof DOMException) {
                throw new IOError(`Directory \"${this.handle.name}\" could not be read (${e.name})`, e);
            }
            throw e;
        }
    }
    async *getRawFiles(): AsyncGenerator<File, void, undefined> {
        for await (const fileHandle of this.getFileHandles()) {
            yield await fileHandle.getFile();
        }
    }
    async containsEntry(entryName: string): Promise<boolean> {
        return (await this.resolveEntryName(entryName)) !== undefined;
    }
    async resolveEntryName(entryName: string): Promise<string | undefined> {
        if (this.caseSensitive) {
            try {
                const fileHandle = await this.handle.getFileHandle(entryName).catch(() => null);
                if (fileHandle)
                    return fileHandle.name;
                const dirHandle = await this.handle.getDirectoryHandle(entryName).catch(() => null);
                if (dirHandle)
                    return dirHandle.name;
                return undefined;
            }
            catch {
                return undefined;
            }
        }
        else {
            return (await this.getDirectoryIndex()).get(gamePathKey(entryName))?.name;
        }
        return undefined;
    }
    async fixEntryCase(entryName: string): Promise<string> {
        if (!this.caseSensitive) {
            return (await this.getDirectoryIndex()).get(gamePathKey(entryName))?.name ?? entryName;
        }
        return entryName;
    }
    async getRawFile(filename: string, skipCaseFix: boolean = false, type?: string): Promise<File> {
        let fileHandle: FileSystemFileHandle;
        try {
            const normalizedFilename = normalizeGamePath(filename);
            const segments = normalizedFilename.split('/');
            const fileName = segments.pop()!;
            let directoryHandle = this.handle;
            for (const directoryName of segments) {
                const resolvedDirectoryName = skipCaseFix
                    ? directoryName
                    : await this.resolveChildName(directoryHandle, directoryName, "directory");
                if (!resolvedDirectoryName) {
                    throw new FileNotFoundError(`Directory \"${directoryName}\" not found while opening \"${filename}\"`);
                }
                directoryHandle = await directoryHandle.getDirectoryHandle(resolvedDirectoryName);
            }
            const resolvedName = skipCaseFix
                ? fileName
                : await this.resolveChildName(directoryHandle, fileName, "file");
            if (!resolvedName) {
                throw new FileNotFoundError(`File \"${filename}\" not found in directory \"${this.handle.name}\"`);
            }
            fileHandle = await directoryHandle.getFileHandle(resolvedName);
        }
        catch (e: any) {
            if (e.name === "NotFoundError") {
                throw new FileNotFoundError(`File \"${filename}\" not found in directory \"${this.handle.name}\"`, e);
            }
            if (e instanceof TypeError && e.message.includes("not allowed")) {
                throw new NameNotAllowedError(`File name \"${filename}\" is not allowed`, e);
            }
            if (e instanceof DOMException) {
                throw new IOError(`File \"${filename}\" could not be read (${e.name})`, e);
            }
            throw e;
        }
        const file = await fileHandle.getFile();
        if (type) {
            return new File([await file.arrayBuffer()], file.name, { type });
        }
        return file;
    }
    async openFile(filename: string, skipCaseFix: boolean = false): Promise<VirtualFile> {
        const normalizedFilename = normalizeGamePath(filename);
        const rawFile = await this.getRawFile(normalizedFilename, skipCaseFix);
        return VirtualFile.fromRealFile(rawFile, normalizedFilename);
    }

    private async resolveChildName(
        directoryHandle: FileSystemDirectoryHandle,
        entryName: string,
        kind: "file" | "directory",
    ): Promise<string | undefined> {
        if (this.caseSensitive) {
            try {
                if (kind === "file") {
                    return (await directoryHandle.getFileHandle(entryName)).name;
                }
                return (await directoryHandle.getDirectoryHandle(entryName)).name;
            }
            catch {
                return undefined;
            }
        }
        const entry = (await this.getDirectoryIndex(directoryHandle)).get(gamePathKey(entryName));
        return entry?.kind === kind ? entry.name : undefined;
    }
    async writeFile(virtualFile: VirtualFile, filenameOverride?: string): Promise<void> {
        const resolvedFilename = normalizeGamePath(filenameOverride ?? virtualFile.filename);
        try {
            const segments = resolvedFilename.split('/');
            const filename = segments.pop()!;
            let directoryHandle = this.handle;
            for (const directoryName of segments) {
                const existingName = this.caseSensitive
                    ? directoryName
                    : await this.resolveChildName(directoryHandle, directoryName, "directory");
                if (existingName) {
                    directoryHandle = await directoryHandle.getDirectoryHandle(existingName);
                }
                else {
                    this.invalidateDirectoryIndex(directoryHandle);
                    directoryHandle = await directoryHandle.getDirectoryHandle(directoryName, { create: true });
                }
            }
            const existingFileName = this.caseSensitive
                ? filename
                : await this.resolveChildName(directoryHandle, filename, "file");
            if (existingFileName) {
                await directoryHandle.removeEntry(existingFileName);
            }
            this.invalidateDirectoryIndex(directoryHandle);
            const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            try {
                await writable.write(virtualFile.getBytes() as any);
                await writable.close();
            }
            catch (writeError) {
                await writable.abort();
                throw writeError;
            }
        }
        catch (e: any) {
            if (e.name === "QuotaExceededError" || (e instanceof DOMException && e.message.toLowerCase().includes("quota"))) {
                throw new StorageQuotaError(undefined, e);
            }
            if (e.name === "NotFoundError") {
                throw new FileNotFoundError(`Directory \"${this.handle.name}\" not found during writeFile operation for \"${resolvedFilename}\"`, e);
            }
            if (e instanceof TypeError && e.message.includes("not allowed")) {
                throw new NameNotAllowedError(`File name \"${resolvedFilename}\" is not allowed`, e);
            }
            if (e instanceof DOMException) {
                throw new IOError(`File \"${resolvedFilename}\" could not be written (${e.name})`, e);
            }
            throw e;
        }
    }
    async deleteFile(filename: string, skipCaseFix: boolean = false): Promise<void> {
        const normalizedFilename = normalizeGamePath(filename);
        const segments = normalizedFilename.split('/');
        const finalFilename = segments.pop()!;
        let directoryHandle = this.handle;
        for (const directoryName of segments) {
            const resolvedDirectoryName = skipCaseFix
                ? directoryName
                : await this.resolveChildName(directoryHandle, directoryName, "directory");
            if (!resolvedDirectoryName) return;
            directoryHandle = await directoryHandle.getDirectoryHandle(resolvedDirectoryName);
        }
        const resolvedName = skipCaseFix
            ? finalFilename
            : await this.resolveChildName(directoryHandle, finalFilename, "file");
        if (resolvedName) {
            try {
                await directoryHandle.removeEntry(resolvedName);
                this.invalidateDirectoryIndex(directoryHandle);
            }
            catch (e: any) {
                if (skipCaseFix && e.name === "NotFoundError") {
                    return;
                }
                if (e.name === "QuotaExceededError" || (e instanceof DOMException && e.message.toLowerCase().includes("quota"))) {
                    throw new StorageQuotaError(undefined, e);
                }
                if (e instanceof TypeError && e.message.includes("not allowed")) {
                    throw new NameNotAllowedError(`File name \"${resolvedName}\" is not allowed for deletion`, e);
                }
                if (e instanceof DOMException) {
                    throw new IOError(`File \"${resolvedName}\" could not be deleted (${e.name})`, e);
                }
                throw e;
            }
        }
    }
    async getDirectory(dirName: string, forceCaseSensitive: boolean = this.caseSensitive): Promise<RealFileSystemDir> {
        const normalizedName = normalizeGamePath(dirName);
        const resolvedName = forceCaseSensitive ? normalizedName : await this.fixEntryCase(normalizedName);
        let dirHandle: FileSystemDirectoryHandle;
        try {
            dirHandle = await this.handle.getDirectoryHandle(resolvedName);
        }
        catch (e: any) {
            if (e.name === "NotFoundError") {
                throw new FileNotFoundError(`Directory \"${dirName}\" not found or parent directory \"${this.handle.name}\" is gone`, e);
            }
            if (e instanceof TypeError && e.message.includes("not allowed")) {
                throw new NameNotAllowedError(`Directory name \"${dirName}\" is not allowed`, e);
            }
            if (e instanceof DOMException) {
                throw new IOError(`Directory \"${dirName}\" could not be read (${e.name})`, e);
            }
            throw e;
        }
        return new RealFileSystemDir(dirHandle, forceCaseSensitive);
    }
    async getOrCreateDirectory(dirName: string, forceCaseSensitive: boolean = this.caseSensitive): Promise<RealFileSystemDir> {
        const normalizedName = normalizeGamePath(dirName);
        const resolvedName = forceCaseSensitive ? normalizedName : await this.fixEntryCase(normalizedName);
        try {
            this.invalidateDirectoryIndex(this.handle);
            const dirHandle = await this.handle.getDirectoryHandle(resolvedName, { create: true });
            return new RealFileSystemDir(dirHandle, forceCaseSensitive);
        }
        catch (e: any) {
            if (e.name === "QuotaExceededError" || (e instanceof DOMException && e.message.toLowerCase().includes("quota"))) {
                throw new StorageQuotaError(undefined, e);
            }
            if (e.name === "NotFoundError") {
                throw new FileNotFoundError(`Directory \"${this.handle.name}\" not found while trying to create/get \"${dirName}\"`, e);
            }
            if (e instanceof TypeError && e.message.includes("not allowed")) {
                throw new NameNotAllowedError(`Directory name \"${dirName}\" is not allowed`, e);
            }
            if (e instanceof DOMException) {
                throw new IOError(`Directory \"${dirName}\" could not be created/accessed (${e.name})`, e);
            }
            throw e;
        }
    }
    async getOrCreateDirectoryHandle(dirName: string, isPrivate?: boolean): Promise<FileSystemDirectoryHandle> {
        const rfsDir = await this.getOrCreateDirectory(dirName, isPrivate);
        return rfsDir.getNativeHandle();
    }
    async deleteDirectory(dirName: string, recursive: boolean = false): Promise<void> {
        const normalizedName = normalizeGamePath(dirName);
        const resolvedName = await this.fixEntryCase(normalizedName);
        if (resolvedName) {
            try {
                await this.handle.removeEntry(resolvedName, { recursive });
                this.invalidateDirectoryIndex(this.handle);
            }
            catch (e: any) {
                if (e.name === "QuotaExceededError" || (e instanceof DOMException && e.message.toLowerCase().includes("quota"))) {
                    throw new StorageQuotaError(undefined, e);
                }
                if (e.name === "InvalidModificationError" && !recursive) {
                    throw new IOError("Can't delete non-empty directory when recursive = false", e);
                }
                if (e.name === "NotFoundError") {
                    throw new FileNotFoundError(`Directory \"${resolvedName}\" not found for deletion.`, e);
                }
                if (e instanceof TypeError && e.message.includes("not allowed")) {
                    throw new NameNotAllowedError(`Directory name \"${resolvedName}\" is not allowed for deletion`, e);
                }
                if (e instanceof DOMException) {
                    throw new IOError(`Directory \"${resolvedName}\" could not be deleted (${e.name})`, e);
                }
                throw e;
            }
        }
        else {
            throw new FileNotFoundError(`Directory \"${dirName}\" not found for deletion (case-insensitive check failed).`);
        }
    }

    private async getDirectoryIndex(directoryHandle: FileSystemDirectoryHandle = this.handle): Promise<DirectoryIndex> {
        const cached = directoryIndexes.get(directoryHandle);
        if (cached) return cached;
        const loading = (async () => {
            const index: DirectoryIndex = new Map();
            for await (const [name, entryHandle] of directoryHandle.entries()) {
                const key = gamePathKey(name);
                if (!index.has(key)) {
                    index.set(key, { name, kind: entryHandle.kind });
                }
            }
            return index;
        })();
        directoryIndexes.set(directoryHandle, loading);
        return loading;
    }

    private invalidateDirectoryIndex(directoryHandle: FileSystemDirectoryHandle = this.handle): void {
        directoryIndexes.delete(directoryHandle);
    }
}
