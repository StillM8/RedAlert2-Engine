import type { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";

export type ResolvedTeamType = {
    id: string;
    section: IniSection;
};

function iniFiles(context: any): any[] {
    return [
        (context.map as any)?.mapFile,
        context.rules?.getIni?.(),
    ].filter((ini) => !!ini?.getSection);
}

function getSection(context: any, name: string): IniSection | undefined {
    for (const ini of iniFiles(context)) {
        const section = ini.getSection(name);
        if (section) {
            return section;
        }
    }
    return undefined;
}

function sectionValue(section: IniSection | undefined, key: string): string {
    const value = section?.getString(key)?.trim();
    return value ?? "";
}

function resolveListedSection(context: any, listName: string, reference: unknown): ResolvedTeamType | undefined {
    const value = String(reference ?? "").trim();
    if (!value) {
        return undefined;
    }
    if (/^\d+$/.test(value)) {
        const list = getSection(context, listName);
        const raw = list?.entries.get(value);
        const id = String(Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
        const section = id ? getSection(context, id) : undefined;
        return section ? { id, section } : undefined;
    }
    const section = getSection(context, value);
    return section ? { id: value, section } : undefined;
}

export function resolveTeamType(context: any, reference: unknown): ResolvedTeamType | undefined {
    return resolveListedSection(context, "TeamTypes", reference);
}

export function resolveTaskForce(context: any, teamType: ResolvedTeamType): IniSection | undefined {
    const reference = sectionValue(teamType.section, "TaskForce");
    return resolveListedSection(context, "TaskForces", reference)?.section ??
        getSection(context, reference);
}

export function taskForceEntries(context: any, teamType: ResolvedTeamType): Array<{ count: number; type: string }> {
    const taskForce = resolveTaskForce(context, teamType) ?? teamType.section;
    const entries: Array<{ count: number; type: string }> = [];
    const keys = [...(taskForce?.entries.keys() ?? [])]
        .filter((key) => /^\d+$/.test(key))
        .sort((left, right) => Number(left) - Number(right));
    for (const key of keys) {
        const raw = taskForce?.entries.get(key);
        const value = String(Array.isArray(raw) ? raw.join(",") : raw);
        const [countValue, ...typeParts] = value.split(",");
        const count = Number(countValue);
        const type = typeParts.join(",").trim();
        if (Number.isSafeInteger(count) && count > 0 && type) {
            entries.push({ count, type });
        }
    }
    return entries;
}

export function resolveUnitRules(context: any, name: string): any | undefined {
    for (const type of [ObjectType.Infantry, ObjectType.Vehicle, ObjectType.Aircraft]) {
        try {
            if (!context.rules?.hasObject || context.rules.hasObject(name, type)) {
                const rules = context.rules?.getObject?.(name, type);
                if (rules) {
                    return rules;
                }
            }
        }
        catch {
        }
    }
    return undefined;
}

export function parseTeamWaypoint(value: unknown): number | undefined {
    const text = String(value ?? "").trim();
    if (/^\d+$/.test(text)) {
        return Number(text);
    }
    if (!/^[A-Z]+$/i.test(text)) {
        return undefined;
    }
    let column = 0;
    for (const character of text.toUpperCase()) {
        column = column * 26 + character.charCodeAt(0) - 64;
    }
    const waypoint = column - 1;
    return waypoint >= 0 ? waypoint : undefined;
}
