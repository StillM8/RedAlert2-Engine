import { SideType } from "@/game/SideType";

export type SideId = string;
export type CountryId = string;

interface IniSectionLike {
    entries: Map<string, any>;
}

interface IniReader {
    getSection(name: string): IniSectionLike | undefined;
}

export interface SideDescriptor {
    id: SideId;
    /** Authored order in the [Sides] list. */
    order?: number;
    /** Legacy name retained for callers that still use the old adapter. */
    index?: number;
    /** Optional vanilla adapter; extension sides deliberately leave this unset. */
    legacySide?: SideType;
    uiName?: string;
    defaultCountry?: string;
    presentationId?: string;
    sidebarMixFileIndex?: number;
    sidebarYuriFileNames?: boolean;
    evaTag?: string;
    loadingTheme?: string;
    crew?: string;
    engineer?: string;
    technician?: string;
    survivorDivisor?: number;
    defaultDisguise?: string;
    /** Preserve unmodeled side fields for diagnostics and later capability parsing. */
    properties?: Readonly<Record<string, string>>;
}

export type HudLayout = "allied" | "soviet" | "yuri";

/**
 * Presentation data is deliberately separate from the simulation side ID.
 * Vanilla HUD code still has a few layout adapters, but custom sides no
 * longer need to masquerade as an out-of-range SideType value to reach them.
 */
export interface SidePresentation {
    id: string;
    hudLayout: HudLayout;
    sidebarMixFileIndex: number;
    useYuriFileNames: boolean;
    evaTag?: string;
    loadingTheme?: string;
}

export interface CountryDescriptor {
    id: CountryId;
    sideId: SideId;
    /** Authored order in the [Countries] list. */
    order?: number;
    uiName?: string;
    uiTooltip?: string;
    presentationId?: string;
    flag?: string;
    multiplayerSelectable: boolean;
    multiplayerPassive?: boolean;
    randomSelectionWeight: number;
    listIndex: number;
    loadScreen?: string;
    loadScreenPalette?: string;
    /** Preserve unmodeled country fields without losing extension data. */
    properties?: Readonly<Record<string, string>>;
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

export function resolveSidePresentation(
    side: SideDescriptor | undefined,
    legacySide: SideType = SideType.GDI,
    defaultYuriFileNames = false,
): SidePresentation {
    const mixSelection = resolveSideMixSelection(side, legacySide, defaultYuriFileNames);
    const presentationId = normalize(side?.presentationId ?? side?.id ?? "");
    const isAllied = presentationId === "gdi" || presentationId === "allied" ||
        (legacySide === SideType.GDI && !presentationId.includes("yuri"));
    const isYuri = presentationId === "yuri" || presentationId === "thirdside" ||
        legacySide === SideType.Yuri || mixSelection.useYuriFileNames;
    return {
        id: side?.presentationId ?? side?.id ?? String(legacySide),
        hudLayout: isYuri ? "yuri" : isAllied ? "allied" : "soviet",
        sidebarMixFileIndex: mixSelection.mixFileIndex,
        useYuriFileNames: mixSelection.useYuriFileNames,
        evaTag: side?.evaTag,
        loadingTheme: side?.loadingTheme,
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

function sectionProperties(section: IniSectionLike | undefined): Record<string, string> {
    if (!section) return {};
    return Object.fromEntries([...section.entries].map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map((item) => String(item)).join(",") : String(value),
    ]));
}

function indexedEntries(section: IniSectionLike | undefined): Array<{ index: number; name: string }> {
    if (!section) return [];
    return [...section.entries]
        .filter(([key, value]) => /^\d+$/.test(key) && typeof value === "string" && value.trim())
        .map(([key, value]) => ({ index: Number(key), name: String(value).trim() }))
        .sort((a, b) => a.index - b.index);
}

function inferLegacySide(id: string): SideType | undefined {
    switch (normalize(id)) {
        case "gdi":
        case "allied":
            return SideType.GDI;
        case "nod":
        case "soviet":
            return SideType.Nod;
        case "civilian":
            return SideType.Civilian;
        case "mutant":
            return SideType.Mutant;
        case "thirdside":
        case "yuri":
            return SideType.Yuri;
        default:
            return undefined;
    }
}

export class AresSideRegistry {
    private readonly sides = new Map<string, SideDescriptor>();

    static fromIni(ini: IniReader): AresSideRegistry {
        const registry = new AresSideRegistry();
        const list = indexedEntries(ini.getSection("Sides"));
        const names = list.length
            ? list
            : ["GDI", "Nod", "Civilian", "ThirdSide"].map((name, index) => ({ index, name }));
        names.forEach(({ index, name: id }) => {
            const section = ini.getSection(id);
            registry.register({
                id,
                order: index,
                index,
                legacySide: inferLegacySide(id),
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
                crew: sectionValue(section, "Crew"),
                engineer: sectionValue(section, "Engineer"),
                technician: sectionValue(section, "Technician"),
                survivorDivisor: sectionValue(section, "SurvivorDivisor") === undefined
                    ? undefined
                    : sectionNumber(section, "SurvivorDivisor", 0),
                defaultDisguise: sectionValue(section, "DefaultDisguise"),
                properties: sectionProperties(section),
            });
        });
        return registry;
    }

    register(side: SideDescriptor): void {
        const order = Number.isInteger(side.order) ? side.order! : side.index ?? this.sides.size;
        this.sides.set(normalize(side.id), {
            ...side,
            order,
            index: side.index ?? order,
        });
    }

    resolve(id: string | undefined): SideDescriptor | undefined {
        return id ? this.sides.get(normalize(id)) : undefined;
    }

    has(id: string): boolean {
        return this.sides.has(normalize(id));
    }

    get(id: string): SideDescriptor {
        const side = this.resolve(id);
        if (!side) throw new Error(`Unknown side "${id}"`);
        return { ...side };
    }

    list(): SideDescriptor[] {
        return [...this.sides.values()]
            .sort((a, b) => (a.order ?? a.index ?? 0) - (b.order ?? b.index ?? 0))
            .map((side) => ({ ...side }));
    }

    /** Returns a legacy value only when the side has an explicit vanilla mapping. */
    resolveLegacySide(id: string | undefined): SideType | undefined {
        const side = this.resolve(id);
        return side?.legacySide ?? (id ? inferLegacySide(id) : undefined);
    }

    /**
     * Legacy adapter for old renderer/simulation call sites. Dynamic code must
     * use SideId directly. The fallback is explicit and diagnosable instead of
     * interpreting an arbitrary authored index as Yuri/Soviet/etc.
     */
    toLegacySide(id: string, strict = false): SideType {
        const legacySide = this.resolveLegacySide(id);
        if (legacySide !== undefined) return legacySide;
        if (strict) {
            throw new Error(`Side "${id}" has no legacy SideType mapping`);
        }
        return SideType.Civilian;
    }
}

export class AresCountryRegistry {
    private readonly countries = new Map<string, CountryDescriptor>();
    private readonly unknownSideReferences = new Map<CountryId, SideId>();

    static fromIni(ini: IniReader, sides: AresSideRegistry): AresCountryRegistry {
        const registry = new AresCountryRegistry();
        for (const { index, name: id } of indexedEntries(ini.getSection("Countries"))) {
            const section = ini.getSection(id);
            const sideId = sectionValue(section, "Side") ?? "Civilian";
            if (!sides.has(sideId)) {
                registry.unknownSideReferences.set(id, sideId);
            }
            registry.register({
                id,
                sideId: sides.resolve(sideId)?.id ?? sideId,
                order: index,
                uiName: sectionValue(section, "UIName"),
                uiTooltip: sectionValue(section, "UITooltip"),
                presentationId: sectionValue(section, "Presentation"),
                flag: sectionValue(section, "Flag"),
                multiplayerSelectable: sectionBool(section, "Multiplay"),
                multiplayerPassive: sectionBool(section, "MultiplayPassive"),
                randomSelectionWeight: sectionNumber(section, "RandomSelectionWeight", 1),
                listIndex: sectionNumber(section, "ListIndex", 100),
                loadScreen: sectionValue(section, "LoadingScreen") ?? sectionValue(section, "LoadScreen"),
                loadScreenPalette: sectionValue(section, "LoadingScreenPalette") ?? sectionValue(section, "LoadScreenPalette"),
                properties: sectionProperties(section),
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

    has(id: string): boolean {
        return this.countries.has(normalize(id));
    }

    get(id: string): CountryDescriptor {
        const country = this.resolve(id);
        if (!country) throw new Error(`Unknown country "${id}"`);
        return { ...country };
    }

    unknownSideRefs(): Array<{ countryId: CountryId; sideId: SideId }> {
        return [...this.unknownSideReferences.entries()].map(([countryId, sideId]) => ({ countryId, sideId }));
    }

    list(): CountryDescriptor[] {
        return [...this.countries.values()]
            .sort((a, b) => (a.listIndex - b.listIndex) || ((a.order ?? 0) - (b.order ?? 0)))
            .map((country) => ({ ...country }));
    }

    /** The authored definition order, independent of lobby ListIndex ordering. */
    definitionOrder(): CountryDescriptor[] {
        return [...this.countries.values()]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((country) => ({ ...country }));
    }

    multiplayerCountries(): CountryDescriptor[] {
        return this.list().filter((country) => country.multiplayerSelectable && !country.multiplayerPassive);
    }
}

/** Extension-facing names; the Ares prefix remains as a source-compatibility alias. */
export { AresSideRegistry as SideRegistry, AresCountryRegistry as CountryRegistry };
