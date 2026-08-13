import { MixFile } from '../../data/MixFile';
import { Engine, EngineType } from '../Engine';
import { sleep } from '../../util/time';
import { ChecksumError } from './importError/ChecksumError';
import { FileNotFoundError as GameResFileNotFoundError } from './importError/FileNotFoundError';
import { ArchiveExtractionError } from './importError/ArchiveExtractionError';
import { VirtualFile } from '../../data/vfs/VirtualFile';
import { mixDatabase } from '../mixDatabase';
import { Palette } from '../../data/Palette';
import { ShpFile } from '../../data/ShpFile';
import { ImageUtils } from '../gfx/ImageUtils';
import * as stringUtils from '../../util/string';
import { InvalidArchiveError } from './importError/InvalidArchiveError';
import { FileNotFoundError as VfsFileNotFoundError } from '../../data/vfs/FileNotFoundError';
import { IOError } from '../../data/vfs/IOError';
import { RealFileSystemDir } from '../../data/vfs/RealFileSystemDir';
import { NoWebAssemblyError } from './importError/NoWebAssemblyError';
import { HttpRequest, DownloadError } from '../../network/HttpRequest';
import { ArchiveDownloadError } from './importError/ArchiveDownloadError';
import type { Config } from '../../Config';
import type { Strings } from '../../data/Strings';
import type { DataStream } from '../../data/DataStream';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
interface SevenZipWasmModule {
    FS: any;
    callMain: (args: string[]) => void;
}
interface SevenZipWasmOptions {
    quit?: (code: number, message?: string) => void;
}
declare function createSevenZipWasm(options?: SevenZipWasmOptions): Promise<SevenZipWasmModule>;
const REQUIRED_ROOT_MIXES = ["ra2.mix", "language.mix", "multi.mix"] as const;
const OPTIONAL_ROOT_MIXES = new Set(["theme.mix"]);

function isRootFileName(filename: string): boolean {
    return !filename.includes("/") && !filename.includes("\\");
}

function collectRootResourceNames(sourceEntries: readonly string[]): string[] {
    const names = new Map<string, string>();
    const add = (filename: string): void => {
        const key = filename.toLocaleLowerCase("en-US");
        if (!names.has(key)) names.set(key, filename);
    };
    for (const filename of REQUIRED_ROOT_MIXES) add(filename);
    for (const filename of sourceEntries) {
        if (isRootFileName(filename) && /\.mix$/i.test(filename)) add(filename);
    }
    return [...names.values()].sort((left, right) => left.localeCompare(right));
}

function isLooseAudioResource(filename: string): boolean {
    return isRootFileName(filename) && (
        /^(?:audio|ares)(?:\d{2})?\.(?:bag|idx)$/i.test(filename) ||
        /\.wav$/i.test(filename)
    );
}
function formatBytes(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
}
function wrapFsOpen(originalFsOpen: any, prefilledContents: Map<string, Uint8Array>) {
    return function (this: any, path: string, flags: string, mode?: any, unknown1?: any, unknown2?: any) {
        let stream = originalFsOpen.call(this, path, flags, mode, unknown1, unknown2);
        const prefilledData = prefilledContents.get(stream.node.name);
        if (prefilledData) {
            stream.node.contents = new Uint8Array(prefilledData);
            const originalWrite = stream.stream_ops.write;
            stream.stream_ops = { ...stream.stream_ops };
            stream.stream_ops.write = function (this: any, str: any, buffer: any, offset: number, length: number, position?: number, canOwn?: boolean) {
                if (!position) {
                    str.node.usedBytes = str.node.contents.byteLength;
                }
                const bytesWritten = originalWrite.call(this, str, buffer, offset, length, position, canOwn);
                if (!position) {
                    str.node.usedBytes = bytesWritten;
                }
                return bytesWritten;
            };
        }
        return stream;
    };
}
export type ImportProgressCallback = (text?: string, backgroundImage?: Blob | string) => void;
export type ImportSource = URL | File | FileSystemDirectoryHandle | FileSystemFileHandle;
export class GameResImporter {
    private appConfig: Config;
    private strings: Strings;
    private sentry?: any;
    constructor(appConfig: Config, strings: Strings, sentry?: any) {
        this.appConfig = appConfig;
        this.strings = strings;
        this.sentry = sentry;
    }
    async import(source: ImportSource | undefined, targetRfsRootDir: RealFileSystemDir, onProgress: ImportProgressCallback): Promise<void> {
        const tauntsDirName = Engine.rfsSettings.tauntsDir;
        const S = this.strings;
        console.log('[GameResImporter] Starting import process');
        console.log('[GameResImporter] Source:', source);
        console.log('[GameResImporter] WebAssembly available:', typeof WebAssembly);
        console.log('[GameResImporter] Dynamic import supported: true');
        onProgress(S.get("ts:import_preparing_for_import"));
        if (!source) {
            throw new Error("Import source is undefined.");
        }
        if (source instanceof URL || source instanceof File || (source as any).kind === "file") {
            console.log('[GameResImporter] Processing archive file');
            if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
                throw new NoWebAssemblyError("WebAssembly is not available or not an object.");
            }
            console.log('[GameResImporter] WebAssembly check passed');
            let sevenZipModule: SevenZipWasmModule;
            let sevenZipExitCode: number | undefined;
            let sevenZipErrorMessage: string | undefined;
            try {
                console.log('[GameResImporter] Attempting to load 7z-wasm module');
                const sevenZipWasmModule = await import("7z-wasm");
                const sevenZipFactory = sevenZipWasmModule.default as any;
                console.log('[GameResImporter] 7z-wasm module loaded, creating instance');
                sevenZipModule = await sevenZipFactory({
                    locateFile: (path: string, scriptDirectory: string) => {
                        if (path === '7zz.wasm') {
                            return '/7zz.wasm';
                        }
                        return path;
                    },
                    quit: (code: number, exitStatus: any) => {
                        sevenZipExitCode = code;
                        sevenZipErrorMessage = exitStatus?.message || String(exitStatus);
                        console.log('[GameResImporter] 7z quit callback:', code, exitStatus);
                    },
                });
                console.log('[GameResImporter] 7z-wasm instance created successfully');
            }
            catch (e: any) {
                console.error('[GameResImporter] Failed to load/create 7z-wasm:', e);
                if (e.message?.match(/Load failed|Failed to fetch/i)) {
                    const error = new DownloadError("Failed to load 7z-wasm module");
                    (error as any).originalError = e;
                    throw error;
                }
                if (e instanceof WebAssembly.RuntimeError) {
                    const error = new IOError("Couldn't load 7z-wasm due to runtime error");
                    (error as any).originalError = e;
                    throw error;
                }
                throw e;
            }
            let archiveData: Uint8Array;
            let archiveName: string;
            if (source instanceof URL) {
                let downloadedBytes = 0;
                const urlStr = source.toString();
                const corsProxy = this.appConfig.getCorsProxy?.(source.hostname);
                let effectiveUrl = urlStr;
                if (corsProxy) {
                    effectiveUrl = `${corsProxy}${encodeURIComponent(urlStr)}`;
                }
                try {
                    const buffer = await new HttpRequest().fetchBinary(effectiveUrl, undefined, {
                        onProgress: (delta, total) => {
                            downloadedBytes += delta;
                            const progressText = total
                                ? S.get("ts:downloadingpgsize", formatBytes(downloadedBytes), formatBytes(total), (downloadedBytes / total) * 100)
                                : S.get("ts:downloadingpgunkn", formatBytes(downloadedBytes));
                            onProgress(progressText);
                        },
                    });
                    archiveData = new Uint8Array(buffer);
                    archiveName = source.pathname.split('/').pop() || "archive.7z";
                }
                catch (e: any) {
                    if (downloadedBytes === 0 && e instanceof DownloadError) {
                        const error = new ArchiveDownloadError(urlStr, "Archive download failed at start");
                        (error as any).originalError = e;
                        throw error;
                    }
                    throw e;
                }
            }
            else if (source instanceof File) {
                archiveData = new Uint8Array(await source.arrayBuffer());
                archiveName = source.name;
            }
            else {
                const fileHandle = source as FileSystemFileHandle;
                const file = await fileHandle.getFile();
                archiveData = new Uint8Array(await file.arrayBuffer());
                archiveName = file.name;
            }
            onProgress(S.get("ts:import_loading_archive"));
            sevenZipModule.FS.chdir("/tmp");
            try {
                const fileStream = sevenZipModule.FS.open(archiveName, "w+");
                sevenZipModule.FS.write(fileStream, archiveData, 0, archiveData.byteLength, 0, true);
                sevenZipModule.FS.close(fileStream);
            }
            catch (e: any) {
                if (e instanceof DOMException) {
                    const error = new IOError(`Could not write archive to Emscripten FS "${archiveName}" (${e.name})`);
                    (error as any).originalError = e;
                    throw error;
                }
                throw e;
            }
            const extractionPlans = [
                { entryName: "*.mix", matches: (name: string) => /\.mix$/i.test(name) },
                { entryName: "audio*.bag", matches: (name: string) => /^audio.*\.bag$/i.test(name) },
                { entryName: "audio*.idx", matches: (name: string) => /^audio.*\.idx$/i.test(name) },
                { entryName: "ares*.bag", matches: (name: string) => /^ares.*\.bag$/i.test(name) },
                { entryName: "ares*.idx", matches: (name: string) => /^ares.*\.idx$/i.test(name) },
            ];
            const importedMixes = new Set<string>();
            for (const { entryName, matches } of extractionPlans) {
                onProgress(S.get("ts:import_extracting", entryName));
                await sleep(100);
                sevenZipExitCode = undefined;
                sevenZipErrorMessage = undefined;
                sevenZipModule.callMain(["x", "-ssc-", "-aoa", archiveName, entryName]);
                if (sevenZipExitCode !== 0 && sevenZipExitCode !== undefined) {
                    if (sevenZipExitCode === 1) {
                        console.warn(`Archive entry "${entryName}" was not found or had a non-fatal extraction issue. Skipping.`);
                    }
                    else {
                        const baseErrorMsg = `7-Zip exited with code ${sevenZipExitCode} for ${entryName}`;
                        if (sevenZipErrorMessage?.match(/out of memory|allocation/i)) {
                            const error = new RangeError(`${baseErrorMsg} - Out of memory`);
                            (error as any).originalError = new Error(sevenZipErrorMessage);
                            throw error;
                        }
                        const error = new ArchiveExtractionError(`${baseErrorMsg}`);
                        (error as any).originalError = new Error(sevenZipErrorMessage);
                        throw error;
                    }
                }
                const emFsCurrentDirContents = sevenZipModule.FS.lookupPath(sevenZipModule.FS.cwd())["node"].contents;
                const extractedEntryNames = Object.keys(emFsCurrentDirContents);
                const extractedNames = extractedEntryNames.filter(matches);
                for (const extractedName of extractedNames) {
                    onProgress(S.get("ts:import_importing", extractedName));
                    try {
                        const fileData = this.readFileFromEmFs(sevenZipModule.FS, extractedName);
                        sevenZipModule.FS.unlink(extractedName);
                        if (/\.mix$/i.test(extractedName)) {
                            importedMixes.add(extractedName.toLocaleLowerCase("en-US"));
                            await this.importMixArchive(fileData, targetRfsRootDir, onProgress, S);
                        }
                        else {
                            await targetRfsRootDir.writeFile(fileData, extractedName.toLocaleLowerCase("en-US"));
                        }
                    }
                    catch (e: any) {
                        if (e.errno === 44 && entryName !== "*.mix") {
                            console.warn(`Resource "${extractedName}" disappeared from the archive extraction FS. Skipping.`);
                            continue;
                        }
                        throw new GameResFileNotFoundError(extractedName);
                    }
                }
            }
            // Multiplayer taunts are optional.  A number of retail archives
            // either omit this directory or store it as `TAUNTS`; asking 7-Zip
            // to extract the exact `Taunts` spelling can therefore produce a
            // harmless "file not found" result.  Keep this separate from the
            // required MIX extraction so that a taunt lookup can never abort
            // an otherwise valid game-resource import.
            await this.importOptionalArchiveTaunts(
                sevenZipModule,
                archiveName,
                tauntsDirName,
                targetRfsRootDir,
                onProgress,
                S,
                () => {
                    sevenZipExitCode = undefined;
                    sevenZipErrorMessage = undefined;
                },
                () => ({
                    code: sevenZipExitCode,
                    message: sevenZipErrorMessage,
                }),
            );
            await this.ensureTauntsDirectory(targetRfsRootDir, tauntsDirName);
            sevenZipModule.FS.unlink(archiveName);
            for (const requiredMix of REQUIRED_ROOT_MIXES) {
                if (!importedMixes.has(requiredMix)) {
                    throw new GameResFileNotFoundError(requiredMix);
                }
            }
            try {
                await targetRfsRootDir.openFile("ra2.mix");
            }
            catch (e) {
                if (e instanceof VfsFileNotFoundError || e instanceof IOError) {
                    onProgress(this.strings.get("GUI:LoadingEx"));
                    console.error("Essential file ra2.mix not found after import. Reloading might be necessary.");
                    throw new Error("Import verification failed: ra2.mix not found.");
                }
                throw e;
            }
        }
        else {
            const sourceDirWrapper = new RealFileSystemDir(source as FileSystemDirectoryHandle, true);
            const sourceEntries = await sourceDirWrapper.listEntries();
            const rootMixes = collectRootResourceNames(sourceEntries);
            for (const mixName of rootMixes) {
                onProgress(S.get("ts:import_importing", mixName));
                const actualFileName = sourceEntries.find(entry => stringUtils.equalsIgnoreCase(entry, mixName)) || mixName;
                let virtualFile;
                try {
                    virtualFile = await sourceDirWrapper.openFile(actualFileName);
                }
                catch (e: any) {
                    if (e instanceof VfsFileNotFoundError) {
                        if (OPTIONAL_ROOT_MIXES.has(mixName.toLocaleLowerCase("en-US")) || !REQUIRED_ROOT_MIXES.some((required) => stringUtils.equalsIgnoreCase(required, mixName))) {
                            console.warn(`Optional Mix file "${mixName}" not found in source directory. Skipping.`);
                            continue;
                        }
                        throw new GameResFileNotFoundError(mixName);
                    }
                    throw e;
                }
                await this.importMixArchive(virtualFile, targetRfsRootDir, onProgress, S);
            }
            for (const resourceName of sourceEntries.filter(isLooseAudioResource)) {
                const actualFileName = sourceEntries.find(entry => stringUtils.equalsIgnoreCase(entry, resourceName)) || resourceName;
                try {
                    onProgress(S.get("ts:import_importing", actualFileName));
                    const virtualFile = await sourceDirWrapper.openFile(actualFileName);
                    await targetRfsRootDir.writeFile(virtualFile, actualFileName.toLocaleLowerCase("en-US"));
                }
                catch (e: any) {
                    if (e instanceof VfsFileNotFoundError) {
                        console.warn(`Loose audio resource "${actualFileName}" disappeared during import. Skipping.`);
                        continue;
                    }
                    throw e;
                }
            }
            const tauntsDirInSource = sourceEntries.find(entry => stringUtils.equalsIgnoreCase(entry, tauntsDirName)) || tauntsDirName;
            let sourceTauntsDir: RealFileSystemDir | undefined;
            try {
                sourceTauntsDir = await sourceDirWrapper.getDirectory(tauntsDirInSource);
            }
            catch (e: any) {
                if (!(e instanceof VfsFileNotFoundError || e instanceof IOError || e instanceof DOMException))
                    throw e;
                console.warn(`Taunts directory "${tauntsDirInSource}" not found in source (${e.name}). Skipping.`);
            }
            if (sourceTauntsDir) {
                try {
                    const targetTauntsRfsDir = await targetRfsRootDir.getOrCreateDirectory(tauntsDirName, true);
                    for await (const rawFile of sourceTauntsDir.getRawFiles()) {
                        onProgress(S.get("ts:import_importing", `${targetTauntsRfsDir.name}/${rawFile.name}`));
                        const virtualFile = await VirtualFile.fromRealFile(rawFile);
                        await targetTauntsRfsDir.writeFile(virtualFile);
                    }
                }
                catch (e: any) {
                    if (!(e instanceof IOError || e instanceof DOMException))
                        throw e;
                    console.warn("Failed to copy taunts folder from source. Skipping.", e);
                }
            }
            await this.ensureTauntsDirectory(targetRfsRootDir, tauntsDirName);
        }
        onProgress("Game assets successfully imported.");
    }

    /**
     * Keep the optional multiplayer-audio namespace present after every
     * import. Some storage adapters do not preserve empty directories, so
     * recreating it here prevents a later taunt lookup from being mistaken
     * for a missing required game file.
     */
    private async ensureTauntsDirectory(targetRfsRootDir: RealFileSystemDir, tauntsDirName: string): Promise<void> {
        try {
            await targetRfsRootDir.getOrCreateDirectory(tauntsDirName, true);
        }
        catch (e) {
            // Taunts are optional. A stale file with the same name, or a
            // read-only storage adapter, must not invalidate the core import.
            console.warn(`Could not recreate optional taunts directory "${tauntsDirName}"; continuing without taunts.`, e);
        }
    }

    private async importOptionalArchiveTaunts(
        sevenZipModule: SevenZipWasmModule,
        archiveName: string,
        tauntsDirName: string,
        targetRfsRootDir: RealFileSystemDir,
        onProgress: ImportProgressCallback,
        S: Strings,
        resetExitState: () => void,
        getExitState: () => { code: number | undefined; message: string | undefined },
    ): Promise<void> {
        resetExitState();
        try {
            sevenZipModule.callMain(["x", "-ssc-", "-aoa", archiveName, tauntsDirName]);
        }
        catch (e) {
            console.warn("Optional taunts extraction failed; continuing without taunts.", e);
            return;
        }
        // 7-Zip uses exit code 1 for a missing optional entry.  Other errors
        // are also non-fatal here because taunts are not needed to start a
        // single-player game and should never mask a successful core import.
        const exitState = getExitState();
        if (exitState.code !== undefined && exitState.code !== 0) {
            console.warn(`Optional taunts archive entry was not imported (7-Zip exit ${exitState.code}). Continuing without taunts.`, exitState.message);
            return;
        }
        let extractedEntryNames: string[];
        try {
            const cwdNode = sevenZipModule.FS.lookupPath(sevenZipModule.FS.cwd())["node"];
            extractedEntryNames = Object.keys(cwdNode?.contents ?? {});
        }
        catch (e) {
            console.warn("Optional taunts directory could not be inspected; continuing without taunts.", e);
            return;
        }
        const tauntsDirInFs = extractedEntryNames.find(name => stringUtils.equalsIgnoreCase(name, tauntsDirName));
        if (!tauntsDirInFs) {
            return;
        }
        let tauntsDirNode: any;
        try {
            tauntsDirNode = sevenZipModule.FS.lookupPath(tauntsDirInFs)["node"];
        }
        catch (e) {
            console.warn(`Optional taunts directory "${tauntsDirInFs}" could not be opened; continuing without taunts.`, e);
            return;
        }
        const tauntsContents = tauntsDirNode?.contents;
        if (!tauntsContents || ArrayBuffer.isView(tauntsContents) || tauntsContents instanceof ArrayBuffer) {
            console.warn(`Optional archive entry "${tauntsDirInFs}" is not a directory; continuing without taunts.`);
            return;
        }
        const tauntFileNames = Object.keys(tauntsContents)
            .filter(name => /\.wav$/i.test(name))
            .map(name => `${tauntsDirInFs}/${name}`);
        if (tauntFileNames.length === 0) {
            return;
        }
        try {
            const targetTauntsDir = await targetRfsRootDir.getOrCreateDirectory(tauntsDirName, true);
            for (const tauntFilePath of tauntFileNames) {
                onProgress(S.get("ts:import_importing", tauntFilePath));
                try {
                    const fileData = this.readFileFromEmFs(sevenZipModule.FS, tauntFilePath);
                    sevenZipModule.FS.unlink(tauntFilePath);
                    await targetTauntsDir.writeFile(fileData);
                }
                catch (e) {
                    console.warn(`Optional taunt "${tauntFilePath}" could not be copied; continuing without it.`, e);
                }
            }
        }
        catch (e) {
            console.warn("Failed to copy optional taunts; continuing without taunts.", e);
        }
    }

    private readFileFromEmFs(emFs: any, filePath: string): VirtualFile {
        emFs.chmod(filePath, 0o700);
        const fileNode = emFs.lookupPath(filePath)["node"];
        if (!fileNode || !fileNode.contents) {
            throw new VfsFileNotFoundError(`File node or contents missing in Emscripten FS for ${filePath}`);
        }
        const fileData = fileNode.contents.subarray(0, fileNode.usedBytes);
        const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
        return VirtualFile.fromBytes(fileData, fileName);
    }
    private async importMixArchive(mixVirtualFile: VirtualFile, targetRfsRootDir: RealFileSystemDir, onProgress: ImportProgressCallback, S: Strings): Promise<void> {
        const mixFileNameLower = mixVirtualFile.filename.toLowerCase();
        const isThemeMix = !!mixFileNameLower.match(/^theme[^.]*\.mix$/);
        if (mixVirtualFile.getSize() === 0) {
            if (isThemeMix) {
                console.warn(`Mix file ${mixVirtualFile.filename} is empty. Skipping theme import.`);
                return;
            }
            throw new ChecksumError(`Mix file "${mixFileNameLower}" is empty`, mixFileNameLower);
        }
        if (!isThemeMix) {
            await targetRfsRootDir.writeFile(mixVirtualFile, mixFileNameLower);
        }
        if (isThemeMix) {
            const musicDirName = Engine.rfsSettings.musicDir;
            const targetMusicDir = await targetRfsRootDir.getOrCreateDirectory(musicDirName, true);
            await this.importMusic(mixVirtualFile, targetMusicDir, (percent) => onProgress(S.get("ts:import_importing_pg", mixFileNameLower, percent.toFixed(0))));
        }
        else if (mixFileNameLower.match(/^(?:language|langmd)\.mix$/)) {
            onProgress(S.get("ts:import_importing_long", mixFileNameLower));
            onProgress(S.get("ts:import_storing_video"));
            await this.importVideo(mixVirtualFile, targetRfsRootDir);
        }
        else if (mixFileNameLower.match(/ra2\.mix$/)) {
            const splashImageBlob = await this.importSplashImage(mixVirtualFile, targetRfsRootDir);
            if (splashImageBlob)
                onProgress(undefined, splashImageBlob);
        }
    }
    private async importMusic(mixVirtualFile: VirtualFile, targetMusicDir: RealFileSystemDir, onProgressPercent: (percent: number) => void): Promise<void> {
        let mixFileInstance: MixFile;
        try {
            mixFileInstance = new MixFile(mixVirtualFile.stream as DataStream);
        }
        catch (e) {
            console.warn(`Failed to read music mix archive "${mixVirtualFile.filename}". Skipping.`, e);
            return;
        }
        const knownMusicFiles = mixDatabase.get(mixVirtualFile.filename.toLowerCase());
        if (!knownMusicFiles) {
            console.warn(`File "${mixVirtualFile.filename}" not found in mix database. Skipping music import.`);
            return;
        }
        const totalFiles = knownMusicFiles.length;
        let processedFiles = 0;
        for (const wavFileNameInMix of knownMusicFiles) {
            processedFiles++;
            onProgressPercent((processedFiles / totalFiles) * 100);
            if (!wavFileNameInMix.toLowerCase().endsWith('.wav')) {
                console.warn(`Music file "${wavFileNameInMix}" in mix ${mixVirtualFile.filename} is not a WAV file. Skipping.`);
                continue;
            }
            const mp3FileName = wavFileNameInMix.replace(/\.wav$/i, ".mp3");
            if (mixFileInstance.containsFile(wavFileNameInMix)) {
                const wavFileEntry = mixFileInstance.openFile(wavFileNameInMix);
                if (wavFileEntry.stream.byteLength > 0) {
                    let mp3Data: Uint8Array | undefined;
                    try {
                        const ffmpeg = await this.createFFmpeg();
                        const wavData = new Uint8Array(wavFileEntry.stream.buffer, wavFileEntry.stream.byteOffset, wavFileEntry.stream.byteLength);
                        await ffmpeg.writeFile(wavFileNameInMix, wavData);
                        await ffmpeg.exec(["-i", wavFileNameInMix, "-vn", "-ar", "22050", "-q:a", "5", mp3FileName]);
                        mp3Data = await ffmpeg.readFile(mp3FileName) as Uint8Array;
                        await ffmpeg.deleteFile(wavFileNameInMix);
                        await ffmpeg.deleteFile(mp3FileName);
                    }
                    catch (e) {
                        console.warn(`Failed to convert music file "${wavFileNameInMix}" to MP3. Skipping.`, e);
                        this.sentry?.captureException(new Error(`FFmpeg conversion failed for ${wavFileNameInMix}`), { extra: { error: e } });
                        continue;
                    }
                    if (mp3Data) {
                        const mp3Blob = new Blob([mp3Data as any], { type: "audio/mpeg" });
                        try {
                            const virtualMp3 = VirtualFile.fromBytes(mp3Data, mp3FileName);
                            await targetMusicDir.writeFile(virtualMp3);
                        }
                        catch (e) {
                            console.warn(`Failed to write music file "${mp3FileName}" to target. Skipping.`, e);
                        }
                    }
                }
                else {
                    console.warn(`Music file "${wavFileNameInMix}" is empty in the mix archive. Skipping.`);
                }
            }
            else {
                console.warn(`Music file "${wavFileNameInMix}" was not found in mix archive "${mixVirtualFile.filename}". Skipping.`);
            }
        }
    }
    /**
     * Keep the retail Bink menu movie in origin-private storage. Older builds
     * stored a transcoded WebM, so those files remain valid during migration.
     */
    async ensureMenuVideo(targetRfsRootDir: RealFileSystemDir, onProgress?: (text?: string) => void): Promise<boolean> {
        const binkFileName = Engine.getMenuVideoFileName();
        const legacyVideoNames = Engine.getActiveEngine() === EngineType.YurisRevenge
            ? ["ra2ts_l_yr.webm", "ra2ts_l.webm"]
            : ["ra2ts_l.webm", "ra2ts_l_yr.webm"];
        if (await targetRfsRootDir.containsEntry(binkFileName)) {
            return true;
        }
        for (const legacyVideoName of legacyVideoNames) {
            if (await targetRfsRootDir.containsEntry(legacyVideoName)) {
                return true;
            }
        }
        let languageMixVirtualFile: VirtualFile | undefined;
        const sourceMixes = Engine.getActiveEngine() === EngineType.YurisRevenge
            ? ["langmd.mix", "language.mix"]
            : ["language.mix"];
        let sourceMixName: string | undefined;
        for (const candidate of sourceMixes) {
            try {
                languageMixVirtualFile = await targetRfsRootDir.openFile(candidate);
                sourceMixName = candidate;
                break;
            }
            catch (e) {
                if (!(e instanceof VfsFileNotFoundError)) {
                    throw e;
                }
            }
        }
        if (!sourceMixName || !languageMixVirtualFile) {
            console.warn(`[GameResImporter] None of ${sourceMixes.join(', ')} is available; cannot repair menu video`);
            return false;
        }
        console.info(`[GameResImporter] Preparing ${EngineType[Engine.getActiveEngine()]} menu video from ${sourceMixName}`);
        onProgress?.(this.strings.get("ts:import_storing_video"));
        await this.importVideo(languageMixVirtualFile, targetRfsRootDir);
        if (await targetRfsRootDir.containsEntry(binkFileName)) {
            return true;
        }
        for (const legacyVideoName of legacyVideoNames) {
            if (await targetRfsRootDir.containsEntry(legacyVideoName)) {
                return true;
            }
        }
        return false;
    }

    private async importVideo(
        languageMixVirtualFile: VirtualFile,
        targetRfsRootDir: RealFileSystemDir,
    ): Promise<void> {
        const langMix = new MixFile(languageMixVirtualFile.stream as DataStream);
        const binkFileName = Engine.getMenuVideoFileName();
        const videoFileVariants = [
            'ra2ts_l.bik', 'RA2TS_L.BIK', 'Ra2ts_l.bik', 'RA2TS_L.bik'
        ];
        console.log('[GameResImporter] Testing video file variants:');
        let foundVideoFile = false;
        let actualVideoFileName = binkFileName;
        for (const variant of videoFileVariants) {
            const exists = langMix.containsFile(variant);
            console.log(`[GameResImporter]   "${variant}" exists: ${exists}`);
            if (exists && !foundVideoFile) {
                foundVideoFile = true;
                actualVideoFileName = variant;
            }
        }
        if (!foundVideoFile) {
            console.warn(`Video file "${binkFileName}" not found in ${languageMixVirtualFile.filename}, skipping menu video import`);
            return;
        }
        console.log(`[GameResImporter] Using video file: "${actualVideoFileName}"`);
        const binkFileEntry = langMix.openFile(actualVideoFileName);
        const binkBytes = binkFileEntry.getBytes();
        if (binkBytes.byteLength === 0) {
            console.warn(`[GameResImporter] Bink video "${actualVideoFileName}" is empty; skipping menu video import`);
            return;
        }
        const virtualBinkFile = VirtualFile.fromBytes(binkBytes, binkFileName);
        await targetRfsRootDir.writeFile(virtualBinkFile);
        console.log(`[GameResImporter] ✅ Stored original menu video "${binkFileName}" (${binkBytes.byteLength} bytes)`);
    }
    private async createFFmpeg(): Promise<FFmpeg> {
        const ffmpegModule = await import("@ffmpeg/ffmpeg");
        const FFmpegClass = ffmpegModule.FFmpeg;
        if (typeof FFmpegClass !== 'function') {
            console.error('[GameResImporter] FFmpeg class is not available:', typeof FFmpegClass);
            throw new Error('FFmpeg class is not available from @ffmpeg/ffmpeg module');
        }
        const ffmpeg = new FFmpegClass();
        const originalDefine = (window as any).define;
        (window as any).define = undefined;
        try {
            const coreBaseUrl = new URL("/ffmpeg/", window.location.origin).toString();
            await ffmpeg.load({
                coreURL: `${coreBaseUrl}ffmpeg-core.js`,
                wasmURL: `${coreBaseUrl}ffmpeg-core.wasm`,
            });
        }
        finally {
            (window as any).define = originalDefine;
        }
        return ffmpeg;
    }
    private async importSplashImage(ra2MixVirtualFile: VirtualFile, targetRfsRootDir: RealFileSystemDir): Promise<Blob | undefined> {
        console.log('[GameResImporter] Starting splash image import from ra2.mix...');
        const ra2Mix = new MixFile(ra2MixVirtualFile.stream as DataStream);
        if (!ra2Mix.containsFile("local.mix")) {
            throw new GameResFileNotFoundError("local.mix");
        }
        console.log('[GameResImporter] Found local.mix, opening...');
        const localMixFile = ra2Mix.openFile("local.mix");
        const localMix = new MixFile(localMixFile.stream);
        if (!localMix.containsFile("glsl.shp")) {
            throw new GameResFileNotFoundError("glsl.shp");
        }
        if (!localMix.containsFile("gls.pal")) {
            throw new GameResFileNotFoundError("gls.pal");
        }
        console.log('[GameResImporter] Found glsl.shp and gls.pal, extracting...');
        const glslShpFile = localMix.openFile("glsl.shp");
        const glsPalFile = localMix.openFile("gls.pal");
        console.log('[GameResImporter] Parsing SHP and palette...');
        const shpFile = new ShpFile(glslShpFile);
        const palette = new Palette(glsPalFile);
        console.log('[GameResImporter] Converting SHP to PNG...');
        const pngBlob = await ImageUtils.convertShpToPng(shpFile, palette);
        const splashImgFileName = Engine.rfsSettings.splashImgFileName;
        console.log(`[GameResImporter] Creating file "${splashImgFileName}" for RFS...`);
        let splashFile: File | undefined;
        try {
            splashFile = new File([pngBlob], splashImgFileName, { type: pngBlob.type });
        }
        catch (e) {
            console.error('[GameResImporter] Failed to create splash image file. Skipping.', e);
            this.sentry?.captureException(new Error(`Failed to create splash image file (type=${pngBlob.type})`), { extra: { error: e } });
        }
        if (splashFile) {
            console.log(`[GameResImporter] Writing "${splashImgFileName}" to RFS...`);
            const virtualSplashFile = VirtualFile.fromBytes(new Uint8Array(await splashFile.arrayBuffer()), splashImgFileName);
            await targetRfsRootDir.writeFile(virtualSplashFile);
            console.log(`[GameResImporter] ✅ Successfully wrote "${splashImgFileName}" to RFS`);
        }
        return pngBlob;
    }
}
