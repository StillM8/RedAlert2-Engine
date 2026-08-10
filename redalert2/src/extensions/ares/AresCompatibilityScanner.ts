import { AresFeatureRegistry, createDefaultAresFeatureRegistry, type ExtensionFeature } from "./AresFeatureRegistry";
import type { IniSourceLoader } from "@/engine/IniSourceLoader";
import { scanIniDependencies, type IniDependencyGraph } from "./AresDependencyScanner";

export interface IniScanSource {
    name: string;
    contents: string;
}

export type IniKeyClassification = "vanilla" | "known-extension" | "unknown-extension";

export interface IniKeyReference {
    source: string;
    line: number;
    section: string;
    key: string;
    value: string;
    classification: IniKeyClassification;
    featureId?: string;
}

export interface AresFeatureUsage {
    featureId: string;
    occurrences: number;
    /** Number of distinct INI source files contributing this feature. */
    sourceCount: number;
    /** Number of distinct sections containing this feature. */
    sectionCount: number;
    /** Number of distinct definitions affected by this feature. */
    definitionCount: number;
    references: IniKeyReference[];
    support?: ExtensionFeature;
}

export interface MentalOmegaCompatibilityReport {
    sourceCount: number;
    sectionCount: number;
    keyCount: number;
    uniqueKeys: number;
    uniqueExtensionKeys: number;
    knownExtensionKeys: number;
    unknownExtensionKeys: number;
    vanillaKeys: number;
    references: IniKeyReference[];
    featureUsage: AresFeatureUsage[];
    dependencyGraph: IniDependencyGraph;
    sideCountryCoverage: {
        sideDefinitions: number;
        sideReferences: number;
        unknownSideReferences: number;
        countryDefinitions: number;
        countryReferences: number;
        unknownCountryReferences: number;
    };
}

const VANILLA_KEY_PATTERNS: ReadonlyArray<readonly [RegExp, RegExp]> = [
    [/^general$/i, /^(name|baseunit|buildspeed|credits|startingunits|startingcredits|timer|unitcount|harvestercount|aislots|walls|water|tiberium|ore|growth|repair|repairbay|prerequisite|techlevel|buildlimit|owner|forbiddenhouses|requiredhouses|sides|alliances|speed|cost|power|storage|harvesters|refinery|conyard|radar|sight|cloak|cloakable|infiltratable|capturable|selectable|voice|theme|scenario|game|map|theater)$/i],
    [/^(technotypes|infantrytypes|vehicletypes|aircrafttypes|buildingtypes|animtypes|weapontypes|warheadtypes|projectiletypes|superweapontypes)$/i, /^(0|\d+|name|uiName|image|art|strength|health|armor|speed|cost|power|sight|range|rof|primary|secondary|eliteprimary|elitesec|weapon|warhead|projectile|owner|prerequisite|techlevel|buildlimit|techno|category|locomotor|movementzone|size|foundation|deploysinto|undeploysinto|ammo|burst|damage|verses|cellspread|percent|anim|report|sound|report|cloak|cloakable|capturable|spyable|crusher|crusherable|passengers|passengersexits|open topped|opentopped|naval|airport|helipad|factory|superweapon|type|action|range|lineofsight|speed|acceleration|inaccurate|arcing|rotates|invisible|homing|splits|cluster|palette)$/i],
    [/^(sides|countries|multiplayercountries|aicountries)$/i, /^(0|\d+|name|uiName|side|color|prefix|suffix|loadscreen|flag|multiplayer|selectable|crew|survivordivisor|base defenses|basedefenses|buildings|units|infantry|vehicles|aircraft)$/i],
    [/^(scripttypes|taskforces|teamtypes|triggers|events|actions|tags|cels|celltags)$/i, /^(0|\d+|name|script|team|taskforce|priority|house|trigger|event|action|teamtype|waypoint|count|condition|parameter|recruiter|transports|autocreate|autocreate|whiner|annoyance|prebuild|reinforcements)$/i],
];

const GENERIC_VANILLA_KEYS = /^(name|uiname|image|art|cost|power|strength|health|armor|speed|sight|range|rof|primary|secondary|eliteprimary|elitesec|weapon|warhead|projectile|owner|prerequisite|techlevel|buildlimit|category|locomotor|movementzone|size|foundation|ammo|burst|damage|verses|cellspread|percent|anim|report|sound|cloak|cloakable|capturable|spyable|passengers|opentopped|naval|type|action|palette)$/i;

function isVanillaKey(section: string, key: string): boolean {
    return GENERIC_VANILLA_KEYS.test(key) || VANILLA_KEY_PATTERNS.some(([sectionPattern, keyPattern]) =>
        sectionPattern.test(section) && keyPattern.test(key));
}

function featureForKey(section: string, key: string, value: string): string | undefined {
    if (/^emp\.threshold$/i.test(key)) {
        return "ares.emp-threshold";
    }
    if (/^empulsecannon$/i.test(key)) {
        return "ares.superweapon-empulse";
    }
    if (/^(?:emp\.(?:duration|cap|sparkles)|immuneToEMP|emp\.modifier)$/i.test(key)) {
        return "ares.emp";
    }
    if (/^genericprerequisites$/i.test(section)) {
        return "ares.generic-prerequisites";
    }
    if (/^factoryowners(?:\.(?:forbidden|hasallplans|permanent))?$/i.test(key)) {
        return "ares.factory-owner-prerequisites";
    }
    if (/^prerequisite\.(?:list\d+|lists|negative|requiredtheaters|stolentechs)$/i.test(key) ||
        (/^general$/i.test(section) && /^prerequisite.+alternate$/i.test(key))) {
        return "ares.generic-prerequisites";
    }
    if (/^armortypes$/i.test(section) || /^versus\./i.test(key)) {
        return "ares.additional-armor-types";
    }
    if (/^empulse\./i.test(key) || /^empulsecannon$/i.test(key)) {
        return "ares.superweapon-empulse";
    }
    if (/^droppod\./i.test(key) ||
        (/^general$/i.test(section) && /^droppod(?:types|minimum|maximum|trailer)$/i.test(key)) ||
        (/^type$/i.test(key) && /^droppod$/i.test(value))) {
        return "ares.superweapon-drop-pod";
    }
    if (/^sw\.(?:requirestarget|requireshouse)$/i.test(key)) {
        return "ares.superweapon-target-requirements";
    }
    if (/^sw\.fireintoshroud$/i.test(key)) {
        return "ares.superweapon-shroud-targeting";
    }
    if (/^sw\.(?:initialready|virtualcharge)$/i.test(key)) {
        return "ares.superweapon-charge-state";
    }
    if (/^sw\.deferment$/i.test(key)) {
        return "ares.superweapon-deferment";
    }
    if (/^sw\.postdependent$/i.test(key)) {
        return "ares.superweapon-post-dependent";
    }
    if (/^sw\.createradarevent$/i.test(key)) {
        return "ares.superweapon-radar-event";
    }
    if (/^sw\.range$/i.test(key)) {
        return "ares.superweapon-range";
    }
    if (/^sw\.(?:aitargeting|aitargeting\.constraints|aitargeting\.preference|airequirestarget|airequireshouse|useaitargeting)$/i.test(key)) {
        return "ares.superweapon-ai-targeting";
    }
    if (/^money\.(?:amount|drainamount|draindelay)$/i.test(key)) {
        return "ares.superweapon-money";
    }
    if (/^superweapons$/i.test(key) ||
        /^(?:SW|Deliver|DropPod|Battery|HunterSeeker|Firestorm|GenericWarhead|ChronoWarp|SonarPulse)\./i.test(key) ||
        (/^type$/i.test(key) && /^(?:GenericWarhead|UnitDelivery|Firestorm|HunterSeeker|DropPod|EMPulse|Battery|SonarPulse|ChronoWarp)$/i.test(value))) {
        return "ares.custom-superweapons";
    }
    if (/^ares[._]/i.test(key)) {
        const lower = key.toLocaleLowerCase("en-US");
        if (lower.includes("armor") || lower.includes("verse")) return "ares.additional-armor-types";
        if (lower.includes("side")) return "ares.custom-sides";
        if (lower.includes("country")) return "ares.custom-countries";
        if (lower.includes("prereq")) return "ares.generic-prerequisites";
        if (lower.includes("foundation")) return "ares.custom-foundations";
        if (lower.includes("superweapon")) return "ares.custom-superweapons";
        if (lower.includes("passenger")) return "ares.passenger-extensions";
        if (lower.includes("palette")) return "ares.custom-animation-palettes";
        if (lower.includes("projectile") || lower.includes("split") || lower.includes("airburst")) return "ares.projectile-extensions";
        if (lower.includes("stage") || lower.includes("burst")) return "ares.staged-weapons";
        if (lower.includes("effect") || lower.includes("attach")) return "ares.status-effects";
        return "ares.unknown-key";
    }
    if (/^foundation$/i.test(key) && /custom/i.test(value)) return "ares.custom-foundations";
    if (/^foundation\.(?:x|y|\d+|outline(?:\.length|\.\d+)?)$/i.test(key)) return "ares.custom-foundations";
    if (/^(splits|airburst|cluster|proximity|retarget|homing)\b/i.test(key)) return "ares.projectile-extensions";
    if (/^(stage|weaponstage|burstdelay|charge)\b/i.test(key)) return "ares.staged-weapons";
    if (/^(passengerdelete|passengerconsume|passengerslots?)\b/i.test(key)) return "ares.passenger-extensions";
    if (/^(palette|animpalette|projectilepalette)$/i.test(key) && /anim|projectile|weapon|warhead/i.test(section)) {
        return "ares.custom-animation-palettes";
    }
    return undefined;
}

const DEFINITION_LIST_SECTIONS = /^(armortypes|sides|countries|multiplayercountries|aicountries|technotypes|infantrytypes|vehicletypes|aircrafttypes|buildingtypes|animtypes|weapontypes|warheadtypes|projectiletypes|superweapontypes|scripttypes|taskforces|teamtypes|triggers|events|actions|tags|cels|celltags)$/i;

function referenceIdentity(reference: IniKeyReference): {
    source: string;
    section: string;
    definition: string;
} {
    const source = reference.source.toLocaleLowerCase("en-US");
    const section = reference.section.toLocaleLowerCase("en-US");
    // In list sections, each key/value entry defines a distinct object. In
    // object sections, the section itself is the definition. This keeps the
    // report useful for both [ArmorTypes] tables and [SomeUnit] sections.
    const definition = DEFINITION_LIST_SECTIONS.test(reference.section)
        ? `${section}\0${reference.key.toLocaleLowerCase("en-US")}`
        : section;
    return { source, section: `${source}\0${section}`, definition: `${source}\0${definition}` };
}

function parseSource(source: IniScanSource, registry: AresFeatureRegistry): IniKeyReference[] {
    const references: IniKeyReference[] = [];
    let section = "(global)";
    const lines = source.contents.replace(/^\uFEFF/, "").split(/\r?\n/);
    lines.forEach((rawLine, index) => {
        const line = rawLine.trim();
        if (!line || line.startsWith(";") || line.startsWith("#")) return;
        const sectionMatch = line.match(/^\[([^\]]+)\]/);
        if (sectionMatch) {
            section = sectionMatch[1].trim();
            return;
        }
        const equals = line.indexOf("=");
        if (equals <= 0) return;
        const key = line.slice(0, equals).trim();
        const value = line.slice(equals + 1).trim().replace(/\s+[;#].*$/, "");
        const featureId = featureForKey(section, key, value);
        const classification: IniKeyClassification = featureId
            ? "known-extension"
            : isVanillaKey(section, key)
                ? "vanilla"
                : "unknown-extension";
        references.push({
            source: source.name,
            line: index + 1,
            section,
            key,
            value,
            classification,
            featureId,
        });
    });
    // Make sure the registry's unknown bucket is always available when the
    // scanner sees an extension key that has no feature mapping.
    if (!registry.has("ares.unknown-key")) {
        registry.register({
            id: "ares.unknown-key",
            description: "An extension-like key with no registered semantics",
            implemented: false,
            parserImplemented: false,
            runtimeImplemented: false,
            tests: [],
        });
    }
    for (const reference of references) {
        if (reference.classification === "unknown-extension") {
            reference.featureId = "ares.unknown-key";
        }
    }
    return references;
}

export function scanMentalOmegaIniSources(
    sources: readonly IniScanSource[],
    registry: AresFeatureRegistry = createDefaultAresFeatureRegistry(),
): MentalOmegaCompatibilityReport {
    const references = sources.flatMap((source) => parseSource(source, registry));
    const uniqueKeys = new Set(references.map((ref) => `${ref.section.toLocaleLowerCase("en-US")}\0${ref.key.toLocaleLowerCase("en-US")}`));
    const extensionRefs = references.filter((ref) => ref.classification !== "vanilla");
    const uniqueExtensionKeys = new Set(extensionRefs.map((ref) => `${ref.section.toLocaleLowerCase("en-US")}\0${ref.key.toLocaleLowerCase("en-US")}`));
    const usage = new Map<string, AresFeatureUsage>();
    const impact = new Map<string, {
        sources: Set<string>;
        sections: Set<string>;
        definitions: Set<string>;
    }>();
    for (const reference of extensionRefs) {
        const featureId = reference.featureId ?? "ares.unknown-key";
        const existing = usage.get(featureId);
        const identity = referenceIdentity(reference);
        if (existing) {
            existing.occurrences++;
            existing.references.push(reference);
        }
        else {
            usage.set(featureId, {
                featureId,
                occurrences: 1,
                sourceCount: 0,
                sectionCount: 0,
                definitionCount: 0,
                references: [reference],
                support: registry.get(featureId),
            });
        }
        const featureImpact = impact.get(featureId) ?? {
            sources: new Set<string>(),
            sections: new Set<string>(),
            definitions: new Set<string>(),
        };
        featureImpact.sources.add(identity.source);
        featureImpact.sections.add(identity.section);
        featureImpact.definitions.add(identity.definition);
        impact.set(featureId, featureImpact);
    }
    for (const [featureId, featureUsage] of usage) {
        const featureImpact = impact.get(featureId)!;
        featureUsage.sourceCount = featureImpact.sources.size;
        featureUsage.sectionCount = featureImpact.sections.size;
        featureUsage.definitionCount = featureImpact.definitions.size;
    }
    const dependencyGraph = scanIniDependencies(sources);
    const sideCoverage = dependencyGraph.coverage.find((coverage) => coverage.kind === "side");
    const countryCoverage = dependencyGraph.coverage.find((coverage) => coverage.kind === "country");
    return {
        sourceCount: sources.length,
        sectionCount: new Set(references.map((ref) => `${ref.source}\0${ref.section.toLocaleLowerCase("en-US")}`)).size,
        keyCount: references.length,
        uniqueKeys: uniqueKeys.size,
        uniqueExtensionKeys: uniqueExtensionKeys.size,
        knownExtensionKeys: extensionRefs.filter((ref) => ref.classification === "known-extension").length,
        unknownExtensionKeys: extensionRefs.filter((ref) => ref.classification === "unknown-extension").length,
        vanillaKeys: references.filter((ref) => ref.classification === "vanilla").length,
        references,
        featureUsage: [...usage.values()].sort((a, b) => b.occurrences - a.occurrences || a.featureId.localeCompare(b.featureId)),
        dependencyGraph,
        sideCountryCoverage: {
            sideDefinitions: sideCoverage?.definitions ?? 0,
            sideReferences: sideCoverage?.references ?? 0,
            unknownSideReferences: sideCoverage?.unresolved ?? 0,
            countryDefinitions: countryCoverage?.definitions ?? 0,
            countryReferences: countryCoverage?.references ?? 0,
            unknownCountryReferences: countryCoverage?.unresolved ?? 0,
        },
    };
}

export interface VfsTextReader {
    fileExists(filename: string): boolean;
    openFile(filename: string): { readAsString(): string };
    listFiles?(): string[];
}

export interface EffectiveIniReader {
    loadEffectiveIni(filename: string): {
        ini: { toString(): string };
    } | undefined;
}

/**
 * Scan the active VFS without requiring proprietary MO files in the source
 * tree.  MIX entries are hash-addressable, so the known profile INIs are
 * always queried explicitly; loose files are included when the archive can
 * enumerate them.
 */
export function scanMentalOmegaVfs(
    vfs: VfsTextReader,
    registry: AresFeatureRegistry = createDefaultAresFeatureRegistry(),
    sourceLoader?: EffectiveIniReader | IniSourceLoader,
): MentalOmegaCompatibilityReport {
    const candidateNames = new Set([
        "rules.ini",
        "rulesmd.ini",
        "rulesmo.ini",
        "art.ini",
        "artmd.ini",
        "artmo.ini",
        "ai.ini",
        "aimd.ini",
        "aimo.ini",
        "ui.ini",
        "uimd.ini",
        "uimo.ini",
    ]);
    // With an effective loader, included files are reached from their entry
    // point and must not be counted a second time as independent roots. The
    // raw fallback keeps the old archive-enumeration behavior for callers that
    // have not mounted an IniSourceLoader yet.
    if (!sourceLoader) {
        for (const filename of vfs.listFiles?.() ?? []) {
            if (/\.(?:ini|csf)$/i.test(filename)) candidateNames.add(filename);
        }
    }
    const sources: IniScanSource[] = [];
    for (const filename of candidateNames) {
        try {
            if (vfs.fileExists(filename)) {
                const effective = sourceLoader?.loadEffectiveIni(filename);
                sources.push({
                    name: effective ? `${filename} (effective)` : filename,
                    contents: effective?.ini.toString() ?? vfs.openFile(filename).readAsString(),
                });
            }
        }
        catch {
            // Missing/hash-only files are reported by the resource diagnostics;
            // one unreadable optional INI must not hide the rest of the scan.
        }
    }
    return scanMentalOmegaIniSources(sources, registry);
}

export function formatMentalOmegaCompatibilityReport(report: MentalOmegaCompatibilityReport): string {
    const lines = [
        "MENTAL OMEGA EXTENSION REQUIREMENTS",
        `Sources: ${report.sourceCount}`,
        `INI keys: ${report.keyCount} (${report.uniqueKeys} unique)`,
        `Vanilla keys: ${report.vanillaKeys}`,
        `Known extension keys: ${report.knownExtensionKeys}`,
        `Unknown extension keys: ${report.unknownExtensionKeys}`,
        "",
        "FEATURE USAGE",
    ];
    for (const usage of report.featureUsage) {
        const support = usage.support;
        const status = !support
            ? "unregistered"
            : support.implemented
                ? "verified"
                : support.parserImplemented
                    ? "parsed-only"
                    : "runtime-missing";
        lines.push(`${usage.featureId}: ${usage.occurrences} occurrence(s), ${usage.definitionCount} definition(s), ${usage.sourceCount} source(s), ${status}`);
    }
    lines.push(
        "",
        "SIDES",
        `defined: ${report.sideCountryCoverage.sideDefinitions}`,
        `references: ${report.sideCountryCoverage.sideReferences}`,
        `unknown references: ${report.sideCountryCoverage.unknownSideReferences}`,
        "COUNTRIES",
        `defined: ${report.sideCountryCoverage.countryDefinitions}`,
        `references: ${report.sideCountryCoverage.countryReferences}`,
        `unknown references: ${report.sideCountryCoverage.unknownCountryReferences}`,
    );
    lines.push("", "DEPENDENCY COVERAGE");
    for (const coverage of report.dependencyGraph.coverage) {
        lines.push(`${coverage.kind}: ${coverage.definitions} definition(s), ${coverage.references} reference(s), ${coverage.unresolved} unresolved`);
    }
    if (report.dependencyGraph.unresolved.length) {
        lines.push("", "UNRESOLVED DEFINITIONS");
        for (const edge of report.dependencyGraph.unresolved.slice(0, 50)) {
            lines.push(`${edge.source} [${edge.section}] ${edge.key}=${edge.value} -> ${edge.kind}`);
        }
    }
    return lines.join("\n");
}
