import { IniFile } from "@/data/IniFile";
import { RouteHelper } from "@/RouteHelper";
import { Mod } from "@/gui/screen/mainMenu/modSel/Mod";
import { ModMeta } from "@/gui/screen/mainMenu/modSel/ModMeta";
import { INSTALLED_CONTENT_METADATA_FILE, type InstalledContentMetadata } from "@/content/ContentIdentity";
import { persistContentSelection, parseContentSelectionId } from "@/content/ContentRegistry";
import { scanMentalOmegaIniSources, type AresFeatureUsage } from "@/extensions/ares/AresCompatibilityScanner";
interface Directory {
    getEntries(): AsyncIterable<string>;
    containsEntry(name: string): Promise<boolean>;
    getDirectory(name: string, create: boolean): Promise<Directory>;
    getRawFile(name: string): Promise<RawFile>;
    deleteDirectory(name: string, recursive: boolean): Promise<void>;
}
type DirectoryResolver = () => Promise<Directory | undefined>;
interface RawFile {
    text(): Promise<string>;
}
interface AppResourceLoader {
    loadText(fileName: string): Promise<string>;
}
interface Location {
    href: string;
}

/** Best-effort Ares capability scan of a locally installed mod. */
export interface ModCompatibilityScan {
    /** INI sources that were actually read (loose files in the mod dir). */
    sources: string[];
    /** INI names that were not found as loose files (may be MIX-embedded). */
    missingSources: string[];
    /** Feature usage ordered by occurrence count. */
    featureUsage: AresFeatureUsage[];
    /** Count of distinct Ares keys with no registered feature. */
    unknownExtensionKeys: number;
    /** Total distinct Ares extension keys found. */
    uniqueExtensionKeys: number;
}
export class ModManager {
    public static readonly remoteListFileName = "mods.ini";
    public static readonly modMetaFileName = "modcd.ini";
    public static readonly generatedContentMetaFileName = INSTALLED_CONTENT_METADATA_FILE;
    public static readonly modIdRegex = /^[a-z0-9-_]+$/i;
    private location: Location;
    private modDir?: Directory;
    private appResourceLoader: AppResourceLoader;
    private modDirResolver?: DirectoryResolver;
    constructor(location: Location, modDir: Directory | undefined, appResourceLoader: AppResourceLoader, modDirResolver?: DirectoryResolver) {
        this.location = location;
        this.modDir = modDir;
        this.appResourceLoader = appResourceLoader;
        this.modDirResolver = modDirResolver;
    }
    async ensureModDir(): Promise<Directory | undefined> {
        if (!this.modDir && this.modDirResolver) {
            this.modDir = await this.modDirResolver();
        }
        return this.modDir;
    }
    getModDir(): Directory | undefined {
        return this.modDir;
    }
    async buildModList(localMods: ModMeta[], remoteMods?: ModMeta[]): Promise<Mod[]> {
        const mods: Mod[] = [];
        const remoteModsCopy = [...(remoteMods ?? [])];
        for (const localMod of localMods) {
            const remoteIndex = remoteModsCopy.findIndex((remote) => remote.id === localMod.id);
            const remoteMod = remoteIndex !== -1 ? remoteModsCopy.splice(remoteIndex, 1)[0] : undefined;
            mods.push(new Mod(localMod, remoteMod));
        }
        for (const remoteMod of remoteModsCopy) {
            mods.push(new Mod(undefined, remoteMod));
        }
        return mods;
    }
    async listRemote(): Promise<ModMeta[]> {
        const iniText = await this.appResourceLoader.loadText(ModManager.remoteListFileName);
        const iniFile = new IniFile(iniText);
        const generalSection = iniFile.getSection("General");
        if (!generalSection) {
            throw new Error(ModManager.remoteListFileName + " is missing the [General] section");
        }
        const mods: ModMeta[] = [];
        for (const modIdValue of generalSection.entries.values()) {
            const modIds = Array.isArray(modIdValue) ? modIdValue : [modIdValue];
            for (const modId of modIds) {
                const modSection = iniFile.getSection(modId);
                if (modSection) {
                    const modMeta = new ModMeta().fromIniSection(modSection);
                    mods.push(modMeta);
                }
                else {
                    console.warn(`Mod "${modId}" has no INI section`);
                }
            }
        }
        return mods;
    }
    async listLocal(): Promise<ModMeta[]> {
        const mods: ModMeta[] = [];
        if (this.modDir) {
            for await (const modId of this.modDir.getEntries()) {
                const modMeta = await this.loadModMeta(modId);
                mods.push(modMeta);
            }
        }
        mods.sort((a, b) => a.name!.localeCompare(b.name!));
        return mods;
    }
    async loadModMeta(modId: string): Promise<ModMeta> {
        const modMeta = new ModMeta();
        modMeta.id = modId;
        modMeta.name = modId;
        try {
            const modDirectory = await this.modDir?.getDirectory(modId, true);
            if (!modDirectory) {
                return modMeta;
            }
            const metaFile = (await modDirectory.containsEntry(ModManager.modMetaFileName))
                ? await modDirectory.getRawFile(ModManager.modMetaFileName)
                : undefined;
            if (metaFile) {
                try {
                    modMeta.fromIniFile(new IniFile(await metaFile.text()));
                }
                catch (error) {
                    console.warn(`Couldn't parse meta file in mod folder "${modId}"`);
                    modMeta.name = modId;
                }
                modMeta.id = modId;
            }
            else if (await modDirectory.containsEntry(ModManager.generatedContentMetaFileName)) {
                try {
                    const generated = JSON.parse(
                        await (await modDirectory.getRawFile(ModManager.generatedContentMetaFileName)).text(),
                    ) as Partial<InstalledContentMetadata>;
                    if (typeof generated.name === "string" && generated.name.trim()) {
                        modMeta.name = generated.name.trim();
                    }
                    if (typeof generated.version === "string" && generated.version.trim()) {
                        modMeta.version = generated.version.trim();
                    }
                    if (generated.baseProfile === "ra2" || generated.baseProfile === "yr") {
                        modMeta.baseProfile = generated.baseProfile;
                    }
                    if (typeof generated.runtimeProfile === "string") {
                        modMeta.runtimeProfile = generated.runtimeProfile as ModMeta["runtimeProfile"];
                    }
                    if (Array.isArray(generated.extensions)) {
                        modMeta.extensions = generated.extensions.filter((extension): extension is string => typeof extension === "string");
                    }
                    // Generated metadata is created by our importer and does
                    // not mean the mod is vanilla; it only makes an otherwise
                    // manifest-less installation visible in the library.
                    modMeta.supported = true;
                }
                catch (error) {
                    console.warn(`Couldn't parse generated content metadata in mod folder "${modId}"`, error);
                }
            }
        }
        catch (error) {
            console.warn(error);
        }
        return modMeta;
    }
    async deleteModFiles(modId: string): Promise<void> {
        if (await this.modDir?.containsEntry(modId)) {
            await this.modDir!.deleteDirectory(modId, true);
        }
    }

    /**
     * Scan the loose INI files of an installed mod for Ares feature usage.
     *
     * Only loose files are inspected; INIs embedded in MIX archives cannot be
     * read here because the mod directory is not mounted as a game VFS. The
     * returned report marks those names as missing sources so the UI can
     * state that the scan is advisory for MIX-based mods.
     */
    async scanModCompatibility(modId: string): Promise<ModCompatibilityScan> {
        let modDirectory: Directory | undefined;
        try {
            modDirectory = await this.modDir?.getDirectory(modId, false);
        }
        catch (error) {
            console.warn(`[ModManager] Mod directory "${modId}" not available for scan`, error);
            modDirectory = undefined;
        }
        if (!modDirectory) {
            return {
                sources: [],
                missingSources: [],
                featureUsage: [],
                unknownExtensionKeys: 0,
                uniqueExtensionKeys: 0,
            };
        }
        const candidateNames = [
            "rules.ini", "rulesmd.ini", "rulesmo.ini",
            "art.ini", "artmd.ini", "artmo.ini",
            "ai.ini", "aimd.ini", "aimo.ini",
            "ui.ini", "uimd.ini", "uimo.ini",
        ];
        const sources: { name: string; contents: string }[] = [];
        const missingSources: string[] = [];
        for (const name of candidateNames) {
            try {
                if (await modDirectory.containsEntry(name)) {
                    const file = await modDirectory.getRawFile(name);
                    sources.push({ name, contents: await file.text() });
                }
                else {
                    missingSources.push(name);
                }
            }
            catch (error) {
                console.warn(`[ModManager] Couldn't read "${name}" in mod "${modId}"`, error);
                missingSources.push(name);
            }
        }
        const report = scanMentalOmegaIniSources(sources);
        return {
            sources: report.references
                .map((reference) => reference.source)
                .filter((value, index, all) => all.indexOf(value) === index),
            missingSources,
            featureUsage: report.featureUsage,
            unknownExtensionKeys: report.uniqueUnclassifiedKeys,
            uniqueExtensionKeys: report.uniqueAresKeys + report.uniqueMoContentKeys,
        };
    }

    loadMod(modId?: string): void {
        this.loadContent(modId ? `mod:${modId}` : undefined);
    }
    loadContent(contentId?: string): void {
        const url = new URL(this.location.href);
        const selectionId = parseContentSelectionId(contentId);
        if (selectionId) {
            persistContentSelection(selectionId);
            url.searchParams.set(RouteHelper.contentQueryStringName, selectionId);
        }
        else {
            persistContentSelection(undefined);
            url.searchParams.delete(RouteHelper.contentQueryStringName);
            url.searchParams.delete(RouteHelper.modQueryStringName);
        }
        url.searchParams.delete(RouteHelper.modQueryStringName);
        this.location.href = url.href;
    }
}
