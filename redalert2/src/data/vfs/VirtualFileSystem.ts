import { AudioBagFile } from "../AudioBagFile";
import { IdxFile } from "../IdxFile";
import { MixFile } from "../MixFile";
import { EngineType } from "../../engine/EngineType";
import { pad } from "../../util/string";
import { FileNotFoundError } from "./FileNotFoundError";
import { MemArchive } from "./MemArchive";
import type { VirtualFile } from "./VirtualFile";
import type { RealFileSystem } from "./RealFileSystem";
import { normalizeGamePath } from "../../engine/GamePath";
import type { GameProfileDescriptor, GameProfileId } from "../../engine/GameProfile";
import { ResourceLayer, type ResourceSource } from "./ResourceLayer";
interface VfsLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
export interface Archive {
    containsFile(filename: string): boolean;
    openFile(filename: string): VirtualFile;
    listFiles?: () => string[];
}

export interface ArchiveMetadata {
    id?: string;
    layer?: ResourceLayer;
    priority?: number;
    source?: ResourceSource;
    profile?: GameProfileId;
}

export interface ArchiveDescriptor {
    id: string;
    filename: string;
    layer: ResourceLayer;
    priority: number;
    source: ResourceSource;
    profile?: GameProfileId;
}

export interface VfsResolutionCandidate {
    archive: string;
    layer: ResourceLayer;
    priority: number;
    source: ResourceSource;
    profile?: GameProfileId;
}

export interface VfsResolution {
    requested: string;
    normalized: string;
    found: boolean;
    winner?: VfsResolutionCandidate;
    shadowed: VfsResolutionCandidate[];
}

interface ArchiveRecord {
    archive: Archive;
    descriptor: ArchiveDescriptor;
    order: number;
}

export class VirtualFileSystem {
    private rfs: RealFileSystem;
    private logger: VfsLogger;
    private allArchives: Map<string, ArchiveRecord>;
    private archivesByPriority: ArchiveRecord[];
    private nextArchiveOrder = 0;
    constructor(rfs: RealFileSystem, logger: VfsLogger) {
        this.rfs = rfs;
        this.logger = logger;
        this.allArchives = new Map<string, ArchiveRecord>();
        this.archivesByPriority = [];
    }
    private containsFileDirect(filename: string): boolean {
        const normalized = normalizeGamePath(filename);
        for (const record of this.archivesByPriority) {
            if (record.archive.containsFile(normalized)) {
                return true;
            }
        }
        return false;
    }
    private resolveFilename(filename: string): string {
        return normalizeGamePath(filename);
    }
    fileExists(filename: string): boolean {
        return this.containsFileDirect(this.resolveFilename(filename));
    }
    openFile(filename: string): VirtualFile {
        const resolvedFilename = this.resolveFilename(filename);
        for (const record of this.archivesByPriority) {
            if (record.archive.containsFile(resolvedFilename)) {
                return record.archive.openFile(resolvedFilename);
            }
        }
        throw new FileNotFoundError(`File "${filename}" not found in VFS`);
    }
    addArchive(archive: Archive, name: string, metadata: ArchiveMetadata = {}): void {
        const key = name.toLocaleLowerCase("en-US");
        if (!this.allArchives.has(key)) {
            const layer = metadata.layer ?? ResourceLayer.BaseGame;
            const record: ArchiveRecord = {
                archive,
                order: this.nextArchiveOrder++,
                descriptor: {
                    id: metadata.id ?? name,
                    filename: name,
                    layer,
                    // Unannotated archives retain the historical insertion
                    // order. Annotated archives use their explicit layer.
                    priority: metadata.priority ?? (metadata.layer === undefined ? 0 : layer),
                    source: metadata.source ?? "game",
                    profile: metadata.profile,
                },
            };
            this.allArchives.set(key, record);
            this.archivesByPriority.push(record);
            this.archivesByPriority.sort((a, b) =>
                b.descriptor.priority - a.descriptor.priority || a.order - b.order);
            this.logger.info(`Added archive "${name}" to VFS`);
        }
    }
    hasArchive(name: string): boolean {
        return this.allArchives.has(name.toLocaleLowerCase("en-US"));
    }
    getArchive(name: string): Archive | undefined {
        return this.allArchives.get(name.toLocaleLowerCase("en-US"))?.archive;
    }
    removeArchive(name: string): void {
        const key = name.toLocaleLowerCase("en-US");
        const record = this.allArchives.get(key);
        if (record) {
            this.allArchives.delete(key);
            const index = this.archivesByPriority.indexOf(record);
            if (index > -1) {
                this.archivesByPriority.splice(index, 1);
            }
            this.logger.info(`Removed archive "${name}" from VFS`);
        }
    }
    listArchives(): string[] {
        return [...this.allArchives.values()].map((record) => record.descriptor.filename);
    }
    listFiles(): string[] {
        const files = new Set<string>();
        for (const record of this.archivesByPriority) {
            for (const filename of record.archive.listFiles?.() ?? []) {
                files.add(filename);
            }
        }
        return [...files];
    }
    resolve(filename: string): VfsResolution {
        const normalized = this.resolveFilename(filename);
        const candidates: VfsResolutionCandidate[] = [];
        for (const record of this.archivesByPriority) {
            try {
                if (record.archive.containsFile(normalized)) {
                    candidates.push({
                        archive: record.descriptor.filename,
                        layer: record.descriptor.layer,
                        priority: record.descriptor.priority,
                        source: record.descriptor.source,
                        profile: record.descriptor.profile,
                    });
                }
            }
            catch {
                // A hash-only/partially indexed archive may reject malformed
                // names. It should not prevent other overlays from resolving.
            }
        }
        return {
            requested: filename,
            normalized,
            found: candidates.length > 0,
            winner: candidates[0],
            shadowed: candidates.slice(1),
        };
    }
    explain(filename: string): VfsResolution {
        return this.resolve(filename);
    }
    debugListFileOwners(filename: string): string[] {
        const resolution = this.resolve(filename);
        return [
            ...(resolution.winner ? [resolution.winner.archive] : []),
            ...resolution.shadowed.map((candidate) => candidate.archive),
        ];
    }
    private async openFileWithRfs(filename: string): Promise<VirtualFile | undefined> {
        let file: VirtualFile | undefined;
        try {
            file = await this.rfs.openFile(filename);
        }
        catch (e) {
            if (!(e instanceof FileNotFoundError)) {
                throw e;
            }
        }
        if (!file) {
            if (!this.fileExists(filename)) {
                this.logger.warn(`File "${filename}" not found in VFS, returning undefined`);
                return undefined;
            }
            file = this.openFile(filename);
        }
        return file;
    }
    private async addArchiveByFilename(filename: string, createArchive: (file: VirtualFile) => Archive | Promise<Archive>, metadata?: ArchiveMetadata): Promise<void> {
        if (this.hasArchive(filename)) {
            this.logger.info(`Archive "${filename}" already loaded, skipping.`);
            return;
        }
        const virtualFile = await this.openFileWithRfs(filename);
        if (virtualFile) {
            try {
                const archive = await createArchive(virtualFile);
                this.addArchive(archive, filename, metadata ?? this.metadataForMix(filename));
            }
            catch (error) {
                this.logger.error(`Failed to create archive from "${filename}":`, error);
            }
        }
        else {
            this.logger.warn(`Could not open "${filename}" via RFS to add as archive.`);
        }
    }
    private metadataForMix(filename: string): ArchiveMetadata {
        const lower = filename.toLocaleLowerCase("en-US");
        if (/^(?:ecache|expand|elocal)(?:md|mo)?\d{2}\.mix$/.test(lower)) {
            return { layer: ResourceLayer.ModPatch, source: "mod" };
        }
        if (lower.includes("cd") || lower === "ra2cd.mix") {
            return { layer: ResourceLayer.ExtensionRuntime, source: "engine" };
        }
        if (lower.includes("md")) {
            return { layer: ResourceLayer.Expansion, source: "game" };
        }
        return { layer: ResourceLayer.BaseGame, source: "game" };
    }
    async addMixFile(filename: string, metadata?: ArchiveMetadata): Promise<void> {
        await this.addArchiveByFilename(filename, async (fileStreamHolder) => {
            if (filename === "ra2.mix") {
                this.logger.info(`Testing original MixFile implementation for ${filename}...`);
                try {
                    this.logger.info(`Original MixFile created successfully for ${filename}`);
                }
                catch (error) {
                    this.logger.error(`Original MixFile failed for ${filename}:`, error);
                }
                fileStreamHolder.stream.seek(0);
            }
            return new MixFile(fileStreamHolder.stream);
        }, metadata);
    }
    async addBagFile(filename: string): Promise<void> {
        const idxFilename = filename.replace(/\.bag$/i, ".idx");
        try {
            const idxFile = await this.openFileWithRfs(idxFilename);
            if (!idxFile) {
                this.logger.error(`IDX file "${idxFilename}" not found for BAG file "${filename}".`);
                return;
            }
            await this.addArchiveByFilename(filename, async (bagVirtualFile) => {
                const idxData = new IdxFile(idxFile.stream);
                const audioBag = new AudioBagFile();
                await audioBag.fromVirtualFile(bagVirtualFile, idxData);
                return audioBag;
            }, this.metadataForMix(filename));
        }
        catch (error) {
            this.logger.error(`Failed to add BAG file "${filename}":`, error);
        }
    }
    async loadImplicitMixFiles(engineType: EngineType): Promise<void> {
        this.logger.info("Initializing implicit mix files...");
        const YR = engineType === EngineType.YurisRevenge;
        if (YR)
            await this.addMixFile("langmd.mix");
        await this.addMixFile("language.mix");
        if (YR)
            await this.addMixFile("ra2md.mix");
        await this.addMixFile("ra2.mix");
        if (YR)
            await this.addMixFile("cachemd.mix");
        await this.addMixFile("cache.mix");
        if (YR)
            await this.addMixFile("loadmd.mix");
        await this.addMixFile("load.mix");
        if (YR)
            await this.addMixFile("localmd.mix");
        await this.addMixFile("local.mix");
        if (YR)
            await this.addMixFile("ntrlmd.mix");
        await this.addMixFile("neutral.mix");
        if (YR)
            await this.addMixFile("audiomd.mix");
        await this.addMixFile("audio.mix");
        await this.addBagFile("audio.bag");
        await this.addMixFile("conquer.mix");
        if (YR) {
            await this.addMixFile("conqmd.mix");
            await this.addMixFile("genermd.mix");
        }
        await this.addMixFile("generic.mix");
        if (YR)
            await this.addMixFile("isogenmd.mix");
        await this.addMixFile("isogen.mix");
        if (YR)
            await this.addMixFile("cameomd.mix");
        await this.addMixFile("cameo.mix");
        await this.addMixFile("cameocd.mix");
        if (YR)
            await this.addMixFile("multimd.mix");
        await this.addMixFile("multi.mix");
        this.logger.info("Finished initializing implicit mix files.");
    }
    async loadExtraMixFiles(engineType: EngineType, profile?: GameProfileDescriptor): Promise<void> {
        this.logger.info("Loading extra mix files...");
        const rfsEntries = new Set<string>();
        for await (const entry of this.rfs.getEntriesRecursive()) {
            rfsEntries.add(entry.toLowerCase());
        }
        const findEntryByLeaf = (filename: string): string | undefined => {
            const expected = filename.toLocaleLowerCase("en-US");
            const matches = [...rfsEntries].filter((entry) => entry.split("/").pop() === expected);
            return matches.sort((a, b) => a.length - b.length)[0];
        };
        const prefixes = ["ecache", "expand", "elocal"];
        for (const prefix of prefixes) {
            for (let i = 99; i >= 0; i--) {
                const numStr = pad(i, "00");
                const baseFilename = `${prefix}${numStr}.mix`;
                const mdFilename = `${prefix}md${numStr}.mix`;
                const moFilename = `${prefix}mo${numStr}.mix`;
                const filesToTry: string[] = [];
                if (profile?.id === "mental-omega") {
                    filesToTry.push(moFilename);
                }
                if (engineType === EngineType.YurisRevenge) {
                    filesToTry.push(mdFilename);
                }
                filesToTry.push(baseFilename);
                for (const fileToTry of filesToTry) {
                    const rfsEntry = findEntryByLeaf(fileToTry);
                    if (rfsEntry) {
                        if (!this.hasArchive(rfsEntry)) {
                            await this.addMixFile(rfsEntry, {
                                layer: fileToTry.includes("mo")
                                    ? ResourceLayer.ModPatch
                                    : fileToTry.includes("md")
                                        ? ResourceLayer.ModCore
                                        : ResourceLayer.ModPatch,
                                source: "mod",
                                profile: profile?.id,
                                id: fileToTry,
                            });
                        }
                    }
                }
            }
        }
        const mapExtensions = [".mmx"];
        if (engineType === EngineType.YurisRevenge) {
            mapExtensions.push(".yro");
        }
        for (const ext of mapExtensions) {
            for (const rfsFile of rfsEntries) {
                if (rfsFile.endsWith(ext)) {
                    if (!this.hasArchive(rfsFile)) {
                        const fileData = await this.rfs.openFile(rfsFile);
                        if (fileData) {
                            this.addArchive(new MixFile(fileData.stream), rfsFile, {
                                layer: ResourceLayer.MapOverride,
                                source: "map",
                                profile: profile?.id,
                            });
                        }
                        else {
                            this.logger.warn(`Could not open RFS file ${rfsFile} for map archive loading.`);
                        }
                    }
                }
            }
        }
        this.logger.info("Finished loading extra mix files.");
    }
    async loadStandaloneFiles(options?: {
        exclude?: string[];
    }): Promise<void> {
        this.logger.info("Loading standalone files into mem.archive...");
        const extensionsToLoad = ["ini", "csf"];
        const excludeSet = new Set<string>((options?.exclude || []).map(f => f.toLowerCase()));
        const filesForMemArchive: VirtualFile[] = [];
        for await (const entryName of this.rfs.getEntriesRecursive()) {
            const lowerEntryName = entryName.toLowerCase();
            if (extensionsToLoad.some((ext) => lowerEntryName.endsWith("." + ext)) &&
                !excludeSet.has(lowerEntryName)) {
                try {
                    const file = await this.rfs.openFile(entryName);
                    if (file) {
                        filesForMemArchive.push(file);
                    }
                }
                catch (e) {
                    if (e instanceof FileNotFoundError) {
                        this.logger.warn(`Standalone file ${entryName} not found during VFS loadStandaloneFiles.`);
                    }
                    else {
                        throw e;
                    }
                }
            }
        }
        if (filesForMemArchive.length > 0) {
            const memArchive = new MemArchive();
            for (const vf of filesForMemArchive) {
                memArchive.addFile(vf);
            }
            this.addArchive(memArchive, "mem.archive", {
                layer: ResourceLayer.LooseOverride,
                source: "mod",
                profile: undefined,
            });
            this.logger.info(`Added ${filesForMemArchive.length} standalone files to mem.archive`);
        }
        else {
            this.logger.info("No standalone files found or added to mem.archive.");
        }
    }
}
