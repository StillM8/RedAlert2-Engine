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

export interface ExtraMixLoadOptions {
    /**
     * Leave standalone map archives for the first map-list consumer. Core and
     * profile MIX files are still mounted immediately.
     */
    deferMapArchives?: boolean;
    /**
     * Mount only the numbered MIX layers needed to expose a profile's
     * canonical override files during boot. Remaining layers are mounted by
     * loadDeferredExtraMixFiles() when a match or map browser needs them.
     */
    deferAfterProfileFiles?: boolean;
}

function compareResourcePaths(a: string, b: string): number {
    if (a.length !== b.length) {
        return a.length - b.length;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Campaign presentation/content is deliberately outside the current boot
 * contract. Multiplayer and skirmish map packs remain eligible for mounting,
 * but movie/mission MIX containers are only relevant to campaign flows.
 */
export function isCampaignOnlyMixFilename(filename: string): boolean {
    const leaf = gamePathKey(gamePathLeaf(filename));
    return /^(?:movie|movies|mov(?:md|mo))\d*\.mix$/.test(leaf) ||
        /^(?:campaign|mission|missions)(?:md|mo)?\d*\.mix$/.test(leaf);
}

/** Files renamed by file managers after a duplicate copy are not canonical
 * game containers. If the canonical name exists, mounting the suffixed copy
 * can make a corrupt/partial archive win over the real layer. */
function canonicalDuplicateMixFilename(filename: string): string | undefined {
    const match = filename.match(/^(.*)\s+\(\d+\)(\.mix)$/i);
    return match ? `${match[1]}${match[2]}` : undefined;
}

export class VirtualFileSystem {
    private rfs?: RealFileSystem;
    private logger: VfsLogger;
    private allArchives: Map<string, ArchiveRecord>;
    private archivesByPriority: ArchiveRecord[];
    private nextArchiveOrder = 0;
    private rfsEntryIndex?: Promise<RfsEntryIndex>;
    private deferredMapArchivesPromise?: Promise<void>;
    private deferredExtraMixFiles = new Map<string, {
        filename: string;
        rfsFile?: string;
        metadata?: ArchiveMetadata;
    }>();
    private deferredExtraMixFilesPromise?: Promise<void>;
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
    addArchive(
        archive: Archive,
        name: string,
        metadata: ArchiveMetadata = {},
        options: { allowDuplicateName?: boolean } = {},
    ): void {
        const normalizedName = normalizeGamePath(name);
        if (!options.allowDuplicateName && this.hasArchive(normalizedName)) {
            return;
        }
        const key = `${gamePathKey(normalizedName)}#${this.nextArchiveOrder}`;
        {
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
        const key = gamePathKey(name);
        return [...this.allArchives.values()].some((record) =>
            gamePathKey(record.descriptor.filename) === key);
    }
    getArchive(name: string): Archive | undefined {
        const key = gamePathKey(name);
        return this.archivesByPriority.find((record) =>
            gamePathKey(record.descriptor.filename) === key)?.archive;
    }
    removeArchive(name: string): void {
        const key = gamePathKey(name);
        const records = [...this.allArchives.entries()]
            .filter(([, record]) => gamePathKey(record.descriptor.filename) === key);
        for (const [recordKey, record] of records) {
            this.allArchives.delete(recordKey);
            const index = this.archivesByPriority.indexOf(record);
            if (index > -1) {
                this.archivesByPriority.splice(index, 1);
            }
        }
        if (records.length > 0) {
            this.logger.info(`Removed archive "${name}" from VFS`);
        }
    }
    listArchives(): string[] {
        return [...new Set([...this.allArchives.values()].map((record) => record.descriptor.filename))];
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
                    const canonicalDuplicate = canonicalDuplicateMixFilename(gamePathLeaf(normalized));
                    if (canonicalDuplicate) {
                        const canonicalKey = gamePathKey(canonicalDuplicate);
                        const canonicalEntries = byLeaf.get(canonicalKey) ?? [];
                        canonicalEntries.push(normalized);
                        byLeaf.set(canonicalKey, canonicalEntries);
                    }
                }
                const sortEntries = (entries: string[]): void => {
                    entries.sort(compareResourcePaths);
                };
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
    private async resolveFileWithRfs(filename: string): Promise<{ file: VirtualFile; provenance: string[]; resolution?: VfsResolution } | undefined> {
        let file: VirtualFile | undefined;
        let provenance: string[] = [];
        let resolution: VfsResolution | undefined;
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
            resolution = this.resolve(filename);
            provenance = resolution.winner?.provenance ? [...resolution.winner.provenance] : [];
        }
        return { file, provenance, resolution };
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
                const inheritedMetadata = resolvedFile.resolution?.winner
                    ? {
                        layer: resolvedFile.resolution.winner.layer,
                        priority: resolvedFile.resolution.winner.priority,
                        source: resolvedFile.resolution.winner.source,
                        profile: resolvedFile.resolution.winner.profile,
                    }
                    : {};
                this.addArchive(archive, filename, {
                    ...this.metadataForMix(filename),
                    ...inheritedMetadata,
                    ...(metadata ?? {}),
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
    private async addMixArchiveFromFile(
        filename: string,
        file: VirtualFile,
        metadata: ArchiveMetadata,
    ): Promise<boolean> {
        try {
            this.addArchive(new MixFile(file.stream), filename, metadata, { allowDuplicateName: true });
            return true;
        }
        catch (error) {
            this.logger.error(`Failed to create archive from "${filename}":`, error);
            return false;
        }
    }

    private async addMixFilesFromMountedLayers(
        filename: string,
        profile?: GameProfileDescriptor,
    ): Promise<number> {
        if (!this.rfs || typeof (this.rfs as any).openFilesFromLayers !== "function") {
            return 0;
        }
        const layeredFiles = await (this.rfs as any).openFilesFromLayers(filename) as Array<{
            file: VirtualFile;
            directoryIndex: number;
        }>;
        const filesByDirectory = new Map<number, Array<{ file: VirtualFile; directoryIndex: number }>>();
        for (const layeredFile of layeredFiles) {
            const directoryFiles = filesByDirectory.get(layeredFile.directoryIndex) ?? [];
            directoryFiles.push(layeredFile);
            filesByDirectory.set(layeredFile.directoryIndex, directoryFiles);
        }
        let loaded = 0;
        for (const { file, directoryIndex } of layeredFiles) {
            const directoryFiles = filesByDirectory.get(directoryIndex) ?? [file];
            const hasDuplicateVariants = directoryFiles.length > 1;
            const largestVariantSize = Math.max(...directoryFiles.map(({ file: candidate }) => candidate.getSize()));
            const isLargestVariant = file.getSize() === largestVariantSize;
            const metadata = {
                ...this.metadataForExtraMix(filename, profile),
                // The root installation is the fallback layer; each
                // explicitly mounted directory after it is an active overlay.
                // If a file provider renamed a second same-name MIX, the
                // largest copy is normally the full/base archive and the
                // smaller copy is its patch.
                layer: directoryIndex === 0
                    ? ResourceLayer.ModCore
                    : hasDuplicateVariants && isLargestVariant
                        ? ResourceLayer.ModCore
                        : ResourceLayer.ModPatch,
                source: "mod" as const,
                profile: profile?.id,
                id: `${filename}:${file.filename}:${directoryIndex}`,
                provenance: [file.filename],
            };
            if (await this.addMixArchiveFromFile(filename, file, metadata)) {
                loaded++;
            }
        }
        return loaded;
    }

    private metadataForMix(filename: string): ArchiveMetadata {
        const lower = filename.toLocaleLowerCase("en-US");
        if (/^(?:ecache|expand|elocal)(?:md|mo)?\d{2}\.mix$/.test(lower)) {
            return { layer: ResourceLayer.ModPatch, source: "mod" };
        }
        if (lower.includes("cd")) {
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
    private getProfileOverrideFiles(profile?: GameProfileDescriptor): string[] {
        if (!profile) {
            return [];
        }
        return [
            ...Object.values(profile.fileNameOverrides ?? {}),
        ].filter((filename, index, files) => filename && files.indexOf(filename) === index);
    }
    private profileOverrideFilesMounted(profile?: GameProfileDescriptor): boolean {
        const files = this.getProfileOverrideFiles(profile);
        return files.length > 0 && files.every((filename) => this.fileExists(filename));
    }
    private deferExtraMixFile(filename: string, rfsFile?: string, metadata?: ArchiveMetadata): void {
        const key = gamePathKey(filename);
        if (this.hasArchive(filename) || this.deferredExtraMixFiles.has(key)) {
            return;
        }
        this.deferredExtraMixFiles.set(key, { filename, rfsFile, metadata });
    }
    /**
     * Discover known extra MIX names inside already mounted archives.
     * Westwood MIX indexes contain hashes rather than filenames, so this
     * candidate-driven pass is the only generic way to recover nested names.
     * It runs to a small fixpoint so a MIX can contain another known MIX.
     */
    async loadNestedMixFiles(engineType: EngineType, profile?: GameProfileDescriptor, options: ExtraMixLoadOptions = {}): Promise<void> {
        const startedAt = Date.now();
        const candidates = this.getExtraMixNames(engineType, profile);
        let loadedArchives = 0;
        let deferredArchives = 0;
        const deferRemaining = options.deferAfterProfileFiles && this.profileOverrideFilesMounted(profile);
        for (let pass = 0; pass < 3; pass++) {
            let loaded = false;
            for (const filename of candidates) {
                if (this.hasArchive(filename) || !this.fileExists(filename)) {
                    continue;
                }
                if (deferRemaining || (options.deferAfterProfileFiles && this.profileOverrideFilesMounted(profile))) {
                    this.deferExtraMixFile(filename, undefined, this.metadataForExtraMix(filename, profile));
                    deferredArchives++;
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
        this.logger.info(`Nested MIX discovery checked ${candidates.length} candidates, loaded ${loadedArchives} archives` +
            `${deferredArchives ? `, deferred ${deferredArchives}` : ""} in ${Date.now() - startedAt} ms.`);
        // Extension archives can contain Ares audio##.bag/.idx pairs. They
        // are not visible during the initial implicit pass, so repeat the
        // same generic audio discovery after the MIX fixpoint is mounted.
        await this.loadAudioBagFiles();
    }
    /**
     * Mount one archive selected by a data-defined loader (for example an
     * Ares side MIX). MIX indexes store nested filenames as hashes, so the
     * caller supplies the resolved candidate after rules have been parsed.
     */
    async loadNestedMixFile(filename: string, metadata?: ArchiveMetadata): Promise<boolean> {
        if (this.hasArchive(filename)) {
            return true;
        }
        if (!this.fileExists(filename) && !await this.findRfsEntry(filename)) {
            return false;
        }
        return this.addMixFile(filename, metadata);
    }
    /**
     * Finish the deferred profile MIX pass. Keeping this idempotent lets the
     * map browser and match loader safely request the same content without
     * racing duplicate archive parses.
     */
    async loadDeferredExtraMixFiles(engineType: EngineType, profile?: GameProfileDescriptor): Promise<void> {
        if (!this.deferredExtraMixFilesPromise) {
            const loadPromise = (async () => {
                const pending = [...this.deferredExtraMixFiles.values()];
                if (pending.length === 0) {
                    return;
                }
                for (const deferred of pending) {
                    const key = gamePathKey(deferred.filename);
                    if (this.hasArchive(deferred.filename)) {
                        this.deferredExtraMixFiles.delete(key);
                        continue;
                    }
                    const added = await this.addMixFile(deferred.filename, {
                        ...this.metadataForExtraMix(deferred.filename, profile),
                        ...(deferred.metadata ?? {}),
                        ...(deferred.rfsFile ? { provenance: [deferred.rfsFile] } : {}),
                    });
                    if (!added) {
                        throw new Error(`Could not load deferred profile archive "${deferred.filename}".`);
                    }
                    this.deferredExtraMixFiles.delete(key);
                }
                await this.loadNestedMixFiles(engineType, profile);
            })();
            this.deferredExtraMixFilesPromise = loadPromise.catch((error) => {
                this.deferredExtraMixFilesPromise = undefined;
                throw error;
            });
        }
        await this.deferredExtraMixFilesPromise;
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
    private async loadAudioBagFiles(): Promise<void> {
        await this.addBagFileIfPresent("audio.bag");
        await this.addBagFileIfPresent("ares.bag");
        for (let i = 1; i <= 99; i++) {
            await this.addBagFileIfPresent(`audio${pad(i, "00")}.bag`);
        }
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
        // Ares combines the retail audio bag with optional extension bags.
        // Keep this discovery generic: profile/mod audio can live in loose
        // imported storage or in any already-mounted MIX archive.
        await this.loadAudioBagFiles();
        this.logger.info("Finished initializing implicit mix files.");
    }
    async loadExtraMixFiles(engineType: EngineType, profile?: GameProfileDescriptor, options: ExtraMixLoadOptions = {}): Promise<void> {
        this.logger.info("Loading extra mix files...");
        if (!this.rfs) {
            this.logger.info("No real file system is mounted; skipping loose extra MIX discovery.");
            return;
        }
        const rfsIndex = await this.getRfsEntryIndex();
        const rfsEntries = [...new Set([...rfsIndex.byPath.values()].flat())].sort(compareResourcePaths);
        const findEntryByLeaf = async (filename: string): Promise<string | undefined> => {
            // RealFileSystem exposes a fast leaf index. Keep the VFS boundary
            // compatible with lightweight providers used by tests and by
            // platform import adapters that only implement the core methods.
            const preferred = typeof (this.rfs as any).findEntryByLeaf === "function"
                ? await (this.rfs as any).findEntryByLeaf(filename) as string | undefined
                : undefined;
            return preferred ?? rfsIndex.byLeaf.get(gamePathKey(gamePathLeaf(filename)))?.[0];
        };
        let profileFilesReady = options.deferAfterProfileFiles && this.profileOverrideFilesMounted(profile);
        let deferredArchives = 0;
        for (const fileToTry of this.getExtraMixNames(engineType, profile)) {
            if (this.hasArchive(fileToTry)) {
                continue;
            }
            // Do not rescan every mounted directory for all 900 numbered
            // candidates. The inventory already tells us whether this leaf
            // exists in any base/overlay layer.
            if (!rfsIndex.byLeaf.has(gamePathKey(gamePathLeaf(fileToTry)))) {
                continue;
            }
            const layeredArchives = await this.addMixFilesFromMountedLayers(fileToTry, profile);
            if (layeredArchives > 0) {
                profileFilesReady = options.deferAfterProfileFiles && this.profileOverrideFilesMounted(profile);
                continue;
            }
            const rfsEntry = await findEntryByLeaf(fileToTry);
            if (rfsEntry) {
                if (profileFilesReady) {
                    this.deferExtraMixFile(fileToTry, rfsEntry, this.metadataForExtraMix(fileToTry, profile));
                    deferredArchives++;
                    continue;
                }
                await this.addMixFile(fileToTry, {
                    ...this.metadataForExtraMix(fileToTry, profile),
                    provenance: [rfsEntry],
                });
                profileFilesReady = options.deferAfterProfileFiles && this.profileOverrideFilesMounted(profile);
            }
        }
        // Imported installations can contain profile containers that are not
        // part of the numbered expand/ecache/elocal families (for example
        // mapsmo##.mix, movmo##.mix, or multimo.mix). Keep the importer
        // generic by mounting every remaining root MIX, while leaving the
        // implicit retail set to loadImplicitMixFiles in its normal order.
        const implicitMixes = new Set([
            "language.mix", "langmd.mix", "ra2.mix", "ra2md.mix", "multi.mix", "multimd.mix",
            "cache.mix", "cachemd.mix", "load.mix", "loadmd.mix", "local.mix", "localmd.mix",
            "neutral.mix", "ntrlmd.mix", "audio.mix", "audiomd.mix", "conquer.mix", "conqmd.mix",
            "generic.mix", "genermd.mix", "isogen.mix", "isogenmd.mix", "cameo.mix", "cameomd.mix",
            "cameocd.mix",
        ].map(gamePathKey));
        const remainingMixes = new Map<string, string>();
        let skippedCampaignArchives = 0;
        for (const rfsFile of rfsEntries) {
            const filename = gamePathLeaf(rfsFile);
            const key = gamePathKey(filename);
            if (!/\.mix$/i.test(filename) || implicitMixes.has(key) || remainingMixes.has(key) ||
                this.deferredExtraMixFiles.has(key)) {
                continue;
            }
            if (isCampaignOnlyMixFilename(filename)) {
                skippedCampaignArchives++;
                continue;
            }
            const canonicalDuplicate = canonicalDuplicateMixFilename(filename);
            if (canonicalDuplicate && rfsIndex.byLeaf.has(gamePathKey(canonicalDuplicate))) {
                continue;
            }
            const preferred = await findEntryByLeaf(filename);
            if (preferred) {
                remainingMixes.set(key, preferred);
            }
        }
        for (const [key, rfsFile] of remainingMixes) {
            const filename = key;
            if (this.hasArchive(filename)) {
                continue;
            }
            await this.addMixFile(filename, {
                ...this.metadataForExtraMix(filename, profile),
                provenance: [rfsFile],
            });
        }
        if (!options.deferMapArchives) {
            await this.loadMapArchives(engineType, profile, rfsEntries);
        }
        this.logger.info(
            `Finished loading extra mix files${deferredArchives ? `; deferred ${deferredArchives} profile layers` : ""}` +
            `${skippedCampaignArchives ? `; skipped ${skippedCampaignArchives} campaign archives` : ""}.`,
        );
    }
    /**
     * Mount map containers deferred by startup. The operation is idempotent so
     * gameplay, map discovery, and tools can safely request it independently.
     */
    async loadDeferredMapArchives(engineType: EngineType, profile?: GameProfileDescriptor): Promise<void> {
        if (!this.deferredMapArchivesPromise) {
            const loadPromise = (async () => {
                if (!this.rfs) {
                    return;
                }
                const rfsIndex = await this.getRfsEntryIndex();
                const rfsEntries = [...new Set([...rfsIndex.byPath.values()].flat())].sort(compareResourcePaths);
                await this.loadMapArchives(engineType, profile, rfsEntries);
            })();
            this.deferredMapArchivesPromise = loadPromise.catch((error) => {
                // A partially mounted pass is safe to retry: loadMapArchives
                // skips archives already present in the VFS. Do not permanently
                // cache a transient RFS/open failure.
                this.deferredMapArchivesPromise = undefined;
                throw error;
            });
        }
        await this.deferredMapArchivesPromise;
    }
    private async loadMapArchives(engineType: EngineType, profile: GameProfileDescriptor | undefined, rfsEntries: string[]): Promise<void> {
        if (!this.rfs) {
            return;
        }
        const mapExtensions = [".mmx"];
        if (engineType === EngineType.YurisRevenge) {
            mapExtensions.push(".yro");
        }
        for (const ext of mapExtensions) {
            for (const rfsFile of rfsEntries) {
                if (!rfsFile.toLocaleLowerCase("en-US").endsWith(ext) || this.hasArchive(rfsFile)) {
                    continue;
                }
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
    async loadStandaloneFiles(options?: {
        exclude?: string[];
    }): Promise<void> {
        this.logger.info("Loading standalone files into mem.archive...");
        if (!this.rfs) {
            this.logger.info("No real file system is mounted; skipping standalone file loading.");
            return;
        }
        // Ares/RA2 installations may overlay artwork outside MIX files too.
        // Keep the loose-resource set explicit so maps and large auxiliary
        // payloads are still handled by their dedicated loaders.
        const extensionsToLoad = ["ini", "csf", "shp", "pal", "pcx"];
        const excludeSet = new Set<string>((options?.exclude || []).map((file) => gamePathKey(file)));
        const filesForMemArchive: VirtualFile[] = [];
        const rfsIndex = await this.getRfsEntryIndex();
        const rfsEntries = [...new Set([...rfsIndex.byPath.values()].flat())].sort(compareResourcePaths);
        const standaloneEntries = rfsEntries.filter((entryName) => {
            const normalizedEntryName = normalizeGamePath(entryName);
            const lowerEntryName = normalizedEntryName.toLocaleLowerCase("en-US");
            const excluded = excludeSet.has(gamePathKey(normalizedEntryName)) ||
                excludeSet.has(gamePathKey(gamePathLeaf(normalizedEntryName)));
            const isLooseRootWav = lowerEntryName.endsWith(".wav") && !normalizedEntryName.includes("/");
            const isStandaloneResource = extensionsToLoad
                .some((extension) => lowerEntryName.endsWith("." + extension));
            return (isStandaloneResource || isLooseRootWav) && !excluded;
        });
        // File-system handles are asynchronous. Reading a small bounded batch
        // in parallel removes the serialized per-file storage latency without
        // turning a large imported mod into an unbounded read burst. Promise.all
        // preserves entry order, so loose-file precedence remains deterministic.
        const readBatchSize = 8;
        for (let batchStart = 0; batchStart < standaloneEntries.length; batchStart += readBatchSize) {
            const batch = standaloneEntries.slice(batchStart, batchStart + readBatchSize);
            const batchFiles = await Promise.all(batch.map(async (entryName) => {
                const aliases: VirtualFile[] = [];
                try {
                    const file = await this.rfs.openFile(entryName);
                    if (file) {
                        const normalizedEntryName = normalizeGamePath(entryName);
                        const normalizedSegments = normalizedEntryName.split("/");
                        // Imported archives are often stored below a picker
                        // folder (for example `Install/MIX/rulesmo.ini`).
                        // Engine lookups use the game-relative name, so keep
                        // every suffix alias while retaining nested include
                        // paths such as `rules/units.ini`.
                        for (let aliasStart = 0; aliasStart < normalizedSegments.length; aliasStart++) {
                            const alias = normalizedSegments.slice(aliasStart).join("/");
                            aliases.push(VirtualFile.fromBytes(file.getBytes(), alias));
                        }
                    }
                    return aliases;
                }
                catch (e) {
                    if (e instanceof FileNotFoundError) {
                        this.logger.warn(`Standalone file ${entryName} not found during VFS loadStandaloneFiles.`);
                        return aliases;
                    }
                    else {
                        throw e;
                    }
                }
            }));
            filesForMemArchive.push(...batchFiles.flat());
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
