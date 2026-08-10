import { IniFile } from '@/data/IniFile';
import type { IniScanSource } from './AresCompatibilityScanner';

export type DependencyKind =
    | 'techno'
    | 'weapon'
    | 'projectile'
    | 'warhead'
    | 'superweapon'
    | 'animation'
    | 'side'
    | 'country'
    | 'armor'
    | 'script'
    | 'taskforce'
    | 'team'
    | 'trigger'
    | 'event'
    | 'action'
    | 'tag'
    | 'asset';

export interface DependencyNode {
    id: string;
    kind: DependencyKind;
    name: string;
    sources: string[];
    sections: string[];
}

export interface DependencyEdge {
    from: string;
    to: string;
    kind: DependencyKind;
    key: string;
    value: string;
    source: string;
    section: string;
    resolved?: boolean;
}

export interface DependencyKindCoverage {
    kind: DependencyKind;
    definitions: number;
    references: number;
    unresolved: number;
}

export interface IniDependencyGraph {
    nodes: DependencyNode[];
    edges: DependencyEdge[];
    unresolved: DependencyEdge[];
    coverage: DependencyKindCoverage[];
}

const LIST_SECTION_KINDS: Readonly<Record<string, DependencyKind>> = {
    technotypes: 'techno',
    infantrytypes: 'techno',
    vehicletypes: 'techno',
    aircrafttypes: 'techno',
    buildingtypes: 'techno',
    weapontypes: 'weapon',
    projectiletypes: 'projectile',
    warheadtypes: 'warhead',
    superweapontypes: 'superweapon',
    animtypes: 'animation',
    armortypes: 'armor',
    sides: 'side',
    countries: 'country',
    multiplayercountries: 'country',
    aicountries: 'country',
    scripttypes: 'script',
    taskforces: 'taskforce',
    teamtypes: 'team',
    triggers: 'trigger',
    events: 'event',
    actions: 'action',
    tags: 'tag',
    cels: 'tag',
    celltags: 'tag',
};

const ASSET_KEYS: Readonly<Record<string, string>> = {
    image: 'image',
    cameo: 'cameo',
    altcameo: 'altcameo',
    palette: 'palette',
    report: 'report',
    voice: 'voice',
    anim: 'animation',
    animation: 'animation',
    loadscreen: 'loadscreen',
    flag: 'flag',
};

function normalize(value: string): string {
    return value.trim().toLocaleLowerCase('en-US');
}

function nodeId(kind: DependencyKind, name: string): string {
    return `${kind}:${normalize(name)}`;
}

function splitValues(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((item) => splitValues(item));
    }
    return String(value ?? '')
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter((item) => item.length > 0 && !/^(?:none|no|false|0|unset)$/i.test(item));
}

function sectionKind(name: string): DependencyKind | undefined {
    return LIST_SECTION_KINDS[normalize(name)];
}

function isListSection(name: string): boolean {
    return sectionKind(name) !== undefined;
}

function edgeKind(ownerKind: DependencyKind | undefined, key: string): DependencyKind | undefined {
    const normalized = normalize(key).replace(/\s+/g, '');
    const asset = ASSET_KEYS[normalized];
    if (asset) return 'asset';

    if (/^(?:primary|secondary|eliteprimary|elitesecondary|occupyweapon|eliteoccupyweapon|weapon\d*|weaponstage\d*)$/.test(normalized)) {
        return 'weapon';
    }
    if (normalized === 'projectile') return 'projectile';
    if (normalized === 'warhead') return 'warhead';
    if (/superweapon/.test(normalized)) return 'superweapon';
    if (/^(?:anim|animation|destroyanim|damagedanim|makeanim|activeanim)/.test(normalized)) return 'animation';

    if (ownerKind === 'techno' && /^(?:prerequisite|prerequisite\.|requires|requiresstolen)/.test(normalized)) {
        return 'techno';
    }
    if (ownerKind === 'techno' && /^(?:owner|requiredhouses|forbiddenhouses|houses|country|countries)$/.test(normalized)) {
        return 'country';
    }
    if (ownerKind === 'country' && normalized === 'side') return 'side';
    if (ownerKind === 'side' && /^(?:defaultcountry|country|countries)/.test(normalized)) return 'country';
    if (ownerKind === 'script' && /^(?:action|event|team|teamtype|trigger|taskforce)/.test(normalized)) {
        return normalized.startsWith('event') ? 'event'
            : normalized.startsWith('trigger') ? 'trigger'
                : normalized.startsWith('taskforce') ? 'taskforce'
                    : normalized.startsWith('team') ? 'team'
                        : 'action';
    }
    if (ownerKind === 'taskforce' && /^(?:0|\d+)$/.test(normalized)) return 'techno';
    if (ownerKind === 'team' && /^(?:taskforce|script|trigger)/.test(normalized)) {
        return normalized.startsWith('taskforce') ? 'taskforce'
            : normalized.startsWith('script') ? 'script'
                : 'trigger';
    }
    if (ownerKind === 'trigger' && /^(?:event|action|tag|team)/.test(normalized)) {
        return normalized.startsWith('event') ? 'event'
            : normalized.startsWith('tag') ? 'tag'
                : normalized.startsWith('team') ? 'team'
                    : 'action';
    }
    if (ownerKind === 'event' && /^(?:action|team|tag)/.test(normalized)) {
        return normalized.startsWith('team') ? 'team'
            : normalized.startsWith('tag') ? 'tag'
                : 'action';
    }
    if (ownerKind === 'action' && /^(?:team|tag|event)/.test(normalized)) {
        return normalized.startsWith('team') ? 'team'
            : normalized.startsWith('tag') ? 'tag'
                : 'event';
    }
    return undefined;
}

export function scanIniDependencies(sources: readonly IniScanSource[]): IniDependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    const sectionOwners = new Map<string, DependencyKind[]>();

    const addNode = (kind: DependencyKind, name: string, source: string, section: string): string => {
        const id = nodeId(kind, name);
        const existing = nodes.get(id);
        if (existing) {
            if (!existing.sources.includes(source)) existing.sources.push(source);
            if (!existing.sections.includes(section)) existing.sections.push(section);
            return id;
        }
        nodes.set(id, {
            id,
            kind,
            name: name.trim(),
            sources: [source],
            sections: [section],
        });
        return id;
    };

    for (const source of sources) {
        const ini = new IniFile(source.contents);
        for (const section of ini.getOrderedSections()) {
            const kind = sectionKind(section.name);
            if (!kind) continue;
            for (const value of section.entries.values()) {
                for (const name of splitValues(value)) {
                    if (/^\d+$/.test(name)) continue;
                    addNode(kind, name, source.name, section.name);
                    const owners = sectionOwners.get(normalize(name)) ?? [];
                    if (!owners.includes(kind)) owners.push(kind);
                    sectionOwners.set(normalize(name), owners);
                }
            }
        }
    }

    const edges: DependencyEdge[] = [];
    for (const source of sources) {
        const ini = new IniFile(source.contents);
        for (const section of ini.getOrderedSections()) {
            if (isListSection(section.name)) continue;
            const owners = sectionOwners.get(normalize(section.name)) ?? [];
            const ownerKind = owners[0];
            const owner = ownerKind ? nodeId(ownerKind, section.name) : `section:${normalize(section.name)}`;
            for (const [key, rawValue] of section.entries) {
                const kind = edgeKind(ownerKind, key);
                if (!kind) continue;
                for (const value of splitValues(rawValue)) {
                    const target = kind === 'asset' ? `asset:${normalize(value)}` : nodeId(kind, value);
                    const resolved = kind === 'asset' ? undefined : nodes.has(target);
                    edges.push({
                        from: owner,
                        to: target,
                        kind,
                        key,
                        value,
                        source: source.name,
                        section: section.name,
                        ...(resolved === undefined ? {} : { resolved }),
                    });
                }
            }
        }
    }

    const definitionsByKind = new Map<DependencyKind, number>();
    for (const node of nodes.values()) {
        definitionsByKind.set(node.kind, (definitionsByKind.get(node.kind) ?? 0) + 1);
    }
    const referencesByKind = new Map<DependencyKind, number>();
    const unresolvedByKind = new Map<DependencyKind, number>();
    for (const edge of edges) {
        referencesByKind.set(edge.kind, (referencesByKind.get(edge.kind) ?? 0) + 1);
        if (edge.resolved === false) {
            unresolvedByKind.set(edge.kind, (unresolvedByKind.get(edge.kind) ?? 0) + 1);
        }
    }
    const kinds = new Set<DependencyKind>([
        ...definitionsByKind.keys(),
        ...referencesByKind.keys(),
    ]);
    const coverage = [...kinds].sort().map((kind) => ({
        kind,
        definitions: definitionsByKind.get(kind) ?? 0,
        references: referencesByKind.get(kind) ?? 0,
        unresolved: unresolvedByKind.get(kind) ?? 0,
    }));
    return {
        nodes: [...nodes.values()],
        edges,
        unresolved: edges.filter((edge) => edge.resolved === false),
        coverage,
    };
}
