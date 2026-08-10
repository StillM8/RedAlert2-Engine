import { SideType } from "@/game/SideType";

interface IniSectionLike {
    entries: Map<string, any>;
}

interface IniReader {
    getSection(name: string): IniSectionLike | undefined;
}

export interface SideDescriptor {
    id: string;
    index: number;
    uiName?: string;
    defaultCountry?: string;
    presentationId?: string;
    sidebarMixFileIndex?: number;
    sidebarYuriFileNames?: boolean;
    evaTag?: string;
    loadingTheme?: string;
}

export interface CountryDescriptor {
    id: string;
    sideId: string;
    uiName?: string;
    multiplayerSelectable: boolean;
    randomSelectionWeight: number;
    listIndex: number;
    loadScreen?: string;
}

export interface SideMixSelection {
    mixFileIndex: number;
    baseMixFile: string;
    expansionMixFile: string;
    compatibilityMixFile: string;
    useYuriFileNames: boolean;
}

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

export function resolveSideMixSelection(
    side: SideDescriptor | undefined,
    legacySide: SideType = SideType.GDI,
    defaultYuriFileNames = false,
): SideMixSelection {
    const fallbackIndex = legacySide === SideType.GDI ? 1 : 2;
    const configuredIndex = side?.sidebarMixFileIndex;
    const mixFileIndex = Number.isInteger(configuredIndex) && configuredIndex! > 0
        ? configuredIndex!
        : fallbackIndex;
    const suffix = String(mixFileIndex).padStart(2, "0");
    return {
        mixFileIndex,
        baseMixFile: `sidec${suffix}.mix`,
        expansionMixFile: `sidec${suffix}md.mix`,
        compatibilityMixFile: `sidec${suffix}cd.mix`,
        useYuriFileNames: side?.sidebarYuriFileNames ?? defaultYuriFileNames,
    };
}

function sectionValue(section: IniSectionLike | undefined, name: string): string | undefined {
    if (!section) return undefined;
    for (const [key, value] of section.entries) {
        if (normalize(key) === normalize(name)) {
            return Array.isArray(value) ? String(value[0]) : String(value);
        }
    }
    return undefined;
}

function sectionBool(section: IniSectionLike | undefined, name: string, fallback = false): boolean {
    const value = sectionValue(section, name)?.trim().toLocaleLowerCase("en-US");
    if (!value) return fallback;
    return ["yes", "true", "1", "on"].includes(value) ? true
        : ["no", "false", "0", "off"].includes(value) ? false
            : fallback;
}

function sectionNumber(section: IniSectionLike | undefined, name: string, fallback: number): number {
    const value = Number(sectionValue(section, name));
    return Number.isFinite(value) ? value : fallback;
}

function indexedNames(section: IniSectionLike | undefined): string[] {
    if (!section) return [];
    return [...section.entries]
        .filter(([key, value]) => /^\d+$/.test(key) && typeof value === "string" && value.trim())
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, value]) => String(value).trim());
}

export class AresSideRegistry {
    private readonly sides = new Map<string, SideDescriptor>();

    static fromIni(ini: IniReader): AresSideRegistry {
        const registry = new AresSideRegistry();
        const list = indexedNames(ini.getSection("Sides"));
        const names = list.length ? list : ["GDI", "Nod", "Civilian", "ThirdSide"];
        names.forEach((id, index) => {
            const section = ini.getSection(id);
            registry.register({
                id,
                index,
                uiName: sectionValue(section, "UIName"),
                defaultCountry: sectionValue(section, "DefaultCountry"),
                presentationId: sectionValue(section, "Presentation") ?? id,
                sidebarMixFileIndex: sectionValue(section, "Sidebar.MixFileIndex") === undefined
                    ? undefined
                    : sectionNumber(section, "Sidebar.MixFileIndex", 0),
                sidebarYuriFileNames: sectionValue(section, "Sidebar.YuriFileNames") === undefined
                    ? undefined
                    : sectionBool(section, "Sidebar.YuriFileNames"),
                evaTag: sectionValue(section, "EVA.Tag"),
                loadingTheme: sectionValue(section, "LoadingTheme"),
            });
        });
        return registry;
    }

    register(side: SideDescriptor): void {
        this.sides.set(normalize(side.id), { ...side });
    }

    resolve(id: string | undefined): SideDescriptor | undefined {
        return id ? this.sides.get(normalize(id)) : undefined;
    }

    list(): SideDescriptor[] {
        return [...this.sides.values()].sort((a, b) => a.index - b.index).map((side) => ({ ...side }));
    }

    /** Preserve old UI/simulation aliases while retaining the data-defined ID. */
    toLegacySide(id: string): SideType {
        const normalized = normalize(id);
        if (normalized === "gdi") return SideType.GDI;
        if (normalized === "nod") return SideType.Nod;
        if (normalized === "civilian") return SideType.Civilian;
        if (normalized === "mutant") return SideType.Mutant;
        if (normalized === "thirdside" || normalized === "yuri") return SideType.Yuri;
        return this.resolve(id)?.index as SideType ?? SideType.Civilian;
    }
}

export class AresCountryRegistry {
    private readonly countries = new Map<string, CountryDescriptor>();

    static fromIni(ini: IniReader, sides: AresSideRegistry): AresCountryRegistry {
        const registry = new AresCountryRegistry();
        for (const id of indexedNames(ini.getSection("Countries"))) {
            const section = ini.getSection(id);
            const sideId = sectionValue(section, "Side") ?? "Civilian";
            registry.register({
                id,
                sideId: sides.resolve(sideId)?.id ?? sideId,
                uiName: sectionValue(section, "UIName"),
                multiplayerSelectable: sectionBool(section, "Multiplay"),
                randomSelectionWeight: sectionNumber(section, "RandomSelectionWeight", 1),
                listIndex: sectionNumber(section, "ListIndex", 100),
                loadScreen: sectionValue(section, "LoadingScreen") ?? sectionValue(section, "LoadScreen"),
            });
        }
        return registry;
    }

    register(country: CountryDescriptor): void {
        this.countries.set(normalize(country.id), { ...country });
    }

    resolve(id: string | undefined): CountryDescriptor | undefined {
        return id ? this.countries.get(normalize(id)) : undefined;
    }

    list(): CountryDescriptor[] {
        return [...this.countries.values()].sort((a, b) => a.listIndex - b.listIndex).map((country) => ({ ...country }));
    }
}
