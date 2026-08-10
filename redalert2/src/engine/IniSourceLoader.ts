import { IniFile, IniSection } from "@/data/IniFile";
import type { VirtualFileSystem, VfsResolution } from "@/data/vfs/VirtualFileSystem";
import { tryNormalizeGamePath } from "@/engine/GamePath";

export type IniDiagnosticCode =
    | "ARES_INCLUDE_MISSING"
    | "ARES_INCLUDE_CYCLE"
    | "ARES_INCLUDE_DUPLICATE"
    | "ARES_INCLUDE_UNSAFE";

export interface IniDiagnostic {
    code: IniDiagnosticCode;
    message: string;
    file: string;
    include?: string;
    chain: string[];
    resolution?: VfsResolution;
}

export interface IniValueSource {
    file: string;
    section: string;
    key: string;
    value: string | string[];
    resolution?: VfsResolution;
    includedBy: string[];
}

export interface IniValueExplanation {
    file: string;
    section: string;
    key: string;
    winner?: IniValueSource;
    shadowed: IniValueSource[];
}

export interface IniSourceNode {
    file: string;
    includes: string[];
    resolution?: VfsResolution;
}

export interface IniSourceGraph {
    root: string;
    nodes: IniSourceNode[];
    diagnostics: IniDiagnostic[];
}

export interface EffectiveIni {
    root: string;
    ini: IniFile;
    graph: IniSourceGraph;
    explain(section: string, key: string): IniValueExplanation | undefined;
}

interface SourceContext {
    file: string;
    chain: string[];
}

function isIncludeSection(section: IniSection): boolean {
    return section.name.trim().toLocaleLowerCase("en-US") === "#include";
}

function findIncludeSection(ini: IniFile): IniSection | undefined {
    return ini.getOrderedSections().find(isIncludeSection);
}

function includeValues(section: IniSection): string[] {
    const values: string[] = [];
    for (const value of section.entries.values()) {
        if (Array.isArray(value)) {
            values.push(...value);
        }
        else {
            values.push(value);
        }
    }
    return values
        .map((value) => value.trim())
        .filter(Boolean);
}

function sourceKey(section: string, key: string): string {
    return `${section}\u0000${key}`;
}

/**
 * Loads Ares [#include] INIs using the documented depth-first ordering:
 * each file's own values are merged first, then its includes are processed in
 * listed order. The loader deliberately resolves includes through the VFS so
 * known-name/hash-only MIX entries work even when an archive cannot enumerate
 * its contents.
 */
export class IniSourceLoader {
    private readonly cache = new Map<string, EffectiveIni>();

    constructor(private readonly vfs: VirtualFileSystem) {}

    clear(): void {
        this.cache.clear();
    }

    loadEffectiveIni(entryFile: string): EffectiveIni | undefined {
        const normalizedEntry = tryNormalizeGamePath(entryFile);
        if (!normalizedEntry || !this.vfs.fileExists(normalizedEntry)) {
            return undefined;
        }
        const cacheKey = normalizedEntry.toLocaleLowerCase("en-US");
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const graph: IniSourceGraph = {
            root: normalizedEntry,
            nodes: [],
            diagnostics: [],
        };
        const result = new IniFile();
        const sources = new Map<string, IniValueSource[]>();
        const visited = new Set<string>();
        const active = new Set<string>();

        const mergeSection = (target: IniSection, source: IniSection, context: SourceContext): void => {
            const numericTarget = target.isNumericIndexArray() && source.isNumericIndexArray();
            let nextIndex = numericTarget ? target.getHighestNumericIndex() + 1 : -1;
            for (const [key, value] of source.entries) {
                const targetKey = numericTarget && /^\d+$/.test(key) && !Array.isArray(value)
                    ? String(nextIndex++)
                    : key;
                const copiedValue = Array.isArray(value) ? [...value] : value;
                target.set(targetKey, copiedValue);
                const provenanceKey = sourceKey(target.name, targetKey);
                const entries = sources.get(provenanceKey) ?? [];
                entries.push({
                    file: context.file,
                    section: target.name,
                    key: targetKey,
                    value: copiedValue,
                    resolution: this.vfs.resolve(context.file),
                    includedBy: [...context.chain],
                });
                sources.set(provenanceKey, entries);
            }
            for (const [sectionName, nestedSource] of source.sections) {
                const nestedTarget = target.getOrCreateSection(sectionName);
                mergeSection(nestedTarget, nestedSource, context);
            }
        };

        const mergeSource = (ini: IniFile, context: SourceContext): void => {
            for (const section of ini.getOrderedSections()) {
                if (isIncludeSection(section)) {
                    continue;
                }
                const target = result.getOrCreateSection(section.name);
                mergeSection(target, section, context);
            }
        };

        const load = (requestedFile: string, parent?: SourceContext): void => {
            const normalizedFile = tryNormalizeGamePath(requestedFile);
            if (!normalizedFile) {
                graph.diagnostics.push({
                    code: "ARES_INCLUDE_UNSAFE",
                    message: `Unsafe Ares include path "${requestedFile}"`,
                    file: parent?.file ?? normalizedEntry,
                    include: requestedFile,
                    chain: parent?.chain ?? [normalizedEntry],
                });
                return;
            }
            const key = normalizedFile.toLocaleLowerCase("en-US");
            if (active.has(key)) {
                const chain = [...(parent?.chain ?? [normalizedEntry]), normalizedFile];
                graph.diagnostics.push({
                    code: "ARES_INCLUDE_CYCLE",
                    message: `Ares INI include cycle: ${chain.join(" -> ")}`,
                    file: parent?.file ?? normalizedEntry,
                    include: normalizedFile,
                    chain,
                });
                return;
            }
            if (visited.has(key)) {
                graph.diagnostics.push({
                    code: "ARES_INCLUDE_DUPLICATE",
                    message: `Ares INI include "${normalizedFile}" was already loaded`,
                    file: parent?.file ?? normalizedEntry,
                    include: normalizedFile,
                    chain: parent?.chain ?? [normalizedEntry],
                });
                return;
            }
            let virtualFile;
            try {
                virtualFile = this.vfs.openFile(normalizedFile);
            }
            catch {
                const resolution = this.vfs.resolve(normalizedFile);
                graph.diagnostics.push({
                    code: "ARES_INCLUDE_MISSING",
                    message: `Ares INI include "${normalizedFile}" was not found`,
                    file: parent?.file ?? normalizedEntry,
                    include: normalizedFile,
                    chain: parent?.chain ?? [normalizedEntry],
                    resolution,
                });
                return;
            }

            visited.add(key);
            active.add(key);
            const chain = parent ? [...parent.chain, normalizedFile] : [normalizedFile];
            const node: IniSourceNode = {
                file: normalizedFile,
                includes: [],
                resolution: this.vfs.resolve(normalizedFile),
            };
            graph.nodes.push(node);
            const parsed = new IniFile(virtualFile);
            mergeSource(parsed, { file: normalizedFile, chain: parent?.chain ?? [] });

            const includes = findIncludeSection(parsed);
            for (const include of includes ? includeValues(includes) : []) {
                node.includes.push(include);
                load(include, { file: normalizedFile, chain });
            }
            active.delete(key);
        };

        load(normalizedEntry);
        const effective: EffectiveIni = {
            root: normalizedEntry,
            ini: result,
            graph,
            explain: (section: string, key: string) => {
                const matches = [...sources.entries()].filter(([candidate]) => {
                    const [candidateSection, candidateKey] = candidate.split("\u0000");
                    return candidateSection.toLocaleLowerCase("en-US") === section.toLocaleLowerCase("en-US") &&
                        candidateKey.toLocaleLowerCase("en-US") === key.toLocaleLowerCase("en-US");
                });
                const history = matches.flatMap(([, values]) => values);
                if (!history.length) {
                    return undefined;
                }
                return {
                    file: normalizedEntry,
                    section,
                    key,
                    winner: history[history.length - 1],
                    shadowed: history.slice(0, -1),
                };
            },
        };
        this.cache.set(cacheKey, effective);
        return effective;
    }

    graph(entryFile: string): IniSourceGraph | undefined {
        return this.loadEffectiveIni(entryFile)?.graph;
    }

    explain(entryFile: string, section: string, key: string): IniValueExplanation | undefined {
        return this.loadEffectiveIni(entryFile)?.explain(section, key);
    }
}
