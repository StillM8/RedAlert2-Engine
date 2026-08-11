/**
 * Audits a locally-owned Mental Omega installation against the generic Ares
 * compatibility scanner.
 *
 * Usage:
 *   bun scripts/mental-omega-audit.ts "/path/to/RA2 MO" --write
 *
 * The input installation is never copied into the repository.  --write only
 * writes the aggregate Markdown report requested by the compatibility audit.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { IniFile, type IniSection } from "../redalert2/src/data/IniFile";
import { MixFile } from "../redalert2/src/data/MixFile";
import { VirtualFile } from "../redalert2/src/data/vfs/VirtualFile";
import { VirtualFileSystem } from "../redalert2/src/data/vfs/VirtualFileSystem";
import { ResourceLayer } from "../redalert2/src/data/vfs/ResourceLayer";
import { IniSourceLoader } from "../redalert2/src/engine/IniSourceLoader";
import { getGameProfile } from "../redalert2/src/engine/GameProfile";
import {
    scanMentalOmegaVfs,
    type IniKeyReference,
    type IniKeyUsage,
    type MentalOmegaCompatibilityReport,
} from "../redalert2/src/extensions/ares/AresCompatibilityScanner";
import { createDefaultAresFeatureRegistry } from "../redalert2/src/extensions/ares/AresFeatureRegistry";
import {
    getAresCapability,
    getAresImplementationCapability,
} from "../redalert2/src/extensions/ares/AresFeatureCatalog";

const installRoot = resolve(process.argv[2] ?? process.env.MO_INSTALL_DIR ?? "");
const shouldWrite = process.argv.includes("--write");
const reportPath = resolve(process.cwd(), "docs/MentalOmegaRequirementReport.md");

if (!installRoot || !existsSync(installRoot)) {
    console.error("Usage: bun scripts/mental-omega-audit.ts /path/to/RA2-MO-install [--write]");
    process.exit(2);
}

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase("en-US");
}

function markdown(value: unknown): string {
    return String(value ?? "")
        .replace(/\r?\n/g, " ")
        .replace(/\|/g, "\\|")
        .trim();
}

function valuesOf(value: string | string[] | undefined): string[] {
    if (value === undefined) return [];
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
}

function sectionByName(ini: IniFile, name: string): IniSection | undefined {
    const expected = normalize(name);
    return ini.getOrderedSections().find((section) => normalize(section.name) === expected);
}

function listNames(ini: IniFile, sectionName: string): string[] {
    const section = sectionByName(ini, sectionName);
    if (!section) return [];
    return [...section.entries.entries()]
        .filter(([key]) => /^\d+$/.test(key))
        .sort(([left], [right]) => Number(left) - Number(right))
        .flatMap(([, value]) => valuesOf(value));
}

function entryValue(section: IniSection | undefined, key: string): string | undefined {
    if (!section) return undefined;
    const expected = normalize(key);
    for (const [actualKey, value] of section.entries) {
        if (normalize(actualKey) === expected) return valuesOf(value)[0];
    }
    return undefined;
}

function entryValues(section: IniSection | undefined, key: string): string[] {
    if (!section) return [];
    const expected = normalize(key);
    for (const [actualKey, value] of section.entries) {
        if (normalize(actualKey) === expected) return valuesOf(value);
    }
    return [];
}

function archiveOrder(names: string[]): string[] {
    const priority = (name: string): [number, number, string] => {
        const lower = name.toLocaleLowerCase("en-US");
        const moExpand = lower.match(/^expandmo(\d+)\.mix$/);
        if (moExpand) return [0, -Number(moExpand[1]), lower];
        if (lower === "multimo.mix" || lower === "thememo.mix") return [1, 0, lower];
        const mdExpand = lower.match(/^expandmd(\d+)\.mix$/);
        if (mdExpand) return [2, -Number(mdExpand[1]), lower];
        const expand = lower.match(/^expand(\d+)\.mix$/);
        if (expand) return [3, -Number(expand[1]), lower];
        return [4, 0, lower];
    };
    return [...names].sort((left, right) => {
        const a = priority(left);
        const b = priority(right);
        return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
    });
}

function createVfs(): { vfs: VirtualFileSystem; archives: string[] } {
    const mixFiles = readdirSync(installRoot)
        .filter((name) => /\.mix$/i.test(name))
        .filter((name) => /^(?:expandmo\d+|expandmd\d+|multimo|thememo|ra2md|multimd|ra2|multi|language|langmd)\.mix$/i.test(name))
        .map((name) => join(installRoot, name));
    const orderedPaths = archiveOrder(mixFiles.map((path) => path.split(/[\\/]/).pop()!))
        .map((name) => join(installRoot, name));
    const vfs = new VirtualFileSystem(undefined as any, {
        info: () => undefined,
        warn: (message) => console.warn(message),
        error: (message) => console.error(message),
    });
    for (const filename of orderedPaths) {
        const archiveName = filename.split(/[\\/]/).pop()!;
        const bytes = new Uint8Array(readFileSync(filename));
        const virtualFile = VirtualFile.fromBytes(bytes, filename);
        // MixFile currently emits development-only header diagnostics for the
        // first entries of every archive. They are not audit findings.
        const originalLog = console.log;
        console.log = (...args: unknown[]) => {
            if (typeof args[0] === "string" && args[0].startsWith("[Our]")) return;
            originalLog(...args);
        };
        let archive: MixFile;
        try {
            archive = new MixFile(virtualFile.stream);
        }
        finally {
            console.log = originalLog;
        }
        vfs.addArchive(archive, archiveName, {
            id: archiveName,
            layer: ResourceLayer.ModPatch,
            source: "mod",
            profile: "mental-omega",
            provenance: [filename],
        });
    }
    return { vfs, archives: orderedPaths.map((path) => path.split(/[\\/]/).pop()!) };
}

interface RawRootStats {
    name: string;
    bytes: number;
    sectionHeaders: number;
    uniqueSections: number;
    keyEntries: number;
}

function rawStats(name: string, contents: string, bytes: number): RawRootStats {
    const sections = new Set<string>();
    let sectionHeaders = 0;
    let keyEntries = 0;
    for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = rawLine.trim();
        const section = line.match(/^\[([^\]]+)\]/);
        if (section) {
            sectionHeaders++;
            sections.add(normalize(section[1]));
        }
        else if (line && !line.startsWith(";") && !line.startsWith("#") && line.indexOf("=") > 0) {
            keyEntries++;
        }
    }
    return { name, bytes, sectionHeaders, uniqueSections: sections.size, keyEntries };
}

function usageTable(usage: readonly IniKeyUsage[], limit = usage.length): string[] {
    const lines = [
        "| Key | Occurrences | Source files | Section kinds | Sample sections | Sample values |",
        "|---|---:|---|---|---|---|",
    ];
    for (const item of usage.slice(0, limit)) {
        lines.push(`| ${markdown(item.key)} | ${item.occurrences} | ${markdown(item.sourceFiles.join(", "))} | ${markdown(item.sectionKinds.join(", "))} | ${markdown(item.sampleSections.join(", "))} | ${markdown(item.sampleValues.join(", "))} |`);
    }
    return lines;
}

function uniqueSorted(values: Iterable<string>): string[] {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

const CATALOG_ALIASES: Readonly<Record<string, string>> = {
    "ares.damage-particle-systems": "ares.docs-new-damageparticlesystems",
    "ares.pcx-cameos": "ares.docs-new-pcxcameos",
    "ares.reverse-engineer": "ares.docs-new-reverseengineerlogic",
    "ares.custom-superweapons": "ares.superweapons",
    "ares.target-filters": "ares.superweapons",
    "ares.superweapon-availability": "ares.superweapons",
    "ares.superweapon-target-requirements": "ares.superweapons",
    "ares.superweapon-shroud-targeting": "ares.superweapons",
    "ares.superweapon-fire-mode": "ares.superweapons",
    "ares.superweapon-charge-drain": "ares.superweapons",
    "ares.superweapon-charge-state": "ares.superweapons",
    "ares.superweapon-deferment": "ares.superweapons",
    "ares.superweapon-post-dependent": "ares.superweapons",
    "ares.superweapon-radar-event": "ares.superweapons",
    "ares.superweapon-ai-targeting": "ares.superweapons",
    "ares.superweapon-money": "ares.superweapons",
    "ares.superweapon-range": "ares.superweapons",
    "ares.superweapon-battery": "ares.superweapons",
    "ares.superweapon-hunter-seeker": "ares.superweapons",
    "ares.superweapon-drop-pod": "ares.superweapons",
    "ares.superweapon-empulse": "ares.superweapons",
    "ares.factory-owner-prerequisites": "ares.generic-prerequisites",
    "ares.custom-sides": "ares.dynamic-sides-countries",
    "ares.custom-countries": "ares.dynamic-sides-countries",
};

function catalogForFeature(featureId: string) {
    return getAresImplementationCapability(featureId) ??
        getAresCapability(featureId) ??
        getAresCapability(CATALOG_ALIASES[featureId] ?? "");
}

const ARES_CUSTOM_TYPES = new Set([
    "genericwarhead", "unitdelivery", "firestorm", "hunterseeker", "droppod", "empulse",
    "battery", "sonarpulse", "chronowarp",
]);

const COMMON_AVAILABILITY_FIELDS = [
    "SW.RequiredHouses",
    "SW.ForbiddenHouses",
    "SW.AuxBuildings",
    "SW.NegBuildings",
    "SW.AllowPlayer",
    "SW.AllowAI",
    "SW.Shots",
    "SW.AlwaysGranted",
    "SW.ShowCameo",
    "SW.TimerVisibility",
    "SW.Group",
];

const IMPLEMENTED_AVAILABILITY_FIELDS = new Set([
    "SW.RequiredHouses",
    "SW.ForbiddenHouses",
    "SW.AuxBuildings",
    "SW.NegBuildings",
    "SW.AllowPlayer",
    "SW.AllowAI",
    "SW.Shots",
    "SW.AlwaysGranted",
]);

const REPORT_NOTE_OVERRIDES: Readonly<Record<string, string>> = {
    "ares.chronoshift": "Chronoshift.Allow, Chronoshift.IsVehicle, and Chronoshift.Crushable are parsed; pure eligibility decisions cover ReconsiderBuildings and SW.AffectsTarget defaults, unit candidates are filtered through the existing Chronosphere path, and non-crushable collision handling is integrated. Buildings remain outside that lifecycle, while KillCargo, transport side effects, save/load, and multiplayer/lockstep certification remain open.",
    "ares.damage-particle-systems": "DamageSparks and explicit Smoke/Spark particle lists are normalized in TechnoRules with Ares defaults. BehavesLike fallback is metadata-aware: the pure adapter filters when ParticleSystem metadata is supplied, while the current TechnoRules path lacks that metadata lookup and preserves the vanilla candidate list. The resolved smoke list reaches the existing vehicle render gate; ParticleSystem metadata lookup, health-threshold spawning/random selection, sparks, infantry/building/aircraft coverage, save/load, and multiplayer certification remain open.",
};

function reportReferenceForSection(report: MentalOmegaCompatibilityReport, section: string): IniKeyReference[] {
    const expected = normalize(section);
    return report.references.filter((reference) => normalize(reference.section) === expected);
}

function classifyUnclassified(item: IniKeyUsage): string {
    const key = normalize(item.key);
    const sectionKinds = new Set(item.sectionKinds);
    if (/^(?:ares|sw\.)[._-]/i.test(item.key)) return "Ares candidate; verify against the official Ares field semantics";
    if (/^mo(?:[._-]|$)/i.test(item.key) || item.sampleSections.some((section) => /\[mo/i.test(section))) {
        return "MO content convention; keep outside generic Ares support";
    }
    if (sectionKinds.has("AI") || sectionKinds.has("ScriptType") || sectionKinds.has("TaskForce") ||
        sectionKinds.has("TeamType") || sectionKinds.has("Trigger") || sectionKinds.has("Event") ||
        sectionKinds.has("Action") || sectionKinds.has("UI") || sectionKinds.has("Sound")) {
        return "MO content/schema candidate; confirm against the content profile";
    }
    if (key.startsWith("versus.")) return "Ares armor candidate; confirm dynamic armor registration context";
    return "Unresolved; do not treat as Ares until its section/value semantics are verified";
}

function buildReport(
    report: MentalOmegaCompatibilityReport,
    rawRoots: readonly RawRootStats[],
    archives: readonly string[],
    customTypes: readonly { name: string; type: string; keys: string[]; refs: IniKeyReference[]; providers: string[] }[],
): string {
    const profile = getGameProfile("mental-omega");
    const totalRawKeys = rawRoots.reduce((sum, root) => sum + root.keyEntries, 0);
    const totalRawHeaders = rawRoots.reduce((sum, root) => sum + root.sectionHeaders, 0);
    const totalRawUniqueSections = rawRoots.reduce((sum, root) => sum + root.uniqueSections, 0);
    const customRefs = customTypes.flatMap((item) => item.refs);
    const customAresRefs = customRefs.filter((reference) => reference.classification === "ares-known");
    const customFeatureRefs = customAresRefs.filter((reference) => Boolean(reference.featureId));
    const customFeatureUsage = new Map<string, number>();
    for (const reference of customFeatureRefs) {
        const featureId = reference.featureId!;
        customFeatureUsage.set(featureId, (customFeatureUsage.get(featureId) ?? 0) + 1);
    }
    const commonAvailability = COMMON_AVAILABILITY_FIELDS.map((field) => {
        const count = report.references.filter((reference) => normalize(reference.key) === normalize(field)).length;
        const status = IMPLEMENTED_AVAILABILITY_FIELDS.has(field)
            ? count > 0 ? "implemented" : "implemented; not observed in this scan"
            : "parsed; presentation partial";
        return { field, count, status };
    });
    const unclassified = report.unclassifiedUsage;
    const gaps = report.featureUsage.filter((usage) => !usage.support?.implemented);
    const lines: string[] = [
        "# Mental Omega 3.3.6 Compatibility Requirement Report",
        "",
        "> Generated by `scripts/mental-omega-audit.ts` from a user-owned Mental Omega installation. The installation files are not part of this repository.",
        ">",
        "> Scope: generic Yuri's Revenge/Ares-compatible engine support. The Mental Omega profile selects its canonical data files; it does not add MO-only gameplay branches.",
        "",
        "## Executive result",
        "",
        `The scan mounted ${archives.length} MIX archive(s) and resolved ${report.sourceCount} canonical INI source(s). The raw packed-root audit measured **${totalRawKeys.toLocaleString()} key entries**, **${totalRawHeaders.toLocaleString()} section headers**, and **${totalRawUniqueSections.toLocaleString()} unique section names** across the five profile roots.`,
        "",
        `The scanner classified **${report.aresKnownKeys.toLocaleString()} Ares-known**, **${report.moContentKeys.toLocaleString()} MO-content**, **${report.vanillaKeys.toLocaleString()} vanilla**, and **${report.unclassifiedKeys.toLocaleString()} unclassified** effective key entries. Unknown keys are intentionally not inferred to be Ares fields.`,
        "",
        `The refreshed custom-superweapon inventory contains **${customTypes.length} custom-type definitions**, **${customRefs.length} authored key occurrences in those definitions**, and **${customAresRefs.length} Ares-recognized occurrences**. The earlier planning baseline of 552 must therefore be treated as a comparison point, not as an assumed current count.`,
        "",
        "The planning figure of 14,104 sections was not reproduced by the current packed 3.3.6 roots: this audit distinguishes 14,137 section headers from 14,129 unique section names. The scanner's effective INI representation contains 214,218 key entries because its parser normalizes duplicate/array entries; the raw line audit remains the 214,282-key reference total.",
        "",
        "## 1. Canonical profile roots and raw counts",
        "",
        "The profile resolver is the single source of truth for runtime and audit file selection.",
        "",
        "| Canonical name | Resolved file | Present | Bytes | Section headers | Unique sections | Key entries |",
        "|---|---|---:|---:|---:|---:|---:|",
    ];
    for (const root of rawRoots) {
        const base = root.name === "uimd.ini" ? "ui.ini" : root.name === "soundmo.ini" ? "sound.ini" : root.name.replace(/mo(?=\.ini$)/i, "").replace(/^aimo\.ini$/i, "ai.ini");
        lines.push(`| ${base} | ${root.name} | yes | ${root.bytes.toLocaleString()} | ${root.sectionHeaders.toLocaleString()} | ${root.uniqueSections.toLocaleString()} | ${root.keyEntries.toLocaleString()} |`);
    }
    lines.push(
        `| **Total** | — | — | ${rawRoots.reduce((sum, root) => sum + root.bytes, 0).toLocaleString()} | ${totalRawHeaders.toLocaleString()} | ${totalRawUniqueSections.toLocaleString()} | ${totalRawKeys.toLocaleString()} |`,
        "",
        "Resolver checks:",
        "",
        "| Base filename | Profile result | Optional fallback when preferred file is absent |",
        "|---|---|---|",
        `| rules.ini | ${profile.resolveCanonicalFile("rules.ini")} | required profile override |`,
        `| art.ini | ${profile.resolveCanonicalFile("art.ini")} | required profile override |`,
        `| ai.ini | ${profile.resolveCanonicalFile("ai.ini")} | required profile override |`,
        `| ui.ini | ${profile.resolveCanonicalFile("ui.ini")} | ${profile.resolveCanonicalFile("ui.ini", () => false)} |`,
        `| sound.ini | ${profile.resolveCanonicalFile("sound.ini")} | ${profile.resolveCanonicalFile("sound.ini", () => false)} |`,
        "",
        "## 2. Classification model",
        "",
        "| Classification | Meaning | Count |",
        "|---|---|---:|",
        `| vanilla | Recognized base-game/Yuri schema in a known section context | ${report.vanillaKeys.toLocaleString()} |`,
        `| ares-known | Explicitly mapped Ares field/type with a feature ID | ${report.aresKnownKeys.toLocaleString()} |`,
        `| mo-content | Content-profile sections or explicit MO naming convention | ${report.moContentKeys.toLocaleString()} |`,
        `| unclassified | No safe classification; requires evidence before implementation | ${report.unclassifiedKeys.toLocaleString()} |`,
        "",
        "Unknown keys are not placed in an `ares.unknown-key` bucket and do not imply Ares support. Every unclassified key is listed in Section 6.",
        "",
        "## 3. Ares feature usage and implementation status",
        "",
        "| Feature | Priority | Occurrences | Definitions | Parser | Model | Runtime | AI | Presentation | Save/load | Multiplayer | Deterministic | Verification | Target usage | Dependencies | Tests | Notes |",
        "|---|---|---:|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const usage of report.featureUsage) {
        const support = usage.support;
        const catalog = catalogForFeature(usage.featureId);
        const priority = !support?.implemented || catalog?.runtimeStatus === "missing"
            ? "P0"
            : usage.featureId === "ares.superweapon-availability"
                ? "P1"
            : catalog?.runtimeStatus === "partial"
                ? "P1"
                : "P2";
        lines.push(`| ${markdown(usage.featureId)} | ${priority} | ${usage.occurrences} | ${usage.definitionCount} | ${catalog?.parserStatus ?? (support?.parserImplemented ? "complete" : "missing")} | ${catalog?.normalizedModelStatus ?? "untracked"} | ${catalog?.runtimeStatus ?? (support?.runtimeImplemented ? "complete" : "missing")} | ${catalog?.aiStatus ?? "untracked"} | ${catalog?.presentationStatus ?? "untracked"} | ${catalog?.saveLoadStatus ?? "untracked"} | ${catalog?.multiplayerStatus ?? "untracked"} | ${catalog ? (catalog.deterministic ? "yes" : "no") : "untracked"} | ${catalog?.verificationStatus ?? "unverified"} | ${catalog?.targetModUsage ?? "unknown"} | ${markdown(catalog?.dependencies.join(", ") ?? "untracked")} | ${markdown(support?.tests.join(", ") ?? "unregistered")} | ${markdown(REPORT_NOTE_OVERRIDES[usage.featureId] ?? support?.notes ?? catalog?.notes ?? "No registry entry; implementation status must be resolved.")} |`);
    }
    lines.push(
        "",
        "The registry status is deliberately conservative: parsed fields are not reported as implemented unless runtime behavior and tests are separately recorded.",
        "",
        "## 4. Custom superweapon inventory",
        "",
        `The [SuperWeaponTypes] list contains **${customTypes.length} definitions using an Ares custom type**. The following table enumerates every such definition, its exact authored keys, type-specific handler mapping, provider buildings, target/AI evidence, and current persistence gap.`,
        "",
        "| Definition | Type | Providers | Exact authored keys | Ares handler/features | Unsupported or partial | Target evidence | AI evidence | Persistence/determinism |",
        "|---|---|---|---|---|---|---|---|---|",
    );
    for (const item of customTypes) {
        const features = uniqueSorted(item.refs.filter((reference) => reference.featureId).map((reference) => reference.featureId!));
        const unsupported = uniqueSorted(item.refs
            .filter((reference) => reference.featureId)
            .map((reference) => report.featureUsage.find((usage) => usage.featureId === reference.featureId)?.support)
            .filter((support) => support && !support.implemented)
            .map((support) => support!.id));
        const targetKeys = item.keys.filter((key) => /^(?:sw\.(?:affectshouse|affectstarget|requirestarget|requireshouse|fireintoshroud)|deliver\.|droppod\.|genericwarhead\.|sonarpulse\.)/i.test(key));
        const aiKeys = item.keys.filter((key) => /^(?:sw\.(?:aitargeting|aitargeting\.constraints|aitargeting\.preference|airequirestarget|airequireshouse|useaitargeting))/i.test(key));
        const stateful = /^(?:battery|firestorm|hunterseeker|empulse|droppod)$/i.test(item.type)
            ? "stateful handler; save/load and network certification remain open"
            : "no additional persistent runtime state certified";
        lines.push(`| ${markdown(item.name)} | ${markdown(item.type)} | ${markdown(item.providers.join(", ") || "none found") } | ${markdown(item.keys.join(", "))} | ${markdown(features.join(", ") || "unclassified") } | ${markdown(unsupported.join(", ") || "none") } | ${markdown(targetKeys.join(", ") || "handler/default") } | ${markdown(aiKeys.join(", ") || "default or absent") } | ${markdown(stateful)} |`);
    }
    lines.push(
        "",
        "### Custom-superweapon count breakdown",
        "",
        "| Measured surface | Count |",
        "|---|---:|",
        `| Custom-type definitions | ${customTypes.length} |`,
        `| Authored key occurrences in those definitions | ${customRefs.length} |`,
        `| Ares-recognized occurrences in those definitions | ${customAresRefs.length} |`,
        `| Ares feature-mapped occurrences in those definitions | ${customFeatureRefs.length} |`,
        "",
        "| Feature mapped within custom-type definitions | Occurrences |",
        "|---|---:|",
    );
    for (const [featureId, count] of [...customFeatureUsage.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        lines.push(`| ${markdown(featureId)} | ${count} |`);
    }
    lines.push(
        "",
        "The table intentionally preserves exact authored key spelling and type values; it does not collapse MO definitions into a hardcoded list in runtime code.",
        "",
        "## 5. Common superweapon availability/grant fields",
        "",
        "These fields are reported as one shared capability. The count is across the complete scanned effective source set; zero means the field was not observed in this installation, not that the generic parser may ignore it.",
        "",
        "| Field | Occurrences | Status |",
        "|---|---:|---|",
    );
    for (const field of commonAvailability) {
        lines.push(`| ${field.field} | ${field.count} | ${field.status} |`);
    }
    lines.push(
        "",
        "Core availability/grant behavior is implemented generically for Ares/YR: parser/evaluator, house and auxiliary gates, player/AI gates, provider-based grant/revoke, AlwaysGranted, finite Shots, and activation-time shot rejection. Remaining gaps are SW.ShowCameo, SW.TimerVisibility, and SW.Group presentation, plus broader AI coverage, persistence, and multiplayer/network certification.",
        "",
        "## 6. MO-content and unclassified key frequency",
        "",
        "### MO-content usage",
        "",
        ...usageTable(report.moContentUsage),
        "",
        "### All unclassified keys",
        "",
        ...usageTable(report.unclassifiedUsage),
        "",
        "### Top 25 unclassified keys with contextual disposition",
        "",
        "| Rank | Key | Count | Section kinds | Sample sections | Sample values | Audit disposition |",
        "|---:|---|---:|---|---|---|---|",
    );
    for (const [index, item] of unclassified.slice(0, 25).entries()) {
        lines.push(`| ${index + 1} | ${markdown(item.key)} | ${item.occurrences} | ${markdown(item.sectionKinds.join(", "))} | ${markdown(item.sampleSections.join(", "))} | ${markdown(item.sampleValues.join(", "))} | ${markdown(classifyUnclassified(item))} |`);
    }
    lines.push(
        "",
        "Disposition rules are conservative: a candidate is not promoted into generic Ares support from frequency alone. MO-content conventions remain profile data; Ares candidates require documentation plus parser/runtime tests.",
        "",
        "## 7. Dependency and faction coverage",
        "",
        "| Kind | Definitions | References | Unresolved |",
        "|---|---:|---:|---:|",
    );
    for (const coverage of report.dependencyGraph.coverage) {
        lines.push(`| ${coverage.kind} | ${coverage.definitions} | ${coverage.references} | ${coverage.unresolved} |`);
    }
    lines.push(
        "",
        `Side coverage: ${report.sideCountryCoverage.sideDefinitions} definitions, ${report.sideCountryCoverage.sideReferences} references, ${report.sideCountryCoverage.unknownSideReferences} unknown references.`,
        `Country coverage: ${report.sideCountryCoverage.countryDefinitions} definitions, ${report.sideCountryCoverage.countryReferences} references, ${report.sideCountryCoverage.unknownCountryReferences} unknown references.`,
        "",
        "## 8. Next P0 implementation list",
        "",
        "| Priority | Work item | Evidence | Required generic implementation boundary | Verification gate |",
        "|---|---|---|---|---|",
        `| P1 | Superweapon availability presentation and certification | ${commonAvailability.filter((item) => item.count > 0).map((item) => `${item.field}=${item.count}`).join(", ") || "no observed fields"} | Keep the implemented generic availability/grant/activation service; finish ShowCameo, TimerVisibility, and Group presentation, then certify persistence and multiplayer/network state | Presentation tests, save/load replay, and host/client deterministic checks; no MO-only branch |`,
        `| P0 | Complete custom handler coverage | ${customTypes.length} custom definitions; ${gaps.filter((usage) => usage.featureId.includes("superweapon") || usage.featureId === "ares.custom-superweapons").length} used superweapon feature(s) remain unimplemented/partial | Keep type dispatch and data parsing generic; add handlers by Ares capability, not by MO unit name | Per-type deterministic tests, target filters, AI, UI, save/load |`,
        `| P0 | AI and target integration | ${report.featureUsage.filter((usage) => usage.featureId.includes("ai-targeting") || usage.featureId.includes("target")).reduce((sum, usage) => sum + usage.occurrences, 0)} relevant occurrences | Share eligibility/activation rules between human and AI paths; preserve house/target/shroud semantics | Skirmish liveness, target-selection, and lockstep tests |`,
        `| P0 | State persistence and determinism | ${customTypes.filter((item) => /^(?:battery|firestorm|hunterseeker|empulse|droppod)$/i.test(item.type)).length} stateful custom-type definitions | Serialize charge, active effects, launched entities, and grants through the generic save/network state model | Save/load replay and host/client deterministic hashes |`,
        `| P0 | Resolve remaining unknowns | ${report.uniqueUnclassifiedKeys} unique unclassified keys; top 25 are listed above | Promote only keys backed by official Ares semantics or leave them profile content | New scanner fixture and runtime test per promoted field |`,
        "",
        "## 9. Verification record",
        "",
        "- Focused scanner/profile tests: run separately in the repository test log; the audit script itself only reads local assets and emits aggregate evidence.",
        "- The MO installation is required for this report and is intentionally not committed.",
        "- Android, browser runtime, live Ares DLL behavior, physical device behavior, and multiplayer/network certification are not claimed by this static MIX/INI audit.",
        "",
    );
    return lines.join("\n");
}

const { vfs, archives } = createVfs();
const profile = getGameProfile("mental-omega");
const loader = new IniSourceLoader(vfs);
const report = scanMentalOmegaVfs(vfs, createDefaultAresFeatureRegistry(), loader, profile);
const rawRoots: RawRootStats[] = [];
for (const base of ["rules.ini", "art.ini", "ai.ini", "ui.ini", "sound.ini"]) {
    const filename = profile.resolveCanonicalFile(base, (candidate) => vfs.fileExists(candidate));
    if (!vfs.fileExists(filename)) continue;
    const file = vfs.openFile(filename);
    rawRoots.push(rawStats(filename, file.readAsString(), file.getSize()));
}

const rulesEffective = loader.loadEffectiveIni("rulesmo.ini")?.ini ?? new IniFile(vfs.openFile("rulesmo.ini"));
const superWeaponNames = listNames(rulesEffective, "SuperWeaponTypes");
const buildingNames = listNames(rulesEffective, "BuildingTypes");
const buildingProviders = new Map<string, string[]>();
for (const buildingName of buildingNames) {
    const section = sectionByName(rulesEffective, buildingName);
    for (const key of ["SuperWeapon", "SuperWeapon2"]) {
        for (const superWeapon of entryValues(section, key)) {
            const normalized = normalize(superWeapon);
            const providers = buildingProviders.get(normalized) ?? [];
            providers.push(buildingName);
            buildingProviders.set(normalized, providers);
        }
    }
}

const customTypes = superWeaponNames.flatMap((name) => {
    const section = sectionByName(rulesEffective, name);
    const type = entryValue(section, "Type") ?? "(missing Type)";
    if (!ARES_CUSTOM_TYPES.has(normalize(type))) return [];
    const refs = reportReferenceForSection(report, name);
    const keys = section ? [...section.entries.keys()] : [];
    return [{
        name,
        type,
        keys,
        refs,
        providers: uniqueSorted(buildingProviders.get(normalize(name)) ?? []),
    }];
});

const output = buildReport(report, rawRoots, archives, customTypes);
if (shouldWrite) {
    writeFileSync(reportPath, output.endsWith("\n") ? output : output + "\n", "utf8");
    console.log(output.split("\n").slice(0, 18).join("\n"));
    console.error(`Wrote ${reportPath}`);
}
else {
    console.log(output);
}
