import { IniFile } from "@/data/IniFile";
import type { IniSection } from "@/data/IniSection";
import { parseAresCampaignButtons } from "./CampaignButtonModel";
import { resolveCampaignLabel } from "./CampaignCsfResolver";
import {
    VANILLA_CAMPAIGN_FALLBACKS,
    type CampaignCatalog,
    type CampaignDefinition,
    type CampaignDiagnostic,
    type CampaignMissionDefinition,
    type CampaignMissionIdentity,
    type CampaignSide,
    type CampaignSourceBundle,
    type CampaignSourceDocument,
    type CampaignStringResolver,
    type CampaignText,
    type CampaignUiSettings,
} from "./CampaignTypes";
import { tryNormalizeGamePath } from "@/engine/GamePath";

export interface CampaignParserOptions {
    strings?: CampaignStringResolver;
    showDebugCampaigns?: boolean;
    campaignList?: boolean;
    showSummary?: boolean;
    campaignListSize?: number;
}

interface LocatedValue {
    found: boolean;
    value?: string;
    document?: CampaignSourceDocument;
}

interface ProgressionEntry {
    section?: string;
    scenario: string;
    index: number;
    sourceFile: string;
}

const battleMetadataSections = new Set(["uisettings", "battle", "general", "versioninfo"]);

function textValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}

function firstLocated(...values: LocatedValue[]): LocatedValue {
    return values.find((value) => value.found) ?? { found: false };
}

function valueOf(section: IniSection | undefined, keys: string[]): LocatedValue {
    if (!section) {
        return { found: false };
    }
    for (const key of keys) {
        const value = textValue(section.get(key));
        if (value !== undefined) {
            return { found: true, value };
        }
    }
    return { found: false };
}

function valueFromDocuments(
    documents: CampaignSourceDocument[],
    sectionNames: string[],
    keys: string[],
): LocatedValue {
    for (let documentIndex = documents.length - 1; documentIndex >= 0; documentIndex--) {
        const document = documents[documentIndex];
        for (const sectionName of sectionNames) {
            const result = valueOf(document.ini.getSection(sectionName), keys);
            if (result.found) {
                return { ...result, document };
            }
        }
    }
    return { found: false };
}

function boolValue(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback;
    }
    const normalized = value.trim().toLocaleLowerCase("en-US");
    if (["yes", "y", "true", "1", "on", "enabled"].includes(normalized)) {
        return true;
    }
    if (["no", "n", "false", "0", "off", "disabled"].includes(normalized)) {
        return false;
    }
    return fallback;
}

function numberValue(value: string | undefined): number | undefined {
    if (value === undefined || !value.trim()) {
        return undefined;
    }
    const normalized = value.trim().replace(/%$/, "");
    const parsed = /^[-+]?0x[0-9a-f]+$/i.test(normalized)
        ? Number.parseInt(normalized, 16)
        : Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function sideValue(value: string | undefined): CampaignSide | undefined {
    if (value === undefined || !value.trim() || ["none", "no", "default"].includes(value.trim().toLocaleLowerCase("en-US"))) {
        return undefined;
    }
    const numeric = numberValue(value);
    return numeric === undefined ? value.trim() : numeric;
}

function normalizedScenario(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed || ["none", "no", "null"].includes(trimmed.toLocaleLowerCase("en-US"))) {
        return undefined;
    }
    const normalized = tryNormalizeGamePath(trimmed);
    return normalized ?? trimmed;
}

function sameScenario(left: string | undefined, right: string | undefined): boolean {
    if (!left || !right) {
        return false;
    }
    const normalizedLeft = tryNormalizeGamePath(left) ?? left;
    const normalizedRight = tryNormalizeGamePath(right) ?? right;
    return normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US");
}

function sectionEntries(section: IniSection | undefined): Array<[string, string]> {
    if (!section) {
        return [];
    }
    return [...section.entries.entries()]
        .map(([key, value]) => [key, textValue(value) ?? ""] as [string, string])
        .filter(([, value]) => value.length > 0);
}

function cloneValues(section: IniSection | undefined): Record<string, string | string[]> {
    const values: Record<string, string | string[]> = {};
    for (const [key, value] of section?.entries ?? []) {
        values[key] = Array.isArray(value) ? [...value] : value;
    }
    return values;
}

function fallbackFor(id: string): {
    title: string;
    sideName: string;
    subline: string;
    hoverSound: string;
} {
    const exact = VANILLA_CAMPAIGN_FALLBACKS[id];
    if (exact) {
        return exact;
    }
    const upper = id.toLocaleUpperCase("en-US");
    return VANILLA_CAMPAIGN_FALLBACKS[upper] ?? {
        title: id,
        sideName: "",
        subline: id,
        hoverSound: "",
    };
}

function inferSide(id: string, rawSide: string | undefined, sideName: string | undefined): CampaignSide | undefined {
    const explicit = sideValue(rawSide);
    if (explicit !== undefined) {
        return explicit;
    }
    if (/^ALL/i.test(id)) {
        return 0;
    }
    if (/^SOV/i.test(id)) {
        return 1;
    }
    if (/^(?:YUR|THIRD)/i.test(id)) {
        return 4;
    }
    if (/^TUT/i.test(id)) {
        return 0;
    }
    return sideName || undefined;
}

function sideSectionNames(side: CampaignSide | undefined, sideName: string | undefined, id: string): string[] {
    const names = new Set<string>();
    if (typeof side === "number") {
        if (side === 0) {
            names.add("GDI");
            names.add("Allies");
            names.add("Allied");
        }
        else if (side === 1) {
            names.add("Nod");
            names.add("Soviet");
            names.add("Soviets");
        }
        else if (side === 2 || side === 4) {
            names.add("ThirdSide");
            names.add("Yuri");
        }
    }
    else if (typeof side === "string") {
        names.add(side);
    }
    if (sideName) {
        names.add(sideName);
    }
    if (side === undefined) {
        if (/^ALL/i.test(id)) {
            names.add("GDI");
        }
        if (/^SOV/i.test(id)) {
            names.add("Nod");
        }
        if (/^(?:YUR|THIRD)/i.test(id)) {
            names.add("ThirdSide");
        }
    }
    return [...names];
}

function mapFileCandidates(scenario: string): string[] {
    const normalized = normalizedScenario(scenario);
    if (!normalized) {
        return [];
    }
    const leaf = normalized.split("/").pop()!;
    const stem = leaf.replace(/\.[^.]+$/, "");
    return [normalized, leaf, stem];
}

function findMissionSection(documents: CampaignSourceDocument[], scenario: string): { document: CampaignSourceDocument; section: IniSection } | undefined {
    const candidates = mapFileCandidates(scenario);
    for (const document of documents) {
        for (const candidate of candidates) {
            const section = document.ini.getSection(candidate);
            if (section) {
                return { document, section };
            }
        }
    }
    return undefined;
}

function parseMission(
    documents: CampaignSourceDocument[],
    scenario: string | undefined,
    strings?: CampaignStringResolver,
): CampaignMissionDefinition | undefined {
    if (!scenario) {
        return undefined;
    }
    const found = findMissionSection(documents, scenario);
    if (!found) {
        return undefined;
    }
    const briefingValue = valueOf(found.section, ["Briefing", "LSLoadBriefing"]);
    const uiNameValue = valueOf(found.section, ["UIName", "LSLoadMessage"]);
    const summaryValue = valueOf(found.section, ["Summary"]);
    return {
        section: found.section.name,
        mapFile: scenario,
        briefing: briefingValue.found
            ? resolveCampaignLabel(briefingValue.value, briefingValue.value ?? "", strings)
            : undefined,
        uiName: uiNameValue.found
            ? resolveCampaignLabel(uiNameValue.value, uiNameValue.value ?? "", strings)
            : undefined,
        summary: summaryValue.found
            ? resolveCampaignLabel(summaryValue.value, summaryValue.value ?? "", strings)
            : undefined,
        values: cloneValues(found.section),
    };
}

function resolveMapselEntry(
    token: string,
    source: CampaignSourceDocument,
    documents: CampaignSourceDocument[],
): ProgressionEntry | undefined {
    const trimmed = token.trim();
    if (!trimmed || ["none", "no"].includes(trimmed.toLocaleLowerCase("en-US"))) {
        return undefined;
    }
    const direct = normalizedScenario(trimmed);
    const sectionNames = [trimmed, ...mapFileCandidates(trimmed)];
    const directSection = sectionNames
        .map((sectionName) => source.ini.getSection(sectionName))
        .find(Boolean) ?? documents
        .slice()
        .reverse()
        .flatMap((document) => sectionNames.map((sectionName) => document.ini.getSection(sectionName)))
        .find(Boolean);
    if (directSection) {
        const scenarioValue = valueOf(directSection, ["Scenario", "MapFile", "Map"]);
        const scenario = normalizedScenario(scenarioValue.value) ?? direct;
        if (!scenario) {
            return undefined;
        }
        return {
            section: directSection.name,
            scenario,
            index: 0,
            sourceFile: source.fileName,
        };
    }
    if (direct && /\.(?:map|mpr|yrm|yro|mmx)$/i.test(direct)) {
        return {
            scenario: direct,
            index: 0,
            sourceFile: source.fileName,
        };
    }
    return undefined;
}

function progressionFor(
    documents: CampaignSourceDocument[],
    definition: Pick<CampaignDefinition, "id" | "side" | "sideName" | "scenario">,
): ProgressionEntry[] {
    const names = sideSectionNames(definition.side, definition.sideName, definition.id);
    const entries: ProgressionEntry[] = [];
    for (const document of documents) {
        for (const name of names) {
            const section = document.ini.getSection(name);
            if (!section) {
                continue;
            }
            let order = 0;
            for (const [key, rawValue] of sectionEntries(section)) {
                if (!/^\d+$/.test(key) || !["anims", "sounds"].includes(key.toLocaleLowerCase("en-US"))) {
                    if (/^\d+$/.test(key)) {
                        const entry = resolveMapselEntry(rawValue, document, documents);
                        if (entry) {
                            entries.push({ ...entry, index: order });
                            order++;
                        }
                    }
                }
            }
            if (entries.length) {
                return entries;
            }
        }
    }
    return entries;
}

function resolveNextScenario(
    documents: CampaignSourceDocument[],
    definition: CampaignDefinition,
    progression: ProgressionEntry[],
): CampaignMissionIdentity | undefined {
    const explicitNext = normalizedScenario(definition.nextScenario);
    const alternateNext = normalizedScenario(definition.altNextScenario);
    let nextScenario = explicitNext;
    let nextEntry: ProgressionEntry | undefined;
    if (!nextScenario) {
        const currentIndex = progression.findIndex((entry) => sameScenario(entry.scenario, definition.scenario));
        if (currentIndex >= 0 && currentIndex + 1 < progression.length) {
            nextEntry = progression[currentIndex + 1];
            nextScenario = nextEntry.scenario;
        }
    }
    if (!nextScenario) {
        nextScenario = alternateNext;
    }
    if (!nextScenario) {
        return undefined;
    }
    const resolvedEntry = nextEntry ?? progression.find((entry) => sameScenario(entry.scenario, nextScenario));
    return {
        battleId: definition.id,
        side: definition.side,
        sideName: definition.sideName,
        section: resolvedEntry?.section,
        scenario: nextScenario,
        mapFile: nextScenario,
        altNextScenario: alternateNext,
        index: resolvedEntry?.index,
        sourceFile: resolvedEntry?.sourceFile,
    };
}

function readSettings(documents: CampaignSourceDocument[], options: CampaignParserOptions): CampaignUiSettings {
    const section = documents
        .slice()
        .reverse()
        .map((document) => document.ini.getSection("UISettings"))
        .find(Boolean);
    const campaignListValue = valueOf(section, ["CampaignList"]);
    const debugValue = valueOf(section, ["ShowDebugCampaigns"]);
    const summaryValue = valueOf(section, ["ShowSummary"]);
    const sizeValue = valueOf(section, ["CampaignListSize"]);
    const showSummary = options.showSummary ?? boolValue(summaryValue.value, true);
    const requestedSize = options.campaignListSize ?? numberValue(sizeValue.value) ?? 7;
    const maximum = showSummary ? 14 : 18;
    return {
        campaignList: options.campaignList ?? boolValue(campaignListValue.value, false),
        showDebugCampaigns: options.showDebugCampaigns ?? boolValue(debugValue.value, false),
        showSummary,
        campaignListSize: Math.min(maximum, Math.max(3, Math.floor(requestedSize))),
    };
}

function listCampaignIds(documents: CampaignSourceDocument[], diagnostics: CampaignDiagnostic[]): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const document of documents) {
        const section = document.ini.getSection("Battles");
        for (const [, rawValue] of sectionEntries(section)) {
            const id = rawValue.trim();
            if (!id || ["no", "none"].includes(id.toLocaleLowerCase("en-US"))) {
                continue;
            }
            const normalized = id.toLocaleLowerCase("en-US");
            if (!seen.has(normalized)) {
                seen.add(normalized);
                ids.push(id);
            }
        }
    }
    if (ids.length) {
        return ids;
    }
    for (const document of documents) {
        for (const section of document.ini.getOrderedSections()) {
            const name = section.name.trim();
            const normalizedName = name.toLocaleLowerCase("en-US");
            if (!name || name === "__ROOT__" || battleMetadataSections.has(normalizedName)) {
                continue;
            }
            if (valueOf(section, ["Scenario", "MapFile", "Map"]).found) {
                const normalized = name.toLocaleLowerCase("en-US");
                if (!seen.has(normalized)) {
                    seen.add(normalized);
                    ids.push(name);
                }
            }
        }
    }
    if (!ids.length && documents.length) {
        diagnostics.push({
            code: "invalid-entry",
            message: "No campaign entries were found in [Battles]",
        });
    }
    return ids;
}

function textFor(
    raw: LocatedValue,
    fallbackLabel: string,
    fallbackValue: string,
    resolver?: CampaignStringResolver,
): CampaignText {
    if (!raw.found) {
        return resolveCampaignLabel(undefined, fallbackLabel, resolver, fallbackValue);
    }
    return resolveCampaignLabel(raw.value, fallbackLabel, resolver);
}

function definitionFor(
    id: string,
    documents: CampaignSourceDocument[],
    missionDocuments: CampaignSourceDocument[],
    mapSelectionDocuments: CampaignSourceDocument[],
    buttons: ReturnType<typeof parseAresCampaignButtons>,
    resolver: CampaignStringResolver | undefined,
    diagnostics: CampaignDiagnostic[],
): CampaignDefinition {
    const sections = documents
        .slice()
        .reverse()
        .map((document) => ({ document, section: document.ini.getSection(id) }))
        .filter((entry): entry is { document: CampaignSourceDocument; section: IniSection } => Boolean(entry.section));
    const sourceDocument = sections[0]?.document ?? documents[0];
    const battleDocument = sourceDocument ?? { fileName: "", ini: new IniFile() };
    const get = (keys: string[]) => valueFromDocuments(documents, [id], keys);
    const scenarioRaw = get(["Scenario", "MapFile", "Map", "Mission"]);
    const scenario = normalizedScenario(scenarioRaw.value);
    const fallback = fallbackFor(id);
    const sideNameRaw = get(["SideName", "Side"]).value;
    const sideNameText = textFor(
        firstLocated(
            valueFromDocuments(documents, [id], ["SideName"]),
            valueFromDocuments(documents, ["Battle"], ["SideName"]),
        ),
        fallback.sideName,
        fallback.sideName,
        resolver,
    );
    const side = inferSide(id, get(["Side"]).value, sideNameRaw);
    const description = textFor(
        get(["Description", "Name", "CampaignName"]),
        fallback.subline,
        fallback.title,
        resolver,
    );
    const mission = parseMission(missionDocuments, scenario, resolver);
    const summary = mission?.summary ?? textFor(
        firstLocated(
            get(["Summary"]),
            valueFromDocuments(documents, ["Battle"], ["Summary"]),
        ),
        description.label,
        description.value,
        resolver,
    );
    const longDescription = textFor(
        get(["LongDescription"]),
        description.label,
        description.value,
        resolver,
    );
    const button = buttons.buttons.find((candidate) => candidate.battleId?.toLocaleLowerCase("en-US") === id.toLocaleLowerCase("en-US"));
    const enabled = boolValue(get(["Enabled", "Available", "CampaignEnabled"]).value, true);
    const debugOnly = boolValue(get(["DebugOnly", "Debug", "CampaignDebugOnly"]).value, false);
    const cd = numberValue(get(["CD"]).value);
    const act = numberValue(get(["Act"]).value);
    const buildOffAlly = boolValue(get(["BuildOffAlly", "BuildOff", "AllowBuildOffAlly"]).value, false);
    const finalMovieValue = get(["FinalMovie", "Movie"]).value;
    const finalMovie = numberValue(finalMovieValue) ?? normalizedScenario(finalMovieValue);
    const nextScenario = normalizedScenario(get(["NextScenario", "NextMission", "Next"]).value);
    const altNextScenario = normalizedScenario(get(["AltNextScenario", "AlternateNextScenario", "AltNext"]).value);
    const hoverSound = firstLocated(
        get(["HoverSound"]),
        valueFromDocuments(documents, ["Battle"], ["HoverSound"]),
    ).value?.trim() || fallback.hoverSound;
    const provisional: CampaignDefinition = {
        id,
        battleId: id,
        battleFile: battleDocument.fileName,
        sourceFile: battleDocument.fileName,
        enabled,
        debugOnly,
        scenario,
        mapFile: scenario,
        cd,
        side,
        act,
        sideName: sideNameText.value || sideNameRaw,
        sideNameLabel: sideNameText.label,
        buildOffAlly,
        summary,
        description,
        longDescription,
        finalMovie,
        nextScenario,
        altNextScenario,
        hoverSound,
        mission,
        presentation: {
            title: description.value || fallback.title,
            description: description.value,
            longDescription: longDescription.value,
            summary: summary.value,
            sideName: sideNameText.value || fallback.sideName,
            hoverSound,
            image: button?.image,
            palette: button?.palette,
            subline: button?.subline,
            tooltip: button?.tooltip,
        },
    };
    const progression = progressionFor(mapSelectionDocuments, provisional);
    provisional.nextMission = resolveNextScenario(mapSelectionDocuments, provisional, progression);
    if (!scenario) {
        diagnostics.push({
            code: "invalid-entry",
            message: `Campaign "${id}" has no Scenario`,
            file: battleDocument.fileName,
            section: id,
        });
    }
    if (!sections.length) {
        diagnostics.push({
            code: "invalid-entry",
            message: `Campaign "${id}" has no definition section`,
            file: battleDocument.fileName,
            section: id,
        });
    }
    return provisional;
}

function uniqueSourceFiles(documents: CampaignSourceDocument[]): string[] {
    const seen = new Set<string>();
    return documents
        .map((document) => document.fileName)
        .filter((fileName) => {
            const key = fileName.toLocaleLowerCase("en-US");
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
}

export class CampaignIniParser {
    constructor(private readonly defaults: CampaignParserOptions = {}) {
    }

    parse(sources: CampaignSourceBundle, options: CampaignParserOptions = {}): CampaignCatalog {
        const parserOptions = { ...this.defaults, ...options };
        const diagnostics: CampaignDiagnostic[] = [];
        const battleDocuments = [...sources.battle, ...sources.battleClients];
        const buttons = parseAresCampaignButtons(sources.ui[sources.ui.length - 1], parserOptions.strings);
        const settings = readSettings(sources.ui, parserOptions);
        const ids = listCampaignIds(battleDocuments, diagnostics);
        const allCampaigns = ids.map((id) => definitionFor(
            id,
            battleDocuments,
            sources.mission,
            sources.mapSelection,
            buttons,
            parserOptions.strings,
            diagnostics,
        ));
        const campaigns = allCampaigns.filter((campaign) =>
            campaign.enabled &&
            Boolean(campaign.scenario) &&
            (!campaign.debugOnly || settings.showDebugCampaigns));
        return {
            campaigns,
            allCampaigns,
            settings,
            buttons,
            diagnostics,
            sourceFiles: {
                battle: uniqueSourceFiles(sources.battle),
                battleClients: uniqueSourceFiles(sources.battleClients),
                mission: uniqueSourceFiles(sources.mission),
                mapSelection: uniqueSourceFiles(sources.mapSelection),
                ui: uniqueSourceFiles(sources.ui),
            },
        };
    }

    parseIni(sources: CampaignSourceBundle, options: CampaignParserOptions = {}): CampaignCatalog {
        return this.parse(sources, options);
    }
}

export function parseCampaignIni(sources: CampaignSourceBundle, options: CampaignParserOptions = {}): CampaignCatalog {
    return new CampaignIniParser().parse(sources, options);
}
