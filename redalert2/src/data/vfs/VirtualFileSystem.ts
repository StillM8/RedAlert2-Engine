import { AudioBagFile } from "../AudioBagFile";
import { IdxFile } from "../IdxFile";
import { MixFile } from "../MixFile";
import { EngineType } from "../../engine/EngineType";
import { pad } from "../../util/string";
import { FileNotFoundError } from "./FileNotFoundError";
import { MemArchive } from "./MemArchive";
import { VirtualFile } from "./VirtualFile";
import type { RealFileSystem } from "./RealFileSystem";
import { gamePathKey, gamePathLeaf, normalizeGamePath, tryNormalizeGamePath } from "../../engine/GamePath";
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
    /** Resource path(s) used to reach this archive, including nested MIX parents. */
    provenance?: readonly string[];
}

export interface ArchiveDescriptor {
    id: string;
    filename: string;
    layer: ResourceLayer;
    priority: number;
    source: ResourceSource;
    profile?: GameProfileId;
    provenance: readonly string[];
}

export interface VfsResolutionCandidate {
    archive: string;
    layer: ResourceLayer;
    priority: number;
    source: ResourceSource;
    profile?: GameProfileId;
    provenance: readonly string[];
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

interface RfsEntryIndex {
    byPath: Map<string, string[]>;
    byLeaf: Map<string, string[]>;
}

function compareResourcePaths(a: string, b: string): number {
    if (a.length !== b.length) {
        return a.length - b.length;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

export class VirtualFileSystem {
    private rfs?: RealFileSystem;
    private logger: VfsLogger;
    private allArchives: Map<string, ArchiveRecord>;
    private archivesByPriority: ArchiveRecord[];
    private nextArchiveOrder = 0;
    private rfsEntryIndex?: Promise<RfsEntryIndex>;
    constructor(rfs: RealFileSystem | undefined, logger: VfsLogger) {
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
        const normalizedName = normalizeGamePath(name);
        const key = gamePathKey(normalizedName);
        if (!this.allArchives.has(key)) {
            const layer = metadata.layer ?? ResourceLayer.BaseGame;
            const provenance = [
                ...(metadata.provenance ?? []),
                normalizedName,
            ];
            const record: ArchiveRecord = {
                archive,
                order: this.nextArchiveOrder++,
                descriptor: {
                    id: metadata.id ?? normalizedName,
                    filename: normalizedName,
                    layer,
                    // Unannotated archives retain the historical insertion
                    // order. Annotated archives use their explicit layer.
                    priority: metadata.priority ?? (metadata.layer === undefined ? 0 : layer),
                    source: metadata.source ?? "game",
                    profile: metadata.profile,
                    provenance,
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
        return this.allArchives.has(gamePathKey(name));
    }
    getArchive(name: string): Archive | undefined {
        return this.allArchives.get(gamePathKey(name))?.archive;
    }
    removeArchive(name: string): void {
        const key = gamePathKey(name);
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
    /**
     * Return the cached imported-storage inventory used by loose-resource
     * loading. Consumers such as map discovery must reuse this index instead
     * of enumerating Android's directory handles a second time during boot.
     */
    async listRfsFiles(): Promise<string[]> {
        const index = await this.getRfsEntryIndex();
        return [...new Set([...index.byPath.values()].flat())].sort(compareResourcePaths);
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
                        provenance: record.descriptor.provenance,
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
    private async getRfsEntryIndex(): Promise<RfsEntryIndex> {
        if (!this.rfs) {
            return { byPath: new Map(), byLeaf: new Map() };
        }
        if (!this.rfsEntryIndex) {
            this.rfsEntryIndex = (async () => {
                const byPath = new Map<string, string[]>();
                const byLeaf = new Map<string, string[]>();
                for await (const entry of this.rfs!.getEntriesRecursive()) {
                    const normalized = tryNormalizeGamePath(entry);
                    if (!normalized) {
                        this.logger.warn(`Ignoring unsafe real-file-system entry "${entry}".`);
                        continue;
                    }
                    const pathKey = gamePathKey(normalized);
                    const leafKey = gamePathKey(gamePathLeaf(normalized));
                    const pathEntries = byPath.get(pathKey) ?? [];
                    pathEntries.push(normalized);
                    byPath.set(pathKey, pathEntries);
                    const leafEntries = byLeaf.get(leafKey) ?? [];
                    leafEntries.push(normalized);
                    byLeaf.set(leafKey, leafEntries);
                }
                const sortEntries = (entries: string[]): void => entries.sort(compareResourcePaths);
                for (const entries of byPath.values()) sortEntries(entries);
                for (const entries of byLeaf.values()) sortEntries(entries);
                return { byPath, byLeaf };
            })();
        }
        return this.rfsEntryIndex;
    }
    private async findRfsEntry(filename: string): Promise<string | undefined> {
        const normalized = normalizeGamePath(filename);
        const index = await this.getRfsEntryIndex();
        return index.byPath.get(gamePathKey(normalized))?.[0] ??
            index.byLeaf.get(gamePathKey(gamePathLeaf(normalized)))?.[0];
    }
    private async resolveFileWithRfs(filename: string): Promise<{ file: VirtualFile; provenance: string[] } | undefined> {
        let file: VirtualFile | undefined;
        let provenance: string[] = [];
        if (this.rfs) {
            try {
                file = await this.rfs.openFile(filename);
                provenance = [normalizeGamePath(filename)];
            }
            catch (e) {
                if (!(e instanceof FileNotFoundError)) {
                    throw e;
                }
            }
            if (!file) {
                const fallbackEntry = await this.findRfsEntry(filename);
                if (fallbackEntry) {
                    file = await this.rfs.openFile(fallbackEntry);
                    provenance = [fallbackEntry];
                }
            }
        }
        if (!file) {
            if (!this.fileExists(filename)) {
                this.logger.warn(`File "${filename}" not found in VFS, returning undefined`);
                return undefined;
            }
            file = this.openFile(filename);
            const resolution = this.resolve(filename);
            provenance = resolution.winner?.provenance ? [...resolution.winner.provenance] : [];
        }
        return { file, provenance };
    }
    /** Open a loose or mounted resource using the same precedence as loaders. */
    async openFileWithRfs(filename: string): Promise<VirtualFile | undefined> {
        return (await this.resolveFileWithRfs(filename))?.file;
    }
    private async addArchiveByFilename(filename: string, createArchive: (file: VirtualFile) => Archive | Promise<Archive>, metadata?: ArchiveMetadata, required = false): Promise<boolean> {
        if (this.hasArchive(filename)) {
            this.logger.info(`Archive "${filename}" already loaded, skipping.`);
            return true;
        }
        const resolvedFile = await this.resolveFileWithRfs(filename);
        if (resolvedFile) {
            try {
                const archive = await createArchive(resolvedFile.file);
                this.addArchive(archive, filename, {
                    ...(metadata ?? this.metadataForMix(filename)),
                    provenance: metadata?.provenance ?? resolvedFile.provenance,
                });
                return true;
            }
            catch (error) {
                this.logger.error(`Failed to create archive from "${filename}":`, error);
                if (required) {
                    throw error;
                }
            }
        }
        else {
            this.logger.warn(`Could not open "${filename}" via RFS to add as archive.`);
            if (required) {
                throw new FileNotFoundError(`Required archive "${filename}" not found in imported storage or mounted archives.`);
            }
        }
        return false;
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
    private getExtraMixNames(engineType: EngineType, profile?: GameProfileDescriptor): string[] {
        const names: string[] = [];
        const seen = new Set<string>();
        const add = (filename: string): void => {
            const key = gamePathKey(filename);
            if (!seen.has(key)) {
                seen.add(key);
                names.push(filename);
            }
        };
        for (const prefix of ["ecache", "expand", "elocal"]) {
            for (let i = 99; i >= 0; i--) {
                const numStr = pad(i, "00");
                if (profile?.id === "mental-omega") {
                    add(`${prefix}mo${numStr}.mix`);
                }
                if (engineType === EngineType.YurisRevenge) {
                    add(`${prefix}md${numStr}.mix`);
                }
                add(`${prefix}${numStr}.mix`);
            }
        }
        return names;
    }
    private metadataForExtraMix(filename: string, profile?: GameProfileDescriptor): ArchiveMetadata {
        const lower = filename.toLocaleLowerCase("en-US");
        return {
            layer: lower.includes("mo")
                ? ResourceLayer.ModPatch
                : lower.includes("md")
                    ? ResourceLayer.ModCore
                    : ResourceLayer.ModPatch,
            source: "mod",
            profile: profile?.id,
            id: filename,
        };
    }
    /**
     * Discover known extra MIX names inside already mounted archives.
     * Westwood MIX indexes contain hashes rather than filenames, so this
     * candidate-driven pass is the only generic way to recover nested names.
     * It runs to a small fixpoint so a MIX can contain another known MIX.
     */
    async loadNestedMixFiles(engineType: EngineType, profile?: GameProfileDescriptor): Promise<void> {
        const startedAt = Date.now();
        const candidates = this.getExtraMixNames(engineType, profile);
        let loadedArchives = 0;
        for (let pass = 0; pass < 3; pass++) {
            let loaded = false;
            for (const filename of candidates) {
                if (this.hasArchive(filename) || !this.fileExists(filename)) {
                    continue;
                }
                const added = await this.addMixFile(filename, this.metadataForExtraMix(filename, profile));
                loaded ||= added;
                if (added) {
                    loadedArchives++;
                }
            }
            if (!loaded) {
                break;
            }
        }
        this.logger.info(`Nested MIX discovery checked ${candidates.length} candidates, loaded ${loadedArchives} archives in ${Date.now() - startedAt} ms.`);
    }
    async addMixFile(filename: string, metadata?: ArchiveMetadata, options?: { required?: boolean }): Promise<boolean> {
        return this.addArchiveByFilename(filename, async (fileStreamHolder) => {
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
        }, metadata, options?.required ?? false);
    }
    async addBagFile(filename: string): Promise<void> {
        const idxFilename = filename.replace(/\.bag$/i, ".idx");
        try {
            const resolvedIdxFile = await this.resolveFileWithRfs(idxFilename);
            if (!resolvedIdxFile) {
                this.logger.error(`IDX file "${idxFilename}" not found for BAG file "${filename}".`);
                return;
            }
            await this.addArchiveByFilename(filename, async (bagVirtualFile) => {
                const idxData = new IdxFile(resolvedIdxFile.file.stream);
                const audioBag = new AudioBagFile();
                await audioBag.fromVirtualFile(bagVirtualFile, idxData);
                return audioBag;
        }, this.metadataForMix(filename));
        }
        catch (error) {
            this.logger.error(`Failed to add BAG file "${filename}":`, error);
        }
    }
    private async hasLooseOrMountedFile(filename: string): Promise<boolean> {
        return this.fileExists(filename) || !!(await this.findRfsEntry(filename));
    }
    private async addBagFileIfPresent(filename: string): Promise<void> {
        const idxFilename = filename.replace(/\.bag$/i, ".idx");
        if (!await this.hasLooseOrMountedFile(filename) || !await this.hasLooseOrMountedFile(idxFilename)) {
            return;
        }
        await this.addBagFile(filename);
    }
    async loadImplicitMixFiles(engineType: EngineType, profile?: GameProfileDescriptor): Promise<void> {
        this.logger.info("Initializing implicit mix files...");
        const YR = engineType === EngineType.YurisRevenge;
        const required = new Set((profile?.requiredFiles ?? []).map((file) => gamePathKey(file)));
        const addImplicit = async (filename: string): Promise<void> => {
            await this.addMixFile(filename, undefined, { required: required.has(gamePathKey(filename)) });
        };
        if (YR)
            await addImplicit("langmd.mix");
        await addImplicit("language.mix");
        if (YR)
            await addImplicit("ra2md.mix");
        await addImplicit("ra2.mix");
        if (YR)
            await addImplicit("cachemd.mix");
        await addImplicit("cache.mix");
        if (YR)
            await addImplicit("loadmd.mix");
        await addImplicit("load.mix");
        if (YR)
            await addImplicit("localmd.mix");
        await addImplicit("local.mix");
        if (YR)
            await addImplicit("ntrlmd.mix");
        await addImplicit("neutral.mix");
        if (YR)
            await addImplicit("audiomd.mix");
        await addImplicit("audio.mix");
        // Ares combines the retail audio bag with optional extension bags.
        // Keep this discovery generic: profile/mod audio can live in loose
        // imported storage or in any already-mounted MIX archive.
        await this.addBagFileIfPresent("audio.bag");
        await this.addBagFileIfPresent("ares.bag");
        for (let i = 1; i <= 99; i++) {
            const suffix = pad(i, "00");
            await this.addBagFileIfPresent(`audio${suffix}.bag`);
        }
        await addImplicit("conquer.mix");
        if (YR) {
            await addImplicit("conqmd.mix");
            await addImplicit("genermd.mix");
        }
        await addImplicit("generic.mix");
        if (YR)
            await addImplicit("isogenmd.mix");
        await addImplicit("isogen.mix");
        if (YR)
            await addImplicit("cameomd.mix");
        await addImplicit("cameo.mix");
        await addImplicit("cameocd.mix");
        if (YR)
            await addImplicit("multimd.mix");
        await addImplicit("multi.mix");
        this.logger.info("Finished initializing implicit mix files.");
    }
    async loadExtraMixFiles(engineType: EngineType, profile?: GameProfileDescriptor): Promise<void> {
        this.logger.info("Loading extra mix files...");
        if (!this.rfs) {
            this.logger.info("No real file system is mounted; skipping loose extra MIX discovery.");
            return;
        }
        const rfsIndex = await this.getRfsEntryIndex();
        const rfsEntries = [...new Set([...rfsIndex.byPath.values()].flat())].sort(compareResourcePaths);
        const findEntryByLeaf = (filename: string): string | undefined => {
            return rfsIndex.byLeaf.get(gamePathKey(gamePathLeaf(filename)))?.[0];
        };
        for (const fileToTry of this.getExtraMixNames(engineType, profile)) {
            const rfsEntry = findEntryByLeaf(fileToTry);
            if (rfsEntry && !this.hasArchive(fileToTry)) {
                await this.addMixFile(fileToTry, {
                    ...this.metadataForExtraMix(fileToTry, profile),
                    provenance: [rfsEntry],
                });
            }
        }
        const mapExtensions = [".mmx"];
        if (engineType === EngineType.YurisRevenge) {
            mapExtensions.push(".yro");
        }
        for (const ext of mapExtensions) {
            for (const rfsFile of rfsEntries) {
                if (rfsFile.toLocaleLowerCase("en-US").endsWith(ext)) {
                    if (!this.hasArchive(rfsFile)) {
                        const fileData = await this.rfs.openFile(rfsFile);
                        if (fileData) {
                            this.addArchive(new MixFile(fileData.stream), rfsFile, {
                                layer: ResourceLayer.MapOverride,
                                source: "map",
                                profile: profile?.id,
                                provenance: [rfsFile],
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
        if (!this.rfs) {
            this.logger.info("No real file system is mounted; skipping standalone file loading.");
            return;
        }
        const extensionsToLoad = ["ini", "csf", "wav"];
        const excludeSet = new Set<string>((options?.exclude || []).map((file) => gamePathKey(file)));
        const filesForMemArchive: VirtualFile[] = [];
        const rfsIndex = await this.getRfsEntryIndex();
        const rfsEntries = [...new Set([...rfsIndex.byPath.values()].flat())].sort(compareResourcePaths);
        for (const entryName of rfsEntries) {
            const normalizedEntryName = normalizeGamePath(entryName);
            const lowerEntryName = normalizedEntryName.toLocaleLowerCase("en-US");
            const excluded = excludeSet.has(gamePathKey(normalizedEntryName)) ||
                excludeSet.has(gamePathKey(gamePathLeaf(normalizedEntryName)));
            const isLooseRootWav = lowerEntryName.endsWith(".wav") && !normalizedEntryName.includes("/");
            const isStandaloneConfig = extensionsToLoad
                .filter((extension) => extension !== "wav")
                .some((extension) => lowerEntryName.endsWith("." + extension));
            if ((isStandaloneConfig || isLooseRootWav) && !excluded) {
                try {
                    const file = await this.rfs.openFile(entryName);
                    if (file) {
                        const normalizedSegments = normalizedEntryName.split("/");
                        // Imported archives are often stored below a picker
                        // folder (for example `Install/MIX/rulesmo.ini`).
                        // Engine lookups use the game-relative name, so keep
                        // every suffix alias while retaining nested include
                        // paths such as `rules/units.ini`.
                        for (let aliasStart = 0; aliasStart < normalizedSegments.length; aliasStart++) {
                            const alias = normalizedSegments.slice(aliasStart).join("/");
                            filesForMemArchive.push(VirtualFile.fromBytes(file.getBytes(), alias));
                        }
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
                provenance: ["real-file-system"],
            });
            this.logger.info(`Added ${filesForMemArchive.length} standalone files to mem.archive`);
        }
        else {
            this.logger.info("No standalone files found or added to mem.archive.");
        }
    }
}
