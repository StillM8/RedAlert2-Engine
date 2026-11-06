import { fnv32aStrings } from "@/util/math";
import { ObjectType } from "@/engine/type/ObjectType";

export const TEAM_RUNTIME_STATE_VERSION = 1 as const;

export interface TeamRuntimeState {
    version: typeof TEAM_RUNTIME_STATE_VERSION;
    teams: { id: string; memberIds: number[] }[];
}

function normalized(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function isSectionValue(value: unknown, expected: string): boolean {
    const normalizedExpected = normalized(expected);
    return !!normalizedExpected && normalized(value) === normalizedExpected;
}

function isTruthyAutocreate(values: readonly string[]): boolean {
    return values.some(value => ["1", "yes", "true"].includes(normalized(value)));
}

function initialTechnos(context: any): any[] {
    return context?.map?.getInitialMapObjects?.()?.technos ?? [];
}

function mapRecordFor(object: any, context: any): any | undefined {
    const tile = object?.position?.tile;
    return initialTechnos(context).find((entry: any) =>
        entry?.name === object?.name &&
        entry?.type === object?.type &&
        entry?.rx === tile?.rx &&
        entry?.ry === tile?.ry);
}

function rawValuesFor(object: any, context: any): string[] {
    const record = mapRecordFor(object, context);
    return Array.isArray(record?.rawValues) ? record.rawValues : [];
}

function sectionString(section: any, key: string): string {
    return String(section?.getString?.(key) ?? "").trim();
}

function sectionNumber(section: any, key: string, fallback: number): number {
    const value = section?.getNumber?.(key, Number.NaN);
    return Number.isFinite(value) ? value : fallback;
}

export class TeamRuntime {
    private readonly memberships = new Map<string, Set<number>>();

    getMembers(teamId: string): number[] {
        return [...(this.memberships.get(teamId) ?? [])].sort((a, b) => a - b);
    }

    getTeamForObject(objectId: number): string | undefined {
        for (const [teamId, members] of this.memberships) {
            if (members.has(objectId)) return teamId;
        }
        return undefined;
    }

    recruit(context: any, teamType: any, owner: any): number {
        const teamId = String(teamType?.id ?? "");
        if (!teamId || !owner) return 0;
        const section = teamType.section;
        const mission = sectionString(section, "Mission");
        const group = sectionString(section, "Group");
        const max = Math.max(0, Math.floor(sectionNumber(section, "Max", 0)));
        const min = Math.max(0, Math.floor(sectionNumber(section, "Min", 0)));
        const members = this.memberships.get(teamId) ?? new Set<number>();
        this.memberships.set(teamId, members);
        const candidates = (context?.world?.getAllObjects?.() ?? [])
            .filter((object: any) => object && !object.isDestroyed && !object.isDisposed &&
                object.owner === owner && !members.has(object.id) && this.getTeamForObject(object.id) === undefined)
            .filter((object: any) => {
                const record = mapRecordFor(object, context);
                const values = rawValuesFor(object, context);
                if (mission && (isSectionValue(record?.mission, mission) || values.some(value => isSectionValue(value, mission)))) return true;
                if (group && (isSectionValue(record?.group, group) || values.some(value => isSectionValue(value, group)))) return true;
                return !mission && !group && (isTruthyAutocreate([record?.autocreate, ...values]));
            })
            .sort((a: any, b: any) => a.id - b.id);
        const selected = max > 0 ? candidates.slice(0, max) : candidates;
        if (selected.length < min) {
            return 0;
        }
        for (const object of selected) {
            members.add(object.id);
        }
        return selected.length;
    }

    destroy(teamId: string): number {
        const members = this.memberships.get(String(teamId));
        if (!members) return 0;
        const count = members.size;
        this.memberships.delete(String(teamId));
        return count;
    }

    captureState(): TeamRuntimeState {
        return {
            version: TEAM_RUNTIME_STATE_VERSION,
            teams: [...this.memberships.entries()]
                .map(([id, members]) => ({ id, memberIds: [...members].sort((a, b) => a - b) }))
                .sort((a, b) => a.id.localeCompare(b.id)),
        };
    }

    validateState(state: unknown): TeamRuntimeState {
        if (!state || typeof state !== "object") {
            throw new Error("Invalid team runtime state");
        }
        const candidate = state as TeamRuntimeState;
        if (candidate.version !== TEAM_RUNTIME_STATE_VERSION || !Array.isArray(candidate.teams)) {
            throw new Error("Invalid team runtime state");
        }
        const seenTeams = new Set<string>();
        const seenObjects = new Set<number>();
        for (const team of candidate.teams) {
            if (!team || typeof team.id !== "string" || !team.id || !Array.isArray(team.memberIds)) {
                throw new Error("Invalid team membership entry");
            }
            if (seenTeams.has(team.id)) {
                throw new Error(`Duplicate team membership ${team.id}`);
            }
            seenTeams.add(team.id);
            for (const id of team.memberIds) {
                if (!Number.isSafeInteger(id) || id < 0 || seenObjects.has(id)) {
                    throw new Error("Invalid team member id");
                }
                seenObjects.add(id);
            }
        }
        return candidate;
    }

    restoreState(state: unknown, options: { resolveObjectById?: (id: number) => any; strict?: boolean } = {}): void {
        const parsed = this.validateState(state);
        const memberships = new Map<string, Set<number>>();
        for (const team of parsed.teams) {
            const members = new Set<number>();
            for (const id of team.memberIds) {
                const object = options.resolveObjectById?.(id);
                if (!object && options.strict) {
                    throw new Error(`Cannot restore team member ${id}: unresolved`);
                }
                if (object) members.add(id);
            }
            memberships.set(team.id, members);
        }
        this.memberships.clear();
        for (const [id, members] of memberships) this.memberships.set(id, members);
    }

    getHash(): number {
        return fnv32aStrings([
            "TeamRuntime",
            ...this.captureState().teams.flatMap(team => [team.id, team.memberIds.length, ...team.memberIds]),
        ]);
    }
}

export function isTeamRuntimeObjectType(type: unknown): boolean {
    return type === ObjectType.Infantry || type === ObjectType.Vehicle || type === ObjectType.Aircraft;
}
