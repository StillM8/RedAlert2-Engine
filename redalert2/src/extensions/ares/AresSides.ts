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
    tooltipColor?: string;
    evaTag?: string;
    loadingTheme?: string;
    graphicalTextImage?: string;
    graphicalTextPalette?: string;
    multiplayerScoreBackground?: string;
    multiplayerScorePalette?: string;
    multiplayerScoreBars?: string;
    multiplayerScoreWinTheme?: string;
    multiplayerScoreLoseTheme?: string;
    crew?: string;
    engineer?: string;
    technician?: string;
    survivorDivisor?: number;
    defaultDisguise?: string;
    /** Antares side-level Hunter Seeker TechnoType fallback. */
    hunterSeeker?: string;
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
    tooltipColor?: string;
    evaTag?: string;
    loadingTheme?: string;
    graphicalTextImage: string;
    graphicalTextPalette: string;
}

export interface MultiplayerScorePresentation {
    image: string;
    palette: string;
    bars: string;
    winTheme?: string;
    loseTheme?: string;
}

export const ARES_MULTIPLAYER_SCORE_BAR_COUNT = 10;

/**
 * Expands Ares' MultiplayerScore.Bars filename pattern. Ares reserves ten
 * files: two caption bars followed by up to eight player bars. A pattern
 * without `~~` is kept as one explicit asset so custom clients can still use
 * a single decorative bar without manufacturing ten duplicate names.
 */
export function expandAresMultiplayerScoreBars(pattern: string | undefined): string[] {
    const filename = pattern?.trim();
    if (!filename) return [];
    if (!filename.includes("~~")) return [filename];
    return Array.from({ length: ARES_MULTIPLAYER_SCORE_BAR_COUNT }, (_, index) =>
        filename.replace(/~~/g, String(index + 1).padStart(2, "0")),
    );
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
    loadScreenTextName?: string;
    loadScreenTextSpecialName?: string;
    loadScreenTextBrief?: string;
    loadScreenTextColor?: string;
    multiplayerSelectable: boolean;
    multiplayerPassive?: boolean;
    /** Ares country-level CanBeDriven override. */
    canBeDriven?: boolean;
    randomSelectionWeight: number;
    listIndex: number;
    loadScreen?: string;
    loadScreenPalette?: string;
    loadingTheme?: string;
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

function parseTooltipColor(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const channels = value.split(",").map((channel) => Number(channel.trim()));
    if (channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
        return undefined;
    }
    return `rgb(${channels.join(",")})`;
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
    // Sidebar.YuriFileNames selects the Yuri-named sidebar assets (for example
    // radary.shp/radary.pal). It does not make the entire side use the Yuri
    // HUD geometry. Ares custom sides such as Foehn can opt into those asset
    // names while still using their own Allied/Soviet-style layout.
    const isYuri = presentationId === "yuri" || presentationId === "thirdside" ||
        legacySide === SideType.Yuri;
    return {
        id: side?.presentationId ?? side?.id ?? String(legacySide),
        hudLayout: isYuri ? "yuri" : isAllied ? "allied" : "soviet",
        sidebarMixFileIndex: mixSelection.mixFileIndex,
        useYuriFileNames: mixSelection.useYuriFileNames,
        tooltipColor: parseTooltipColor(side?.tooltipColor),
        evaTag: side?.evaTag,
        loadingTheme: side?.loadingTheme,
        graphicalTextImage: side?.graphicalTextImage ?? "grfxtxt.shp",
        graphicalTextPalette: side?.graphicalTextPalette ?? "grfxtxt.pal",
    };
}

/** Country overrides take precedence over the side default for multiplayer loading audio. */
export function resolveLoadingTheme(
    side: SideDescriptor | undefined,
    country: Pick<CountryDescriptor, "loadingTheme"> | undefined,
): string | undefined {
    return country?.loadingTheme ?? side?.loadingTheme;
}

/**
 * Resolves Ares' per-side multiplayer score assets. Ares uses the Allied and
 * Soviet defaults for their corresponding legacy sides and the Yuri assets
 * for other sides unless the side supplies explicit overrides.
 */
export function resolveMultiplayerScorePresentation(
    side: SideDescriptor | undefined,
    legacySide: SideType = SideType.Civilian,
): MultiplayerScorePresentation {
    const defaults = legacySide === SideType.GDI
        ? { image: "mpascrnl.shp", palette: "mpascrn.pal", bars: "mpascrnlbar~~.pcx" }
        : legacySide === SideType.Nod
            ? { image: "mpsscrnl.shp", palette: "mpsscrn.pal", bars: "mpsscrnlbar~~.pcx" }
            : { image: "mpyscrnl.shp", palette: "mpyscrn.pal", bars: "mpyscrnlbar~~.pcx" };
    return {
        image: side?.multiplayerScoreBackground ?? defaults.image,
        palette: side?.multiplayerScorePalette ?? defaults.palette,
        bars: side?.multiplayerScoreBars ?? defaults.bars,
        winTheme: side?.multiplayerScoreWinTheme,
        loseTheme: side?.multiplayerScoreLoseTheme,
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

/**
 * Ares accepts two [Sides] list encodings.  Synthetic/legacy fixtures often
 * use the numbered form (`0=Allied`), while real Ares rules commonly use the
 * authored side IDs as keys (`GDI=...`, `FourthSide=...`).  The right-hand
 * value in the named form is the country list; the key is the side identity
 * that the rest of the ruleset references.
 */
function sideEntries(section: IniSectionLike | undefined): Array<{ index: number; name: string }> {
    const numbered = indexedEntries(section);
    if (numbered.length || !section) return numbered;
    return [...section.entries]
        .filter(([key, value]) => !/^\d+$/.test(key) && typeof value === "string" && value.trim())
        .map(([key], index) => ({ index, name: String(key).trim() }));
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
        const list = sideEntries(ini.getSection("Sides"));
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
                tooltipColor: sectionValue(section, "ToolTipColor"),
                evaTag: sectionValue(section, "EVA.Tag"),
                loadingTheme: sectionValue(section, "LoadingTheme"),
                graphicalTextImage: sectionValue(section, "GraphicalText.Image"),
                graphicalTextPalette: sectionValue(section, "GraphicalText.Palette"),
                multiplayerScoreBackground: sectionValue(section, "MultiplayerScore.Background"),
                multiplayerScorePalette: sectionValue(section, "MultiplayerScore.Palette"),
                multiplayerScoreBars: sectionValue(section, "MultiplayerScore.Bars"),
                multiplayerScoreWinTheme: sectionValue(section, "MultiplayerScore.WinTheme"),
                multiplayerScoreLoseTheme: sectionValue(section, "MultiplayerScore.LoseTheme"),
                crew: sectionValue(section, "Crew"),
                engineer: sectionValue(section, "Engineer"),
                technician: sectionValue(section, "Technician"),
                survivorDivisor: sectionValue(section, "SurvivorDivisor") === undefined
                    ? undefined
                    : sectionNumber(section, "SurvivorDivisor", 0),
                defaultDisguise: sectionValue(section, "DefaultDisguise"),
                hunterSeeker: sectionValue(section, "HunterSeeker"),
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

    /**
     * Resolve the authored numeric side index used by legacy rules keys such
     * as AIBasePlanningSide without turning that index into a closed enum.
     * Ares content may define sides that have no SideType adapter at all.
     */
    resolveByIndex(index: number): SideDescriptor | undefined {
        if (!Number.isInteger(index) || index < 0) return undefined;
        return this.list().find((side) => side.index === index || side.order === index);
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
                uiTooltip: sectionValue(section, "MenuText.Status") ?? sectionValue(section, "UITooltip"),
                presentationId: sectionValue(section, "Presentation"),
                flag: sectionValue(section, "File.Flag") ?? sectionValue(section, "Flag"),
                loadScreenTextName: sectionValue(section, "LoadScreenText.Name"),
                loadScreenTextSpecialName: sectionValue(section, "LoadScreenText.SpecialName"),
                loadScreenTextBrief: sectionValue(section, "LoadScreenText.Brief"),
                loadScreenTextColor: sectionValue(section, "LoadScreenText.Color"),
                multiplayerSelectable: sectionBool(section, "Multiplay"),
                multiplayerPassive: sectionBool(section, "MultiplayPassive"),
                canBeDriven: sectionValue(section, "CanBeDriven") !== undefined
                    ? sectionBool(section, "CanBeDriven")
                    : sectionBool(section, "MultiplayPassive"),
                randomSelectionWeight: sectionNumber(section, "RandomSelectionWeight", 1),
                listIndex: sectionNumber(section, "ListIndex", 100),
                loadScreen: sectionValue(section, "File.LoadScreen") ?? sectionValue(section, "LoadingScreen") ?? sectionValue(section, "LoadScreen"),
                loadScreenPalette: sectionValue(section, "File.LoadScreenPAL") ?? sectionValue(section, "LoadingScreenPalette") ?? sectionValue(section, "LoadScreenPalette"),
                loadingTheme: sectionValue(section, "LoadingTheme"),
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
        return this.list().filter((country) => country.multiplayerSelectable && !country.multiplayerPassive && country.listIndex >= 0);
    }
}

/** Extension-facing names; the Ares prefix remains as a source-compatibility alias. */
export { AresSideRegistry as SideRegistry, AresCountryRegistry as CountryRegistry };
