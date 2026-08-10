import { sleep } from "@/util/time";
import { IOError } from "@/data/vfs/IOError";
import { ArchiveExtractionError } from "@/engine/gameRes/importError/ArchiveExtractionError";
import { InvalidArchiveError } from "@/engine/gameRes/importError/InvalidArchiveError";
import { ModManager } from "@/gui/screen/mainMenu/modSel/ModManager";
import { ModMeta } from "@/gui/screen/mainMenu/modSel/ModMeta";
import { BadModArchiveError } from "@/gui/screen/mainMenu/modSel/BadModArchiveError";
import { IniFile } from "@/data/IniFile";
import { DuplicateModError } from "@/gui/screen/mainMenu/modSel/DuplicateModError";
import { VirtualFile } from "@/data/vfs/VirtualFile";
import sevenZipFactory from "7z-wasm";
interface MessageBoxApi {
    alert(message: string, buttonText: string): Promise<void>;
    confirm(message: string, confirmText: string, cancelText: string): Promise<boolean>;
}
interface Storage {
    estimate?(): Promise<{
        quota?: number;
        usage?: number;
    }>;
}
interface Directory {
    listEntries(): Promise<string[]>;
    getOrCreateDirectory(name: string): Promise<Directory>;
    getFileHandles(): AsyncIterable<{
        name: string;
    }>;
    deleteFile(name: string): Promise<void>;
    writeFile(file: VirtualFile): Promise<void>;
    deleteDirectory(name: string, recursive: boolean): Promise<void>;
    name: string;
}
interface EmscriptenFS {
    chdir(path: string): void;
    open(filename: string, flags: string): number;
    read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
    write(fd: number, buffer: Uint8Array, offset: number, length: number, position: number, canOwn: boolean): void;
    close(fd: number): void;
    unlink(filename: string): void;
    lookupPath(path: string): {
        node: any;
    };
    cwd(): string;
    stat(filename: string): {
        size: number;
    };
}
interface SevenZipModule {
    FS: EmscriptenFS;
    callMain(args: string[]): void;
}
export class ModImporter {
    private static readonly modFileExtensions = ["mix", "big", "csf", "ini", "art", "rules"];
    private strings: any;
    private messageBoxApi: MessageBoxApi;
    private storage: Storage;
    constructor(strings: any, messageBoxApi: MessageBoxApi, storage: Storage) {
        this.strings = strings;
        this.messageBoxApi = messageBoxApi;
        this.storage = storage;
    }
    async import(file: File, modDirectory: Directory, overwrite: boolean, onProgress: (message: string) => void): Promise<ModMeta | undefined> {
        const strings = this.strings;
        let exitCode: number | undefined;
        let exitError: any;
        let sevenZipModule: SevenZipModule;
        try {
            // The desktop build historically supplied SystemJS globally, but
            // the Android WebView is a Vite module build. Keep 7-Zip in the
            // module graph so a locked/background WebView does not need to
            // fetch a late importer chunk.
            sevenZipModule = await (sevenZipFactory as any)({
                locateFile: (path: string) => path === "7zz.wasm" ? "/7zz.wasm" : path,
                quit: (code: number, error: any) => {
                    exitCode = code;
                    exitError = error;
                },
            });
        }
        catch (error) {
            if (error instanceof WebAssembly.RuntimeError) {
                throw new IOError("Couldn't load 7z-wasm", error);
            }
            throw error;
        }
        onProgress(strings.get("ts:import_loading_archive"));
        sevenZipModule.FS.chdir("/tmp");
        const fileName = file.name;
        try {
            const arrayBuffer = await file.arrayBuffer();
            const fileDescriptor = sevenZipModule.FS.open(fileName, "w+");
            sevenZipModule.FS.write(fileDescriptor, new Uint8Array(arrayBuffer), 0, arrayBuffer.byteLength, 0, true);
            sevenZipModule.FS.close(fileDescriptor);
        }
        catch (error) {
            if (error instanceof DOMException) {
                throw new IOError(`File "${fileName}" could not be read (${error.name})`, error);
            }
            throw error;
        }
        onProgress(strings.get("ts:import_extracting_archive"));
        await sleep(100);
        sevenZipModule.callMain(["x", "-ssc-", "-x!*/", fileName, "*.*"]);
        if (exitCode) {
            if (exitCode !== 1) {
                throw new InvalidArchiveError("7-Zip exited with code " + exitCode, { cause: exitError });
            }
            if (exitError?.message?.match(/out of memory|allocation/i)) {
                throw new RangeError("Out of memory", { cause: exitError });
            }
            throw new ArchiveExtractionError("Archive extraction failed with code " + exitCode, {
                cause: exitError,
            });
        }
        sevenZipModule.FS.unlink(fileName);
        let currentNode = sevenZipModule.FS.lookupPath(sevenZipModule.FS.cwd()).node;
        let extractedFiles = Object.keys(currentNode.contents);
        const modMeta = new ModMeta();
        const cleanup = () => {
            ({ node: currentNode } = sevenZipModule.FS.lookupPath(sevenZipModule.FS.cwd()));
            extractedFiles = Object.keys(currentNode.contents);
            for (const filename of extractedFiles) {
                sevenZipModule.FS.unlink(filename);
            }
        };
        let totalSize = 0;
        for (const filename of extractedFiles) {
            totalSize += sevenZipModule.FS.stat(filename).size;
        }
        if (this.storage?.estimate) {
            try {
                const estimate = await this.storage.estimate();
                if (estimate?.quota && estimate.usage) {
                    const available = estimate.quota - estimate.usage;
                    if (available < totalSize + 1024 * 1024) {
                        await this.messageBoxApi.alert(strings.get("GUI:InstallModStorageFull", available / 1024 / 1024, totalSize / 1024 / 1024), strings.get("GUI:OK"));
                        cleanup();
                        return undefined;
                    }
                }
            }
            catch (error) {
                console.warn("Couldn't get storage estimate", [error]);
            }
        }
        try {
            const existingEntries = await modDirectory.listEntries();
            let modId: string;
            if (extractedFiles.includes(ModManager.modMetaFileName)) {
                const metaFile = this.readFileFromEmFs(sevenZipModule.FS, ModManager.modMetaFileName);
                try {
                    modMeta.fromIniFile(new IniFile(metaFile.readAsString("utf-8")));
                }
                catch (error) {
                    throw new BadModArchiveError("Mod meta file is invalid");
                }
                modId = modMeta.id!;
                if (!overwrite && existingEntries.find((entry) => entry.toLowerCase() === modId.toLowerCase())) {
                    throw new DuplicateModError(`A mod with the id "${modMeta.id}" already exists`);
                }
            }
            else {
                if (!extractedFiles.some((filename) => ModImporter.modFileExtensions.includes(currentNode.contents[filename].name.toLowerCase().split(".").pop()))) {
                    throw new BadModArchiveError("Archive doesn't contain a valid mod");
                }
                if (!(await this.messageBoxApi.confirm(this.strings.get("GUI:ImportModUnsupportedWarn"), this.strings.get("GUI:Continue"), this.strings.get("GUI:Cancel")))) {
                    cleanup();
                    return undefined;
                }
                modId = await this.promptFolderName(existingEntries);
                if (!modId) {
                    cleanup();
                    return undefined;
                }
                modMeta.id = modId;
                modMeta.name = modId;
            }
            const targetDirectory = await modDirectory.getOrCreateDirectory(modId);
            for await (const fileHandle of targetDirectory.getFileHandles()) {
                await targetDirectory.deleteFile(fileHandle.name);
            }
            for (const filename of extractedFiles) {
                onProgress(strings.get("ts:import_importing", filename));
                try {
                    const virtualFile = this.readFileFromEmFs(sevenZipModule.FS, filename);
                    await targetDirectory.writeFile(virtualFile);
                }
                catch (error) {
                    await modDirectory.deleteDirectory(targetDirectory.name, true);
                    throw error;
                }
                finally {
                    sevenZipModule.FS.unlink(filename);
                }
            }
            return modMeta;
        }
        catch (error) {
            cleanup();
            throw error;
        }
    }
    private readFileFromEmFs(fs: EmscriptenFS, filename: string): VirtualFile {
        const stat = fs.stat(filename);
        const fd = fs.open(filename, "r");
        try {
            const buffer = new Uint8Array(stat.size);
            let offset = 0;
            while (offset < buffer.length) {
                const bytesRead = fs.read(fd, buffer, offset, buffer.length - offset, offset);
                if (bytesRead <= 0) {
                    throw new IOError(`Couldn't read extracted file "${filename}"`);
                }
                offset += bytesRead;
            }
            return VirtualFile.fromBytes(buffer, filename);
        }
        finally {
            fs.close(fd);
        }
    }
    private async promptFolderName(existingEntries: string[]): Promise<string | undefined> {
        const baseName = "imported-mod";
        let counter = 1;
        let proposedName = baseName;
        while (existingEntries.includes(proposedName)) {
            proposedName = `${baseName}-${counter}`;
            counter++;
        }
        return proposedName;
    }
}
