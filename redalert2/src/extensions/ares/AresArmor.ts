import type { IniSection } from "@/data/IniSection";
import { ArmorType } from "@/game/type/ArmorType";

export type ArmorId = ArmorType;

export interface ArmorDefinition {
    id: ArmorId;
    name: string;
    inheritedFrom?: ArmorId;
    defaultVerses: number;
}

export interface ArmorVersusBehavior {
    forceFire: boolean;
    retaliate: boolean;
    passiveAcquire: boolean;
}

export interface ParsedWarheadVerses {
    verses: Map<ArmorId, number>;
    behavior: Map<ArmorId, ArmorVersusBehavior>;
}

interface IniSectionLike {
    entries: Map<string, string | string[]>;
}

const VANILLA_ARMOR_NAMES: ReadonlyArray<[string, ArmorType]> = [
    ["none", ArmorType.None],
    ["flak", ArmorType.Flak],
    ["plate", ArmorType.Plate],
    ["light", ArmorType.Light],
    ["medium", ArmorType.Medium],
    ["heavy", ArmorType.Heavy],
    ["wood", ArmorType.Wood],
    ["steel", ArmorType.Steel],
    ["concrete", ArmorType.Concrete],
    ["special_1", ArmorType.Special_1],
    ["special_2", ArmorType.Special_2],
];

function key(name: string): string {
    return name.trim().toLocaleLowerCase("en-US");
}

function parseScalar(value: string | string[] | undefined, defaultValue: number): number {
    const text = Array.isArray(value) ? value[0] : value;
    if (text === undefined) return defaultValue;
    const trimmed = text.trim();
    if (!trimmed) return defaultValue;
    const isPercent = trimmed.endsWith("%");
    const number = Number(isPercent ? trimmed.slice(0, -1) : trimmed);
    return Number.isFinite(number) ? (isPercent ? number / 100 : number) : defaultValue;
}

function parseBool(value: string | string[] | undefined, defaultValue: boolean): boolean {
    const text = (Array.isArray(value) ? value[0] : value)?.trim().toLocaleLowerCase("en-US");
    if (!text) return defaultValue;
    if (["yes", "true", "1", "on"].includes(text)) return true;
    if (["no", "false", "0", "off"].includes(text)) return false;
    return defaultValue;
}

/** Data-driven armor IDs, retaining vanilla numeric IDs for old callers. */
export class ArmorRegistry {
    private readonly ids = new Map<string, ArmorId>();
    private readonly definitions = new Map<ArmorId, ArmorDefinition>();
    private nextCustomId = 100;

    constructor() {
        for (const [name, id] of VANILLA_ARMOR_NAMES) {
            this.ids.set(name, id);
            this.definitions.set(id, { id, name, defaultVerses: 1 });
        }
    }

    static fromIni(ini: { getSection(name: string): IniSectionLike | undefined }): ArmorRegistry {
        const registry = new ArmorRegistry();
        const section = ini.getSection("ArmorTypes");
        if (!section) return registry;
        for (const [name, rawValue] of section.entries) {
            const armorName = name.trim();
            if (!armorName) continue;
            const text = (Array.isArray(rawValue) ? rawValue[0] : rawValue).trim();
            const percentage = text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number.NaN;
            if (Number.isFinite(percentage)) {
                registry.register(armorName, undefined, percentage);
            }
            else {
                registry.register(armorName, registry.resolve(text), 1);
            }
        }
        return registry;
    }

    register(name: string, inheritedFrom?: ArmorId, defaultVerses = 1): ArmorId {
        const normalized = key(name);
        const existing = this.ids.get(normalized);
        if (existing !== undefined) return existing;
        const id = this.nextCustomId++ as ArmorId;
        this.ids.set(normalized, id);
        this.definitions.set(id, {
            id,
            name: name.trim(),
            inheritedFrom,
            defaultVerses,
        });
        return id;
    }

    resolve(name: string | undefined, fallback: ArmorId = ArmorType.None): ArmorId {
        if (!name) return fallback;
        return this.ids.get(key(name)) ?? fallback;
    }

    has(name: string): boolean {
        return this.ids.has(key(name));
    }

    get(id: ArmorId): ArmorDefinition | undefined {
        return this.definitions.get(id);
    }

    list(): ArmorDefinition[] {
        return [...this.definitions.values()].map((definition) => ({ ...definition }));
    }

    custom(): ArmorDefinition[] {
        return this.list().filter((definition) => definition.id >= 100);
    }
}

function defaultBehavior(multiplier: number): ArmorVersusBehavior {
    // Ares preserves the original special Verses values: 0% disables force
    // fire, retaliation and passive acquire; 1% additionally disables
    // retaliation; 2% additionally disables passive acquire.
    return {
        forceFire: multiplier > 0,
        retaliate: multiplier > 0.01,
        passiveAcquire: multiplier > 0.02,
    };
}

export function parseAresWarheadVerses(section: IniSection, registry: ArmorRegistry): ParsedWarheadVerses {
    const verses = new Map<ArmorId, number>();
    const behavior = new Map<ArmorId, ArmorVersusBehavior>();
    section.getFixedArray("Verses").forEach((value, index) => {
        verses.set(index as ArmorId, value);
        behavior.set(index as ArmorId, defaultBehavior(value));
    });

    for (const definition of registry.custom()) {
        if (!verses.has(definition.id)) {
            const inherited = definition.inheritedFrom !== undefined
                ? verses.get(definition.inheritedFrom)
                : undefined;
            const value = inherited ?? definition.defaultVerses;
            verses.set(definition.id, value);
            behavior.set(definition.id, defaultBehavior(value));
        }
    }

    for (const [entryKey, rawValue] of section.entries) {
        const match = entryKey.match(/^Versus\.([^.]+)(?:\.(ForceFire|Retaliate|PassiveAcquire))?$/i);
        if (!match) continue;
        const armorId = registry.resolve(match[1]);
        if (match[2]) {
            const current = behavior.get(armorId) ?? defaultBehavior(verses.get(armorId) ?? 0);
            const property = match[2].toLowerCase() === "passiveacquire"
                ? "passiveAcquire"
                : match[2].toLowerCase() === "forcefire"
                    ? "forceFire"
                    : "retaliate";
            behavior.set(armorId, {
                ...current,
                [property]: parseBool(rawValue, true),
            });
        }
        else {
            const value = parseScalar(rawValue, verses.get(armorId) ?? 0);
            verses.set(armorId, value);
            behavior.set(armorId, defaultBehavior(value));
        }
    }
    return { verses, behavior };
}
