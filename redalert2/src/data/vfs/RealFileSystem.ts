import { FileNotFoundError } from "./FileNotFoundError";
import { RealFileSystemDir } from "./RealFileSystemDir";
import type { VirtualFile } from "./VirtualFile";
import {
    canonicalizeFileProviderCopyPath,
    compareFileProviderCopyGeneration,
    gamePathKey,
    gamePathLeaf,
    normalizeGamePath,
} from "../../engine/GamePath";
export interface RFSConstructorOptions {
    /**
     * Root-level directories owned by the engine rather than by the active
     * game installation. They are mounted separately when needed (for
     * example the selected mod and map directories), so recursively scanning
     * them from the base root would leak unrelated content into the VFS.
     */
    excludedRootDirectories?: readonly string[];
}
export class RealFileSystem {
    private directories: RealFileSystemDir[];
    private rootDirectory: RealFileSystemDir | undefined;
    private rootDirectoryHandle: FileSystemDirectoryHandle | undefined;
    private readonly excludedRootDirectoryKeys: ReadonlySet<string>;
    private preferredEntryByLeaf?: Promise<ReadonlyMap<string, string>>;
    constructor(options?: RFSConstructorOptions) {
        this.directories = [];
        this.excludedRootDirectoryKeys = new Set(
            (options?.excludedRootDirectories ?? []).map((directory) => gamePathKey(directory)),
        );
    }
    addRootDirectoryHandle(handle: FileSystemDirectoryHandle): RealFileSystemDir {
        this.rootDirectoryHandle = handle;
        const newDir = new RealFileSystemDir(handle);
        this.directories.push(newDir);
        this.rootDirectory = newDir;
        this.preferredEntryByLeaf = undefined;
        return newDir;
    }
    getRootDirectoryHandle(): FileSystemDirectoryHandle | undefined {
        return this.rootDirectoryHandle;
    }
    addDirectoryHandle(handle: FileSystemDirectoryHandle): RealFileSystemDir {
        const newDir = new RealFileSystemDir(handle);
        this.directories.push(newDir);
        this.preferredEntryByLeaf = undefined;
        return newDir;
    }
    addDirectory(dir: RealFileSystemDir): void {
        if (!this.directories.includes(dir)) {
            this.directories.push(dir);
            this.preferredEntryByLeaf = undefined;
        }
    }
    async getDirectory(path: string): Promise<RealFileSystemDir> {
        for (const dir of [...this.directories].reverse()) {
            if (dir.name === path)
                return dir;
            try {
                return await dir.getDirectory(path);
            }
            catch (e) {
                if (!(e instanceof FileNotFoundError)) {
                }
            }
        }
        throw new Error(`Directory "${path}" not found in real file system`);
    }
    async findDirectory(directoryName: string): Promise<RealFileSystemDir | undefined> {
        for (const dir of [...this.directories].reverse()) {
            if (await dir.containsEntry(directoryName)) {
                try {
                    return await dir.getDirectory(directoryName);
                }
                catch (e) {
                    continue;
                }
            }
        }
        return undefined;
    }
    getRootDirectory(): RealFileSystemDir | undefined {
        return this.rootDirectory;
    }
    async containsEntry(entryName: string): Promise<boolean> {
        for (const dir of [...this.directories].reverse()) {
            if (await dir.containsEntry(entryName)) {
                return true;
            }
        }
        return false;
    }
    async openFile(filename: string, skipCaseFix: boolean = false): Promise<VirtualFile> {
        // Later directories are overlays (mod, map, compatibility layers) and
        // therefore must win over the base game directory.
        for (const dir of [...this.directories].reverse()) {
            try {
                return await dir.openFile(filename, skipCaseFix);
            }
            catch (e) {
                if (!(e instanceof FileNotFoundError)) {
                    throw e;
                }
            }
        }
        throw new FileNotFoundError(`File "${filename}" not found in any registered real file system directories.`);
    }

    /**
     * Open one deterministic owner of a same-name MIX in each mounted layer.
     * Distinct mounted directories are real base/overlay layers. Names such
     * as `expand99 (1).mix` inside one directory are duplicate-copy
     * generations, not an implicit MIX patch format; the latest generation
     * replaces the earlier copy as a whole.
     */
    async openFilesFromLayers(filename: string): Promise<Array<{ file: VirtualFile; directoryIndex: number }>> {
        const result: Array<{ file: VirtualFile; directoryIndex: number }> = [];
        const normalizedFilename = normalizeGamePath(filename);
        const canonicalLeaf = gamePathKey(gamePathLeaf(normalizedFilename));
        const isVariant = (entryName: string): boolean => {
            const leaf = gamePathLeaf(entryName);
            return gamePathKey(canonicalizeFileProviderCopyPath(leaf)) === canonicalLeaf;
        };
        for (let directoryIndex = 0; directoryIndex < this.directories.length; directoryIndex++) {
            const directory = this.directories[directoryIndex];
            const candidateNames = new Set<string>();
            for await (const entryName of directory.getEntries()) {
                if (isVariant(entryName)) {
                    candidateNames.add(entryName);
                }
            }
            if (!candidateNames.size) {
                candidateNames.add(normalizedFilename);
            }
            const orderedCandidates = [...candidateNames].sort((a, b) =>
                compareFileProviderCopyGeneration(b, a) ||
                gamePathKey(a).localeCompare(gamePathKey(b)),
            );
            for (const candidateName of orderedCandidates) {
                try {
                    result.push({
                        file: await directory.openFile(candidateName),
                        directoryIndex,
                    });
                    break;
                }
                catch (e) {
                    if (!(e instanceof FileNotFoundError)) {
                        throw e;
                    }
                }
            }
        }
        return result;
    }
    async getRawFile(filename: string): Promise<File> {
        for (const dir of [...this.directories].reverse()) {
            try {
                return await dir.getRawFile(filename);
            }
            catch (e) {
                if (!(e instanceof FileNotFoundError))
                    throw e;
            }
        }
        throw new FileNotFoundError(`File "${filename}" not found in real file system (getRawFile)`);
    }
    async *getEntries(): AsyncGenerator<string, void, undefined> {
        for (const dir of this.directories) {
            for await (const entryName of dir.getEntries()) {
                yield entryName;
            }
        }
    }
    async *getEntriesRecursive(): AsyncGenerator<string, void, undefined> {
        for await (const { entryName } of this.getEntriesRecursiveWithDirectoryIndex()) {
            yield entryName;
        }
    }

    /**
     * Enumerate mounted files together with the layer that supplied them.
     * Directory order is the VFS precedence order: the root installation is
     * index 0 and explicitly mounted overlays are added after it.
     */
    async *getEntriesRecursiveWithDirectoryIndex(): AsyncGenerator<{
        entryName: string;
        directoryIndex: number;
    }, void, undefined> {
        for (let directoryIndex = 0; directoryIndex < this.directories.length; directoryIndex++) {
            const dir = this.directories[directoryIndex];
            const options = dir === this.rootDirectory
                ? { skipRootDirectories: this.excludedRootDirectoryKeys }
                : undefined;
            for await (const entryName of dir.getEntriesRecursive("", options)) {
                yield { entryName, directoryIndex };
            }
        }
    }

    /**
     * Resolve a leaf through the mounted-directory precedence order. The
     * selected mod directory is added after the base root, so its nested
     * profile archive wins over a same-named base archive. Unselected managed
     * roots are excluded before this index is built.
     */
    async findEntryByLeaf(filename: string): Promise<string | undefined> {
        if (!this.preferredEntryByLeaf) {
            this.preferredEntryByLeaf = (async () => {
                const entriesByLeaf = new Map<string, string>();
                for (const dir of [...this.directories].reverse()) {
                    const options = dir === this.rootDirectory
                        ? { skipRootDirectories: this.excludedRootDirectoryKeys }
                        : undefined;
                    for await (const entry of dir.getEntriesRecursive("", options)) {
                        const normalized = normalizeGamePath(entry);
                        const key = gamePathKey(gamePathLeaf(normalized));
                        if (!entriesByLeaf.has(key)) {
                            entriesByLeaf.set(key, normalized);
                        }
                    }
                }
                return entriesByLeaf;
            })();
        }
        return (await this.preferredEntryByLeaf).get(gamePathKey(gamePathLeaf(filename)));
    }
}
