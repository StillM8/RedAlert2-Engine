import { IniFile } from '../data/IniFile';
import { ShpFile } from '../data/ShpFile';
import { VxlFile } from '../data/VxlFile';
import { TmpFile } from '../data/TmpFile';
import { Palette } from '../data/Palette';
import { Theater } from './Theater';
import { TheaterType } from './TheaterType';
import { version as appVersion } from '../version';
import { VirtualFileSystem } from '../data/vfs/VirtualFileSystem';
import { RealFileSystem } from '../data/vfs/RealFileSystem';
import { LazyResourceCollection } from './LazyResourceCollection';
import { WavFile } from '../data/WavFile';
import { LazyAsyncResourceCollection } from './LazyAsyncResourceCollection';
import { Mp3File } from '../data/Mp3File';
import { mixDatabase, sideBarCdFiles, sideBarFiles } from './mixDatabase';
import { GameResSource } from './gameRes/GameResSource';
import { Crc32 } from '../data/Crc32';
import { GameModes } from '../game/ini/GameModes';
import { IniSourceLoader } from './IniSourceLoader';
import * as stringUtils from '../util/string';
import { MapList } from './MapList';
import { VirtualFile } from '../data/vfs/VirtualFile';
import { HvaFile } from '../data/HvaFile';
import { MixinRulesType } from '../game/ini/MixinRulesType';
import { AppLogger } from '../util/logger';
import { GAME_PROFILES, type GameProfileDescriptor } from './GameProfile';
import { gamePathKey } from './GamePath';
type AppLoggerType = typeof AppLogger;
interface TheaterSettings {
    type: TheaterType;
    theaterIni: string;
    mixes: string[];
    extension: string;
    newTheaterChar: string;
    isoPaletteName: string;
    unitPaletteName: string;
    overlayPaletteName: string;
    libPaletteName: string;
}
interface VfsLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
export enum EngineType {
    AutoDetect = 0,
    TiberianSun = 1,
    Firestorm = 2,
    RedAlert2 = 3,
    YurisRevenge = 4
}
export class Engine {
    public static readonly UI_ANIM_SPEED = 2;
    public static rfsSettings = {
        menuVideoFileName: "ra2ts_l.webm",
        menuVideoFileNameYr: "ra2ts_l_yr.webm",
        splashImgFileName: "glsl.png",
        mapDir: "maps",
        modDir: "mods",
        musicDir: "music",
        tauntsDir: "Taunts",
        cacheDir: "cache",
        replayDir: "replays",
    };
    public static supportedMapTypes = ["mpr", "map"];
    public static images = new LazyResourceCollection((file) => new ShpFile(file));
    public static voxels = new LazyResourceCollection((file) => new VxlFile(file));
    public static voxelAnims = new LazyResourceCollection((file) => new HvaFile(file));
    public static sounds = new LazyResourceCollection((file) => new WavFile(file));
    public static themes = new LazyAsyncResourceCollection((file) => new Mp3File(file), false);
    public static taunts = new LazyAsyncResourceCollection(async (file) => new WavFile(file instanceof File
        ? new Uint8Array(await file.arrayBuffer())
        : file.getBytes()));
    public static iniFiles = new LazyResourceCollection((file) => new IniFile(file));
    public static tileData = new LazyResourceCollection((file) => new TmpFile(file));
    public static palettes = new LazyResourceCollection((file) => new Palette(file));
    public static theaters = new Map<TheaterType, Theater>();
    public static theaterSettings = new Map<EngineType, TheaterSettings[]>()
        .set(EngineType.RedAlert2, [
        {
            type: TheaterType.Temperate,
            theaterIni: "temperat.ini",
            mixes: ["isotemp.mix", "temperat.mix", "tem.mix"],
            extension: ".tem",
            newTheaterChar: "T",
            isoPaletteName: "isotem.pal",
            unitPaletteName: "unittem.pal",
            overlayPaletteName: "temperat.pal",
            libPaletteName: "libtem.pal",
        },
        {
            type: TheaterType.Snow,
            theaterIni: "snow.ini",
            mixes: ["isosnow.mix", "snow.mix", "sno.mix"],
            extension: ".sno",
            newTheaterChar: "A",
            isoPaletteName: "isosno.pal",
            unitPaletteName: "unitsno.pal",
            overlayPaletteName: "snow.pal",
            libPaletteName: "libsno.pal",
        },
        {
            type: TheaterType.Urban,
            theaterIni: "urban.ini",
            mixes: ["isourb.mix", "urb.mix", "urban.mix"],
            extension: ".urb",
            newTheaterChar: "U",
            isoPaletteName: "isourb.pal",
            unitPaletteName: "uniturb.pal",
            overlayPaletteName: "urban.pal",
            libPaletteName: "liburb.pal",
        },
    ])
        .set(EngineType.YurisRevenge, [
        {
            type: TheaterType.Temperate,
            theaterIni: "temperatmd.ini",
            mixes: [
                "isotemp.mix",
                "isotemmd.mix",
                "temperat.mix",
                "tem.mix",
            ],
            extension: ".tem",
            newTheaterChar: "T",
            isoPaletteName: "isotem.pal",
            unitPaletteName: "unittem.pal",
            overlayPaletteName: "temperat.pal",
            libPaletteName: "libtem.pal",
        },
        {
            type: TheaterType.Snow,
            theaterIni: "snowmd.ini",
            mixes: [
                "isosnomd.mix",
                "snowmd.mix",
                "isosnow.mix",
                "snow.mix",
                "sno.mix",
            ],
            extension: ".sno",
            newTheaterChar: "A",
            isoPaletteName: "isosno.pal",
            unitPaletteName: "unitsno.pal",
            overlayPaletteName: "snow.pal",
            libPaletteName: "libsno.pal",
        },
        {
            type: TheaterType.Urban,
            theaterIni: "urbanmd.ini",
            mixes: ["isourbmd.mix", "isourb.mix", "urb.mix", "urban.mix"],
            extension: ".urb",
            newTheaterChar: "U",
            isoPaletteName: "isourb.pal",
            unitPaletteName: "uniturb.pal",
            overlayPaletteName: "urban.pal",
            libPaletteName: "liburb.pal",
        },
        {
            type: TheaterType.NewUrban,
            theaterIni: "urbannmd.ini",
            mixes: [
                "isoubnmd.mix",
                "isoubn.mix",
                "ubn.mix",
                "urbann.mix",
            ],
            extension: ".ubn",
            newTheaterChar: "N",
            isoPaletteName: "isoubn.pal",
            unitPaletteName: "unitubn.pal",
            overlayPaletteName: "urbann.pal",
            libPaletteName: "libubn.pal",
        },
        {
            type: TheaterType.Desert,
            theaterIni: "desertmd.ini",
            mixes: [
                "isodesmd.mix",
                "desert.mix",
                "des.mix",
                "isodes.mix",
            ],
            extension: ".des",
            newTheaterChar: "D",
            isoPaletteName: "isodes.pal",
            unitPaletteName: "unitdes.pal",
            overlayPaletteName: "desert.pal",
            libPaletteName: "libdes.pal",
        },
        {
            type: TheaterType.Lunar,
            theaterIni: "lunarmd.ini",
            mixes: ["isolunmd.mix", "isolun.mix", "lun.mix", "lunar.mix"],
            extension: ".lun",
            newTheaterChar: "L",
            isoPaletteName: "isolun.pal",
            unitPaletteName: "unitlun.pal",
            overlayPaletteName: "lunar.pal",
            libPaletteName: "liblun.pal",
        },
    ]);
    public static customRulesFileName = "rulescd.ini";
    public static customArtFileName = "artcd.ini";
    public static customMpModesFileName = "mpmodescd.ini";
    public static shroudFileName = "shroud.shp";
    public static mixinRulesFileNames = new Map<MixinRulesType, string>().set(MixinRulesType.NoDogEngiKills, "nodogengikills.ini");
    private static activeMod?: string;
    private static activeProfile: GameProfileDescriptor = GAME_PROFILES.ra2;
    private static loadedSideMixNames = new Set<string>();
    private static modHash?: number;
    private static gameResSource?: GameResSource;
    public static rfs?: RealFileSystem;
    private static iniSourceLoader?: IniSourceLoader;
    public static vfs?: VirtualFileSystem;
    public static art?: IniFile;
    public static rules?: IniFile;
    public static ai?: IniFile;
    public static activeTheater?: Theater;
    private static mapList?: MapList;
    private static mapListGameModes?: GameModes;
    private static mapListLoadPromise?: Promise<MapList>;
    private static mapListLoadScheduled = false;
    private static loadedMapListFiles = new Set<string>();
    static getVersion(): string {
        return appVersion.split(".").slice(0, 2).join(".");
    }
    static getModHash(): number {
        if (!this.modHash) {
            throw new Error("Rules must be loaded first");
        }
        return this.modHash;
    }
    static getActiveMod(): string | undefined {
        return this.activeMod;
    }
    static setActiveMod(modName: string | undefined): void {
        this.activeMod = modName;
    }
    static initGameResSource(source: GameResSource): void {
        this.gameResSource = source;
    }
    static async initRfs(rootHandle: FileSystemDirectoryHandle): Promise<RealFileSystem> {
        // These directories are application-managed namespaces, not part of
        // the immutable base game. The selected mod and map roots are mounted
        // explicitly later in GameRes; excluding their root copies prevents
        // unrelated installed mods from being discovered during VFS scans.
        const rfsInstance = (this.rfs = new RealFileSystem({
            excludedRootDirectories: [
                this.rfsSettings.modDir,
                this.rfsSettings.mapDir,
                this.rfsSettings.cacheDir,
                this.rfsSettings.replayDir,
                this.rfsSettings.musicDir,
                this.rfsSettings.tauntsDir,
            ],
        }));
        rfsInstance.addRootDirectoryHandle(rootHandle);
        return rfsInstance;
    }
    static async initVfs(rfsInstance: RealFileSystem | undefined, logger: VfsLogger, profile: GameProfileDescriptor = GAME_PROFILES.ra2): Promise<VirtualFileSystem> {
        this.activeProfile = profile;
        this.vfs = new VirtualFileSystem(rfsInstance, logger);
        this.iniSourceLoader = new IniSourceLoader(this.vfs);
        this.iniFiles.setVfs(this.vfs);
        this.palettes.setVfs(this.vfs);
        this.images.setVfs(this.vfs);
        this.voxels.setVfs(this.vfs);
        this.voxelAnims.setVfs(this.vfs);
        this.tileData.setVfs(this.vfs);
        this.sounds.setVfs(this.vfs);
        const musicDirPath = Engine.rfsSettings.musicDir;
        if (Engine.rfs && (await Engine.rfs.containsEntry(musicDirPath))) {
            const musicDir = await Engine.rfs.getDirectory(musicDirPath);
            console.log('[Engine] Setting themes directory for music files');
            try {
                const handle = musicDir.getNativeHandle();
                if (handle) {
                    Engine.themes.setDir(handle);
                    console.log('[Engine] Themes directory set successfully');
                }
                else {
                    console.warn('[Engine] Failed to get native handle for music directory');
                }
            }
            catch (error) {
                console.error('[Engine] Failed to set themes directory:', error);
            }
        }
        else {
            console.warn('[Engine] Music directory not found in RFS');
        }
        const tauntsDir = await this.rfs?.findDirectory(this.rfsSettings.tauntsDir);
        this.taunts.setDir(tauntsDir?.getNativeHandle());
        return this.vfs;
    }
    static supportsTheater(theaterType: TheaterType): boolean {
        const currentEngine = this.getActiveEngine();
        return (this.theaterSettings.get(currentEngine)?.some((setting) => setting.type === theaterType) || false);
    }
    static getTheaterSettings(engineType: EngineType, theaterType: TheaterType): TheaterSettings {
        const settingsForEngine = this.theaterSettings.get(engineType);
        if (!settingsForEngine) {
            throw new Error(`Unknown engineType "${EngineType[engineType]}"`);
        }
        const specificSetting = settingsForEngine.find((setting) => setting.type === theaterType);
        if (!specificSetting) {
            throw new Error(`Unsupported theater "${TheaterType[theaterType]}" for engine "${EngineType[engineType]}"`);
        }
        return specificSetting;
    }
    static async loadTheater(theaterType: TheaterType): Promise<Theater> {
        if (!this.rules || !this.art) {
            throw new Error("Rules and art should be loaded first");
        }
        if (this.gameResSource === undefined) {
            throw new Error("No gameResSource is set");
        }
        const currentEngine = this.getActiveEngine();
        let theaterInstance: Theater | undefined;
        const settings = this.getTheaterSettings(currentEngine, theaterType);
        if (this.gameResSource !== GameResSource.Cdn && this.vfs) {
            for (const mixName of settings.mixes) {
                await this.vfs.addMixFile(mixName);
            }
        }
        if (this.theaters.has(theaterType)) {
            theaterInstance = this.theaters.get(theaterType)!;
        }
        else {
            const theaterIniFile = this.getTheaterIni(currentEngine, theaterType);
            const tileDataCollection = this.getTileData();
            theaterInstance = Theater.factory(theaterType, theaterIniFile, settings, tileDataCollection, this.palettes);
            this.theaters.set(theaterType, theaterInstance);
        }
        this.activeTheater = theaterInstance;
        return theaterInstance;
    }
    static unloadTheater(theaterType: TheaterType): void {
        if (this.vfs) {
            const currentEngine = this.getActiveEngine();
            const settings = this.getTheaterSettings(currentEngine, theaterType);
            for (const mixName of settings.mixes) {
                this.vfs.removeArchive(mixName);
            }
        }
    }
    static markSideMixDataLoaded(mixFileNames: readonly string[]): void {
        for (const mixFileName of mixFileNames) {
            this.loadedSideMixNames.add(mixFileName.toLocaleLowerCase("en-US"));
        }
    }
    static unloadSideMixData(mixFileNames: readonly string[] = []): void {
        const sideMixNames = new Set([
            "sidec01.mix",
            "sidec02.mix",
            "sidec01md.mix",
            "sidec02md.mix",
            "sidec01cd.mix",
            "sidec02cd.mix",
            ...this.loadedSideMixNames,
            ...mixFileNames.map((name) => name.toLocaleLowerCase("en-US")),
        ]);
        for (const mixFileName of sideMixNames) {
            const mixInfo = mixDatabase.get(mixFileName);
            const fallbackEntries = mixFileName.endsWith("cd.mix") ? sideBarCdFiles : sideBarFiles;
            for (const entryName of mixInfo ?? (mixFileName.startsWith("sidec") ? fallbackEntries : [])) {
                const extension = entryName.split('.').pop()?.toLowerCase();
                (extension === "pal" ? this.palettes : this.images).clear(entryName);
            }
            this.vfs?.removeArchive(mixFileName);
        }
        this.loadedSideMixNames.clear();
        // These Yuri resources are hash-only entries in sidec02md.mix and
        // are loaded under aliases by GameLoader.
        this.images.clear("radary.shp");
        this.palettes.clear("radary.pal");
    }
    static getTheaterIni(engineType: EngineType, theaterType: TheaterType): IniFile {
        const iniFileName = this.getTheaterSettings(engineType, theaterType).theaterIni;
        return this.getIni(iniFileName);
    }
    static loadRules(): void {
        const rulesFileName = this.getFileNameVariant("rules.ini");
        const artFileName = this.getFileNameVariant("art.ini");
        const aiFileName = this.getFileNameVariant("ai.ini");
        const baseRulesFileName = this.getEngineBaseFileName("rules.ini");
        const baseArtFileName = this.getEngineBaseFileName("art.ini");
        const baseAiFileName = this.getEngineBaseFileName("ai.ini");
        const rulesBase = this.getRequiredIni(baseRulesFileName);
        const artBase = this.getRequiredIni(baseArtFileName);
        const aiBase = this.getRequiredIni(baseAiFileName);
        const rulesProfile = this.getRequiredIni(rulesFileName);
        const artProfile = this.getRequiredIni(artFileName);
        const aiProfile = this.getRequiredIni(aiFileName);
        const rulesCustom = this.getRequiredIni(this.customRulesFileName);
        const artCustom = this.getRequiredIni(this.customArtFileName);
        // A profile such as Mental Omega supplies an override INI while still
        // depending on the retail YR definitions. Merge in this order so
        // profile content wins without making vanilla RA2/YR pay for it.
        this.art = artBase.clone();
        if (artFileName !== baseArtFileName) {
            this.art.mergeWith(artProfile);
        }
        this.art.mergeWith(artCustom);
        this.rules = rulesBase.clone();
        if (rulesFileName !== baseRulesFileName) {
            this.rules.mergeWith(rulesProfile);
        }
        this.rules.mergeWith(rulesCustom);
        this.ai = aiBase.clone();
        if (aiFileName !== baseAiFileName) {
            this.ai.mergeWith(aiProfile);
        }
        this.modHash = this.computeModHash();
    }
    static computeModHash(): number {
        if (!this.vfs)
            throw new Error("VFS not initialized");
        const filesToHash: string[] = [
            this.customRulesFileName,
            this.customArtFileName,
            this.customMpModesFileName,
            this.shroudFileName,
            this.getFileNameVariant("rules.ini"),
            this.getFileNameVariant("art.ini"),
            this.getFileNameVariant("ai.ini"),
            ...Array.from(this.mixinRulesFileNames.values()),
        ];
        const currentEngine = this.getActiveEngine();
        const theaterSettingsForEngine = this.theaterSettings.get(currentEngine);
        if (!theaterSettingsForEngine) {
            throw new Error(`Unsupported engineType "${EngineType[currentEngine]}"`);
        }
        for (const setting of theaterSettingsForEngine) {
            // theaterSettings are already engine-specific (YR entries carry the
            // "md" names) — re-applying the variant suffix produces *mdmd.ini.
            filesToHash.push(setting.theaterIni);
        }
        const mpModes = this.getMpModes();
        for (const mode of mpModes.getAll()) {
            // Mode-specific INIs are optional overlays. A partial or modded
            // import must still boot the shared multiplayer shell when one
            // mode's override is absent; the lobby will use the base rules for
            // that mode until the content provider supplies the file.
            if (mode.rulesOverride && this.vfs.fileExists(mode.rulesOverride)) {
                filesToHash.push(mode.rulesOverride);
            }
            else if (mode.rulesOverride) {
                console.warn(`Skipping missing optional multiplayer mode rules "${mode.rulesOverride}" while hashing content.`);
            }
        }
        const crc = new Crc32();
        for (const fileName of filesToHash) {
            if (!this.vfs.fileExists(fileName)) {
                throw new Error(`File ${fileName} not found for hashing`);
            }
            const effective = this.iniSourceLoader?.loadEffectiveIni(fileName);
            crc.append(effective
                ? stringUtils.binaryStringToUint8Array(effective.ini.toString())
                : this.vfs.openFile(fileName).getBytes());
        }
        crc.append(stringUtils.binaryStringToUint8Array(this.getVersion()));
        return crc.get();
    }
    static getRules(): IniFile {
        if (!this.rules)
            throw new Error("Rules must be loaded first");
        return this.rules;
    }
    static getArt(): IniFile {
        if (!this.art)
            throw new Error("Art must be loaded first");
        return this.art;
    }
    static getAi(): IniFile {
        if (!this.ai)
            throw new Error("AI must be loaded first");
        return this.ai;
    }
    static getFileNameVariant(baseFileName: string): string {
        return this.activeProfile.resolveCanonicalFile(baseFileName, (filename) =>
            this.vfs?.fileExists(filename) || this.iniFiles.has(filename));
    }
    private static getEngineBaseFileName(baseFileName: string): string {
        const currentEngine = this.getActiveEngine();
        if (currentEngine === EngineType.YurisRevenge) {
            return baseFileName.replace(/\.([^.]+)$/, `md.$1`);
        }
        if (currentEngine === EngineType.RedAlert2) {
            return baseFileName;
        }
        throw new Error("Unsupported engine type " + EngineType[currentEngine]);
    }
    static getMpModes(): GameModes {
        return new GameModes(this.getIni(this.customMpModesFileName), (fileName: string) => this.getIni(fileName));
    }
    static getUiIni(): IniFile {
        const uiIniFileName = this.getFileNameVariant("ui.ini");
        return this.getIni(uiIniFileName);
    }
    static getSoundIni(): IniFile {
        const profileSoundFileName = this.getFileNameVariant("sound.ini");
        const engineSoundFileName = this.getEngineBaseFileName("sound.ini");
        const profileSoundIni = this.getIni(profileSoundFileName);
        if (profileSoundFileName === engineSoundFileName) {
            return profileSoundIni;
        }
        return this.getIni(engineSoundFileName).clone().mergeWith(profileSoundIni);
    }
    static getIni(fileName: string): IniFile {
        const effective = this.iniSourceLoader?.loadEffectiveIni(fileName);
        if (effective) {
            return effective.ini;
        }
        const iniFile = this.iniFiles.get(fileName);
        if (!iniFile) {
            console.warn(`INI file "${fileName}" not found, returning empty INI file`);
            return new IniFile();
        }
        return iniFile;
    }
    static getRequiredIni(fileName: string): IniFile {
        if (!this.vfs?.fileExists(fileName)) {
            const resolution = this.vfs?.explain(fileName);
            const owners = resolution?.shadowed.length
                ? ` Shadowed candidates: ${resolution.shadowed.map((candidate) => candidate.archive).join(", ")}.`
                : "";
            throw new Error(`Required INI file "${fileName}" is not available in the mounted resource layers.${owners}`);
        }
        return this.getIni(fileName);
    }
    static getIniSourceLoader(): IniSourceLoader | undefined {
        return this.iniSourceLoader;
    }
    private static getConfiguredMapListFiles(): readonly string[] {
        const profileFiles = this.activeProfile.multiplayerMapListFiles;
        return profileFiles?.length
            ? profileFiles
            : [this.getFileNameVariant("missions.pkt")];
    }
    private static loadConfiguredMapLists(mapList: MapList): number {
        let loaded = 0;
        for (const fileName of this.getConfiguredMapListFiles()) {
            const key = gamePathKey(fileName);
            if (this.loadedMapListFiles.has(key)) {
                loaded++;
                continue;
            }
            if (!this.iniFiles.has(fileName)) {
                console.warn(`Map list file "${fileName}" not found, skipping`);
                continue;
            }
            mapList.addFromIni(this.getIni(fileName));
            this.loadedMapListFiles.add(key);
            loaded++;
        }
        return loaded;
    }
    private static isExcludedFromMultiplayerMapDiscovery(fileName: string): boolean {
        const fileKey = gamePathKey(fileName);
        return (this.activeProfile.nonMultiplayerMapRoots ?? []).some((root) => {
            const rootKey = gamePathKey(root);
            return fileKey === rootKey || fileKey.startsWith(rootKey + "/");
        });
    }
    private static createBaseMapList(): MapList {
        const gameModes = this.mapListGameModes ??= this.getMpModes();
        const mapList = new MapList(gameModes);
        this.loadConfiguredMapLists(mapList);
        return mapList;
    }
    private static async populateMapList(): Promise<MapList> {
        if (!this.vfs)
            throw new Error("File system not initialized");
        const combinedMapList = this.mapList ?? (this.mapList = this.createBaseMapList());
        const gameModes = this.mapListGameModes ??= this.getMpModes();
        const explicitMapLists = this.activeProfile.multiplayerMapListFiles ?? [];
        const explicitMapListReady = explicitMapLists.some((fileName) =>
            this.loadedMapListFiles.has(gamePathKey(fileName)));
        // A declared catalog is already sufficient for the map browser. The
        // match loader mounts deferred gameplay archives before simulation;
        // making Skirmish mount them too turns a map lookup into gigabytes of
        // unrelated I/O. Preserve legacy discovery when no catalog is ready.
        if (!explicitMapListReady) {
            await this.vfs.loadDeferredExtraMixFiles(this.getActiveEngine(), this.getActiveProfile());
            this.loadConfiguredMapLists(combinedMapList);
        }
        // A profile-declared multiplayer catalog is authoritative for the
        // lobby. Do not synchronously mount every standalone MMX/YRO map pack
        // just to rediscover entries that are already in that catalog. Loose
        // custom maps are still scanned below, and the selected map is loaded
        // through MapFileLoader when it is needed.
        if (!explicitMapListReady) {
            await this.vfs.loadDeferredMapArchives(this.getActiveEngine(), this.getActiveProfile());
        }
        for (const archiveName of this.vfs.listArchives()) {
            const pktFileName = archiveName.toLowerCase().replace(/\.[^.]+$/, "") + ".pkt";
            if (this.vfs.fileExists(pktFileName)) {
                combinedMapList.addFromIni(new IniFile(this.vfs.openFile(pktFileName)));
            }
        }
        const localMapList = new MapList(gameModes);
        let cataloguedMapsSkipped = 0;
        let excludedMapsSkipped = 0;
        let parsedLooseMaps = 0;
        if (this.rfs) {
            // RFS can contain the base game, an active mod directory, and a
            // user map directory. Scan every registered directory so maps
            // shipped by mods appear in the lobby alongside the bundled map
            // manifests.
            for (const entry of await this.vfs.listRfsFileEntries()) {
                const entryName = entry.path;
                const effectiveEntryName = entry.effectivePath;
                const lowerEntryName = effectiveEntryName.toLocaleLowerCase("en-US");
                try {
                    if (this.isExcludedFromMultiplayerMapDiscovery(effectiveEntryName)) {
                        excludedMapsSkipped++;
                        continue;
                    }
                    if (lowerEntryName.endsWith(".pkt")) {
                        if (this.loadedMapListFiles.has(gamePathKey(effectiveEntryName))) {
                            continue;
                        }
                        const fileData = await this.rfs.openFile(entryName, true);
                        if (fileData) {
                            localMapList.addFromIni(new IniFile(fileData));
                        }
                    }
                    else if (this.supportedMapTypes.some((type) => lowerEntryName.endsWith("." + type))) {
                        if (combinedMapList.getByName(effectiveEntryName)) {
                            cataloguedMapsSkipped++;
                            continue;
                        }
                        const fileData = await this.rfs.openFile(entryName, true);
                        if (fileData) {
                            localMapList.addFromMapFile(VirtualFile.fromBytes(fileData.getBytes(), effectiveEntryName));
                            parsedLooseMaps++;
                        }
                    }
                }
                catch (e) {
                    console.warn(`Couldn't read file "${entryName}" from RFS`, e);
                }
            }
        }
        console.info(`[Engine] Map discovery reused ${cataloguedMapsSkipped} catalog entries, ` +
            `parsed ${parsedLooseMaps} uncatalogued maps, and excluded ${excludedMapsSkipped} non-multiplayer files.`);
        localMapList.sortByName();
        combinedMapList.mergeWith(localMapList);
        this.mapList = combinedMapList;
        return combinedMapList;
    }
    static async loadMapList(): Promise<MapList> {
        if (!this.mapListLoadPromise) {
            const loadPromise = this.populateMapList();
            this.mapListLoadPromise = loadPromise.catch((error) => {
                this.mapListLoadPromise = undefined;
                throw error;
            });
        }
        return this.mapListLoadPromise;
    }
    static getTileData(): LazyResourceCollection<TmpFile> {
        return this.tileData;
    }
    static getImages(): LazyResourceCollection<ShpFile> {
        return this.images;
    }
    static getVoxels(): LazyResourceCollection<VxlFile> {
        return this.voxels;
    }
    static getVoxelAnims(): LazyResourceCollection<HvaFile> {
        return this.voxelAnims;
    }
    static getPalettes(): LazyResourceCollection<Palette> {
        return this.palettes;
    }
    static getSounds(): LazyResourceCollection<WavFile> {
        return this.sounds;
    }
    static getThemes(): LazyAsyncResourceCollection<Mp3File> {
        return this.themes;
    }
    static getTaunts(): LazyAsyncResourceCollection<WavFile> {
        return this.taunts;
    }
    private static activeEngine: EngineType = EngineType.RedAlert2;
    static setActiveEngine(engineType: EngineType): void {
        if (engineType !== EngineType.RedAlert2 && engineType !== EngineType.YurisRevenge) {
            throw new Error(`Unsupported engine type ${EngineType[engineType]}`);
        }
        this.activeEngine = engineType;
        console.log(`[Engine] Active engine: ${EngineType[engineType]}`);
    }
    static getActiveEngine(): EngineType {
        return this.activeEngine;
    }
    static getMenuVideoFileName(): string {
        return this.activeEngine === EngineType.YurisRevenge
            ? this.rfsSettings.menuVideoFileNameYr
            : this.rfsSettings.menuVideoFileName;
    }
    static getActiveProfile(): GameProfileDescriptor {
        return this.activeProfile;
    }
    static getLastTheaterType(): TheaterType | undefined {
        return this.activeTheater?.type;
    }
    static async getCacheDir(): Promise<FileSystemDirectoryHandle | undefined> {
        try {
            return await this.getOrCreateDir(this.rfsSettings.cacheDir, true);
        }
        catch (e) {
            console.error("Couldn't get cache directory", e);
            return undefined;
        }
    }
    static async getReplayDir(): Promise<FileSystemDirectoryHandle | undefined> {
        const currentMod = this.getActiveMod();
        if (currentMod) {
            const modDirRoot = await this.getModDir();
            const modSpecificDir = await modDirRoot?.getDirectoryHandle(currentMod, {
                create: true,
            });
            return await modSpecificDir?.getDirectoryHandle(this.rfsSettings.replayDir, { create: true });
        }
        return await this.getOrCreateDir(this.rfsSettings.replayDir);
    }
    static async getModDir(): Promise<FileSystemDirectoryHandle | undefined> {
        return await this.getOrCreateDir(this.rfsSettings.modDir);
    }
    static async getMapDir(): Promise<FileSystemDirectoryHandle | undefined> {
        return await this.getOrCreateDir(this.rfsSettings.mapDir);
    }
    static async getOrCreateDir(dirName: string, isPrivate: boolean = false): Promise<FileSystemDirectoryHandle | undefined> {
        const rootDir = this.rfs?.getRootDirectory();
        if (rootDir) {
            const nativeRootDirHandle = rootDir.getNativeHandle();
            if (nativeRootDirHandle) {
                return await nativeRootDirHandle.getDirectoryHandle(dirName, { create: true });
            }
            else {
                return await rootDir.getOrCreateDirectoryHandle(dirName, isPrivate);
            }
        }
        return undefined;
    }
    static getMapList(): MapList | undefined {
        if (!this.vfs) {
            return this.mapList;
        }
        if (!this.mapList) {
            this.mapList = this.createBaseMapList();
        }
        if (!this.mapListLoadScheduled && !this.mapListLoadPromise) {
            this.mapListLoadScheduled = true;
            const startDeferredLoad = () => {
                this.mapListLoadScheduled = false;
                void this.loadMapList().catch((error) => {
                    console.warn("[Engine] Deferred map-list initialization failed:", error);
                });
            };
            const requestIdleCallback = (globalThis as any).requestIdleCallback;
            if (typeof requestIdleCallback === "function") {
                requestIdleCallback(startDeferredLoad, { timeout: 1000 });
            }
            else {
                globalThis.setTimeout(startDeferredLoad, 0);
            }
        }
        return this.mapList;
    }
    static destroy(): void {
        this.activeTheater = undefined;
        this.activeMod = undefined;
        this.modHash = undefined;
        this.mapListLoadPromise = undefined;
        this.mapListLoadScheduled = false;
        this.mapListGameModes = undefined;
        this.mapList = undefined;
        this.loadedMapListFiles.clear();
        this.rfs = undefined;
        this.vfs = undefined;
        this.art = undefined;
        this.iniFiles.clearAll();
        this.images.clearAll();
        this.palettes.clearAll();
        this.rules = undefined;
        this.ai = undefined;
        this.theaters.clear();
        this.tileData.clearAll();
        this.voxels.clearAll();
        this.voxelAnims.clearAll();
        this.sounds.clearAll();
        this.themes.clearAll();
        this.taunts.clearAll();
    }
}
