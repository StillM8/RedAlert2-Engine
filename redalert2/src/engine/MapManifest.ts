import { IniFile, IniSection } from '../data/IniFile';
import type { GameModeEntry } from '../game/ini/GameModes';
import type { VirtualFile } from '../data/vfs/VirtualFile';
import type { Strings } from '../data/Strings';
import { normalizeGamePath } from './GamePath';
export class MapManifest {
    public fileName!: string;
    public uiName!: string;
    public maxSlots!: number;
    public official!: boolean;
    public gameModes!: GameModeEntry[];
    fromIni(section: IniSection, availableGameModes: GameModeEntry[]): this {
        const explicitFileName = section.getString("File");
        this.fileName = normalizeGamePath(explicitFileName || section.name.toLowerCase() + ".map");
        const description = section.getString("Description");
        // Retail catalogs use CSF keys such as DESC:MP03T4, while CnCNet-style
        // catalogs commonly contain literal names. Mark only literal text as
        // NOSTR so it does not become a failed localization lookup.
        this.uiName = description && !/^(?:NOSTR|[A-Za-z0-9_]+):/i.test(description)
            ? `NOSTR:${description}`
            : description;
        this.maxSlots = section.getNumber("MaxPlayers");
        this.official = true;
        const modeKey = section.has("GameModes") ? "GameModes" : "GameMode";
        const supportedModeFilters = section.getArray(modeKey).map((filter) => filter.toLocaleLowerCase("en-US"));
        this.gameModes = availableGameModes.filter((gm) =>
            supportedModeFilters.includes(gm.mapFilter.toLocaleLowerCase("en-US")));
        return this;
    }
    getFullMapTitle(strings: Strings): string {
        const mapTitle = strings.get(this.uiName);
        return this.addTitleSlotsSuffix(mapTitle, this.maxSlots);
    }
    private addTitleSlotsSuffix(title: string, maxPlayers: number): string {
        const startsWithSlots = title.match(/^\s*(\(|（)\s*\d(-\d)?\s*(\)|）)/);
        const endsWithSlots = title.match(/(\s*\(|（)\s*\d(-\d)?\s*(\)|）)\s*$/);
        if (!startsWithSlots && !endsWithSlots) {
            title += ` (2${maxPlayers > 2 ? "-" + maxPlayers : ""})`;
        }
        return title;
    }
    fromMapFile(mapFile: VirtualFile, availableGameModes: GameModeEntry[]): this {
        const mapContent = mapFile.readAsString();
        const mapFileName = mapFile.filename;
        const basicSectionContent = this.extractIniSection("Basic", mapContent);
        if (!basicSectionContent) {
            throw new Error(`Map "${mapFileName}" is missing the [Basic] section content`);
        }
        const basicIniFile = new IniFile(basicSectionContent);
        const basicSection = basicIniFile.getSection("Basic");
        if (!basicSection) {
            throw new Error(`Map "${mapFileName}" is missing the [Basic] section after parsing`);
        }
        // Keep the relative path in fileName so MapFileLoader can resolve
        // maps shipped below nested mod directories. Use
        // only the leaf name for the fallback UI label so long mod paths do
        // not spill out of the map picker.
        this.fileName = normalizeGamePath(mapFileName);
        const mapLeafName = mapFileName.split('/').pop() || mapFileName;
        this.uiName = "NOSTR:" + (basicSection.getString("Name") || mapLeafName.replace(/\.[^.]+$/, ""));
        const waypointsSectionContent = this.extractIniSection("Waypoints", mapContent);
        let maxPlayersFromWaypoints = 0;
        if (waypointsSectionContent) {
            const waypointsIniFile = new IniFile(waypointsSectionContent);
            const waypointsSection = waypointsIniFile.getSection("Waypoints");
            if (waypointsSection) {
                maxPlayersFromWaypoints = Array.from(waypointsSection.entries.keys()).filter((key) => Number(key) < 8).length;
            }
        }
        this.maxSlots = maxPlayersFromWaypoints;
        this.official = basicSection.getBool("Official");
        // Map authors commonly write "Standard" while the engine's mode
        // catalog stores the filter as "standard". Treat this metadata as
        // case-insensitive so mod maps are usable in
        // the skirmish and LAN map pickers.
        const supportedModeFilters = basicSection
            .getArray("GameMode", /,\s*/, ["standard"])
            .map((filter) => filter.toLowerCase());
        this.gameModes = availableGameModes.filter((gm) => supportedModeFilters.includes(gm.mapFilter.toLowerCase()));
        return this;
    }
    private extractIniSection(sectionName: string, content: string): string | undefined {
        const sectionStartTag = `[${sectionName}]`;
        const startIndex = content.indexOf(sectionStartTag);
        if (startIndex !== -1) {
            let endIndex = content.length;
            let nextSectionIndex = startIndex + sectionStartTag.length;
            while (nextSectionIndex < content.length) {
                const nlIndex = content.indexOf('\n', nextSectionIndex);
                if (nlIndex === -1) {
                    nextSectionIndex = content.length;
                    break;
                }
                let line = content.substring(nextSectionIndex, nlIndex).trim();
                if (line.startsWith('[') && line.endsWith(']')) {
                    endIndex = nextSectionIndex;
                    break;
                }
                nextSectionIndex = nlIndex + 1;
                if (!line) {
                    continue;
                }
                const potentialNextSectionStart = content.indexOf('\n[', startIndex + sectionStartTag.length);
                if (potentialNextSectionStart !== -1) {
                    endIndex = potentialNextSectionStart + 1;
                }
                else {
                    endIndex = content.length;
                }
                break;
            }
            let currentSearchIndex = startIndex + sectionStartTag.length;
            let nextSectionFoundIndex = -1;
            while (currentSearchIndex < content.length) {
                let nlIndex = content.indexOf('\n', currentSearchIndex);
                if (nlIndex === -1)
                    break;
                if (content.charAt(nlIndex + 1) === '[') {
                    nextSectionFoundIndex = nlIndex + 1;
                    break;
                }
                currentSearchIndex = nlIndex + 1;
            }
            endIndex = nextSectionFoundIndex !== -1 ? nextSectionFoundIndex : content.length;
            return content.slice(startIndex, endIndex).trim();
        }
        return undefined;
    }
}
