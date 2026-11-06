import { IniFile } from "@/data/IniFile";
import type { VirtualFileSystem } from "@/data/vfs/VirtualFileSystem";
import { IniSourceLoader } from "@/engine/IniSourceLoader";
import { gamePathLeaf, tryNormalizeGamePath } from "@/engine/GamePath";
import { getGameProfile } from "@/engine/GameProfile";
import type { GameProfileDescriptor, GameProfileId } from "@/engine/GameProfile";
import { CampaignCsfResolver } from "./CampaignCsfResolver";
import { getCampaignFileNames } from "./CampaignFileNames";
import { CampaignIniParser, type CampaignParserOptions } from "./CampaignIniParser";
import type {
    CampaignCatalog,
    CampaignFileNames,
    CampaignSourceBundle,
    CampaignSourceDocument,
} from "./CampaignTypes";

export interface CampaignCatalogServiceOptions extends CampaignParserOptions {
    sourceBundle?: CampaignSourceBundle;
    iniSourceLoader?: IniSourceLoader;
    fileNames?: CampaignFileNames;
}

function available(vfs: VirtualFileSystem, fileName: string): boolean {
    try {
        return vfs.fileExists(fileName);
    }
    catch {
        return false;
    }
}

function discoverBattleClientFiles(vfs: VirtualFileSystem): string[] {
    const names = new Set<string>();
    try {
        for (const fileName of vfs.listFiles()) {
            const normalized = tryNormalizeGamePath(fileName);
            if (!normalized) {
                continue;
            }
            const leaf = gamePathLeaf(normalized);
            if (/^battleclient[^/]*\.ini$/i.test(leaf)) {
                names.add(normalized);
            }
        }
    }
    catch {
    }
    for (let index = 0; index <= 999; index++) {
        for (const candidate of [`BattleClient${index}.ini`, `battleclient${index}.ini`]) {
            if (available(vfs, candidate)) {
                names.add(candidate);
            }
        }
    }
    for (const candidate of ["BattleClient.ini", "INI/BattleClient.ini"]) {
        if (available(vfs, candidate)) {
            names.add(candidate);
        }
    }
    return [...names].sort((left, right) => {
        const leftNumber = Number(left.match(/battleclient(\d+)/i)?.[1] ?? 0);
        const rightNumber = Number(right.match(/battleclient(\d+)/i)?.[1] ?? 0);
        return leftNumber - rightNumber || left.localeCompare(right);
    });
}

export class CampaignCatalogService {
    private readonly profile: GameProfileId | GameProfileDescriptor;
    private readonly options: CampaignCatalogServiceOptions;

    constructor(
        private readonly vfs?: VirtualFileSystem,
        profile: GameProfileId | GameProfileDescriptor = "ra2",
        options: CampaignCatalogServiceOptions = {},
    ) {
        this.profile = profile;
        this.options = options;
    }

    load(): CampaignCatalog {
        const sources = this.options.sourceBundle ?? this.loadSources();
        const strings = this.vfs
            ? new CampaignCsfResolver(this.options.strings, this.vfs, this.profile)
            : this.options.strings;
        return new CampaignIniParser().parse(sources, {
            ...this.options,
            strings,
        });
    }

    async loadAsync(): Promise<CampaignCatalog> {
        if (this.vfs && !this.options.sourceBundle) {
            const profile = typeof this.profile === "string" ? getGameProfile(this.profile) : this.profile;
            try {
                await this.vfs.loadCampaignArchives(profile);
            }
            catch {
            }
        }
        return this.load();
    }

    getCatalog(): CampaignCatalog {
        return this.load();
    }

    private loadSources(): CampaignSourceBundle {
        if (!this.vfs) {
            return {
                battle: [],
                battleClients: [],
                mission: [],
                mapSelection: [],
                ui: [],
            };
        }
        const names = this.options.fileNames ?? getCampaignFileNames(this.profile);
        const loader = this.options.iniSourceLoader ?? new IniSourceLoader(this.vfs);
        const load = (fileName: string): CampaignSourceDocument | undefined => {
            if (!available(this.vfs!, fileName)) {
                return undefined;
            }
            try {
                const effective = loader.loadEffectiveIni(fileName);
                if (effective) {
                    return { fileName, ini: effective.ini };
                }
                return { fileName, ini: new IniFile(this.vfs!.openFile(fileName)) };
            }
            catch {
                try {
                    return { fileName, ini: new IniFile(this.vfs!.openFile(fileName)) };
                }
                catch {
                    return undefined;
                }
            }
        };
        const loadFirst = (fileNames: readonly string[]): CampaignSourceDocument[] => {
            for (const fileName of fileNames) {
                const document = load(fileName);
                if (document) {
                    return [document];
                }
            }
            return [];
        };
        return {
            battle: loadFirst(names.battle),
            battleClients: discoverBattleClientFiles(this.vfs)
                .map((fileName) => load(fileName))
                .filter((document): document is CampaignSourceDocument => Boolean(document)),
            mission: loadFirst(names.mission),
            mapSelection: loadFirst(names.mapSelection),
            ui: loadFirst(names.ui),
        };
    }
}

export function loadCampaignCatalog(
    vfs?: VirtualFileSystem,
    profile: GameProfileId | GameProfileDescriptor = "ra2",
    options: CampaignCatalogServiceOptions = {},
): CampaignCatalog {
    return new CampaignCatalogService(vfs, profile, options).load();
}

export async function loadCampaignCatalogAsync(
    vfs?: VirtualFileSystem,
    profile: GameProfileId | GameProfileDescriptor = "ra2",
    options: CampaignCatalogServiceOptions = {},
): Promise<CampaignCatalog> {
    return new CampaignCatalogService(vfs, profile, options).loadAsync();
}

export function createCampaignCatalogService(
    vfs?: VirtualFileSystem,
    profile: GameProfileId | GameProfileDescriptor = "ra2",
    options: CampaignCatalogServiceOptions = {},
): CampaignCatalogService {
    return new CampaignCatalogService(vfs, profile, options);
}
