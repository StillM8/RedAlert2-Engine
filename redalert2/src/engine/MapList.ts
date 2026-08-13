import { MapManifest } from './MapManifest';
import type { GameModes, GameModeEntry } from '../game/ini/GameModes';
import type { IniFile, IniSection } from '../data/IniFile';
import type { VirtualFile } from '../data/vfs/VirtualFile';
import { gamePathKey, tryNormalizeGamePath } from './GamePath';
export class MapList {
    private gameModes: GameModes;
    private manifests: MapManifest[] = [];
    constructor(gameModes: GameModes) {
        this.gameModes = gameModes;
    }
    addFromIni(iniFile: IniFile): this {
        const multiMapsSection = iniFile.getSection("MultiMaps");
        if (!multiMapsSection) {
            throw new Error("Invalid map list. Missing [MultiMaps] section.");
        }
        const newManifests = Array.from(multiMapsSection.entries.values()).map((rawSectionKey) => {
            const sectionKey = Array.isArray(rawSectionKey)
                ? rawSectionKey[0]
                : rawSectionKey;
            const mapSection = iniFile.getSection(sectionKey);
            if (!mapSection) {
                throw new Error(`Invalid map list. Missing [${sectionKey}] section.`);
            }
            return new MapManifest().fromIni(mapSection, this.gameModes.getAll());
        });
        this.manifests = this.manifests.concat(newManifests);
        this.dedupeEntries();
        return this;
    }
    add(manifest: MapManifest): void {
        this.manifests.push(manifest);
    }
    addFromMapFile(mapFile: VirtualFile): void {
        this.add(new MapManifest().fromMapFile(mapFile, this.gameModes.getAll()));
    }
    getAll(): MapManifest[] {
        return this.manifests;
    }
    getByName(fileName: string): MapManifest | undefined {
        const normalized = tryNormalizeGamePath(fileName);
        if (!normalized) {
            return undefined;
        }
        const key = gamePathKey(normalized);
        return this.manifests.find((manifest) => gamePathKey(manifest.fileName) === key);
    }
    sortByName(): void {
        this.manifests.sort((a, b) => a.fileName.localeCompare(b.fileName));
    }
    clone(): MapList {
        const newList = new MapList(this.gameModes);
        newList.manifests = [...this.manifests];
        return newList;
    }
    mergeWith(otherList: MapList): this {
        this.manifests.push(...otherList.manifests);
        this.dedupeEntries();
        return this;
    }
    private dedupeEntries(): void {
        this.manifests = [
            ...new Map(this.manifests.map((manifest) => [gamePathKey(manifest.fileName), manifest])).values(),
        ];
    }
}
