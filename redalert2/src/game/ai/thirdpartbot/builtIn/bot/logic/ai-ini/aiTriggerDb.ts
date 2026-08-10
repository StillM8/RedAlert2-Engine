import { GameApi, PlayerData, SideType } from "../../../game-api";
import { UnitComposition } from "../../../bot/strategy/strategy";

/**
 * Retail AI database: TaskForces / TeamTypes / AITriggerTypes parsed from the
 * game's own ai(md).ini (already loaded by the engine as `Engine.ai`).
 *
 * This is what makes the original game's skirmish AI feel varied: hundreds of
 * hand-authored attack teams ("2 IFV + 2 Prism Tank", "3 Rhinos + Flak Track",
 * "engineer + escort"...), each gated by a condition on the game state
 * ("enemy owns >= 1 battle lab", "enemy is low on power") and picked by
 * weighted roll. We reuse that data verbatim and let missions execute the
 * teams with our own squad logic.
 *
 * All rolls use the shared game PRNG (lockstep-safe); the parsed database is
 * identical on every client because the ini ships with the game.
 */

export interface AiTaskForce {
    id: string;
    name: string;
    /** unitName -> count */
    units: UnitComposition;
    totalUnits: number;
}

export interface AiTeamType {
    id: string;
    name: string;
    priority: number;
    max: number;
    isBaseDefense: boolean;
    autocreate: boolean;
    taskForceId: string;
    scriptId: string;
}

/**
 * What a team's retail script says it should hunt (from the first Attack
 * Quarry Type / Attack Enemy Structure action).
 */
export type TargetIntent =
    | "anything"
    | "harvesters"
    | "buildings"
    | "defenses"
    | "factories"
    | "infantry"
    | "vehicles"
    | "power"
    | null;

/** Coarse role derived from the script: only 'attack' teams get thrown at the enemy. */
export type TeamRole = "attack" | "guard" | "expand";

// Script action 0 argument -> intent (ModEnc quarry types).
const QUARRY_TO_INTENT: Record<number, TargetIntent> = {
    1: "anything",
    2: "buildings",
    3: "harvesters",
    4: "infantry",
    5: "vehicles",
    6: "factories",
    7: "defenses",
    8: "anything",
    9: "power",
    10: "buildings",
    11: "buildings",
};

/** Minimal building facts needed to categorize an Attack Enemy Structure action. */
export interface BuildingFacts {
    isFactory: boolean;
    isRefinery: boolean;
    isBaseDefense: boolean;
    power: number;
}

export interface AiTrigger {
    id: string;
    name: string;
    teamTypeId: string;
    /** 0 = all, 1 = Allied, 2 = Soviet, 3 = Yuri */
    side: number;
    conditionType: number;
    conditionObject: string;
    comparatorValue: number;
    /** 0 '<' 1 '<=' 2 '==' 3 '>=' 4 '>' 5 '!=' */
    comparatorOp: number;
    startWeight: number;
    minWeight: number;
    maxWeight: number;
    forSkirmish: boolean;
    isBaseDefense: boolean;
    enabledInEasy: boolean;
    enabledInMedium: boolean;
    enabledInHard: boolean;
}

export interface AiTriggerEntry {
    trigger: AiTrigger;
    teamType: AiTeamType;
    taskForce: AiTaskForce;
    /** Sum of `cost * count` over the taskforce at parse time. */
    totalCost: number;
    currentWeight: number;
    /** From the team's retail script: what this team hunts. */
    targetIntent: TargetIntent;
    /** attack / guard / expand — only attack teams join the offensive pool. */
    role: TeamRole;
    /** Stable parse-order index (used for the per-match trigger mask). */
    index: number;
    /** Outcome history for the retail track-record bonus. */
    successCount: number;
    totalCount: number;
}

// Genuine retail rulesmd [General] values (probed): AITriggerSuccessWeightDelta=20,
// AITriggerFailureWeightDelta=-50, AITriggerTrackRecordCoefficient=1. Retail
// feedback is brutal: a team that dies once is nearly benched, winners snowball
// (successful teams also earn a track-record bonus).
const SUCCESS_WEIGHT_DELTA = 20;
const FAILURE_WEIGHT_DELTA = -50;
const TRACK_RECORD_COEFFICIENT = 1;

const ENGINEER_NAMES = new Set(["ENGINEER", "SENGINEER", "YENGINEER"]);

function parseBool(value: string | undefined): boolean {
    return value?.trim().toLowerCase().startsWith("y") ?? false;
}

function rawString(value: string | string[] | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return Array.isArray(value) ? value.join(",") : value;
}

/** Comparator blob: 8 little-endian dwords as hex; [0] = value, [1] = operator. */
function parseComparator(hex: string): { value: number; op: number } {
    const dword = (index: number) => {
        const chunk = hex.substring(index * 8, index * 8 + 8);
        if (chunk.length < 8) {
            return 0;
        }
        let result = 0;
        for (let byte = 3; byte >= 0; byte--) {
            result = result * 256 + parseInt(chunk.substring(byte * 2, byte * 2 + 2), 16);
        }
        return result;
    };
    return { value: dword(0), op: dword(1) };
}

function compare(actual: number, op: number, expected: number): boolean {
    switch (op) {
        case 0: return actual < expected;
        case 1: return actual <= expected;
        case 2: return actual === expected;
        case 3: return actual >= expected;
        case 4: return actual > expected;
        case 5: return actual !== expected;
        default: return false;
    }
}

/**
 * Map a vanilla side adapter to the trigger Side field. A custom Ares side
 * has no safe legacy trigger mapping, so return undefined instead of making
 * it behave as Soviet/Yuri or as the wildcard side.
 */
export function sideTypeToTriggerSide(side: SideType | {
    side?: SideType;
    legacySideFallback?: boolean;
    sideDefinition?: { legacySide?: SideType };
}): number | undefined {
    if (typeof side !== "number") {
        if (side.legacySideFallback) return undefined;
        side = side.sideDefinition?.legacySide ?? side.side;
        if (side === undefined) return undefined;
    }
    switch (side) {
        case SideType.GDI: return 1;
        case SideType.Nod: return 2;
        case SideType.Yuri: return 3;
        case SideType.Civilian:
        case SideType.Mutant:
            return 0;
        default: return undefined;
    }
}

interface IniSectionLike {
    entries: Map<string, string | string[]>;
    getString(key: string, defaultValue?: string): string;
    getNumber(key: string, defaultValue?: number): number;
}
interface IniFileLike {
    getSection(name: string): IniSectionLike | undefined;
}

export class AiTriggerDatabase {
    public readonly entries: AiTriggerEntry[] = [];

    /**
     * @param aiIni the parsed ai(md).ini (Engine.ai)
     * @param unitCost resolver for a unit's credit cost (0 if unknown)
     * @param buildingByIndex resolver for [BuildingTypes] list index → facts
     *        (used to categorize Attack Enemy Structure script actions)
     */
    constructor(
        aiIni: IniFileLike,
        unitCost: (unitName: string) => number,
        buildingByIndex?: (index: number) => BuildingFacts | null,
    ) {
        const taskForces = new Map<string, AiTaskForce>();
        const teamTypes = new Map<string, AiTeamType>();

        const tfList = aiIni.getSection("TaskForces");
        if (tfList) {
            for (const [, sectionName] of tfList.entries) {
                const id = rawString(sectionName);
                if (!id) continue;
                const section = aiIni.getSection(id);
                if (!section) continue;
                const units: UnitComposition = {};
                let totalUnits = 0;
                for (const [key, value] of section.entries) {
                    if (!/^\d+$/.test(key)) continue;
                    const raw = rawString(value);
                    if (!raw) continue;
                    const [countStr, unitName] = raw.split(",").map((s) => s.trim());
                    const count = parseInt(countStr, 10);
                    if (!unitName || !Number.isFinite(count) || count <= 0) continue;
                    units[unitName] = (units[unitName] ?? 0) + count;
                    totalUnits += count;
                }
                if (totalUnits > 0) {
                    taskForces.set(id, { id, name: section.getString("Name"), units, totalUnits });
                }
            }
        }

        const ttList = aiIni.getSection("TeamTypes");
        if (ttList) {
            for (const [, sectionName] of ttList.entries) {
                const id = rawString(sectionName);
                if (!id) continue;
                const section = aiIni.getSection(id);
                if (!section) continue;
                const taskForceId = section.getString("TaskForce");
                if (!taskForceId) continue;
                teamTypes.set(id, {
                    id,
                    name: section.getString("Name"),
                    priority: section.getNumber("Priority", 0),
                    max: section.getNumber("Max", 1),
                    isBaseDefense: parseBool(section.getString("IsBaseDefense")),
                    autocreate: parseBool(section.getString("Autocreate")),
                    taskForceId,
                    scriptId: section.getString("Script"),
                });
            }
        }

        // Parse each team's script for role + targeting intent. Retail scripts
        // encode what a team is FOR: quarry-type attacks, structure attacks,
        // home-guard patrol loops, or MCV expansion. Without this, guard dog
        // packs and MCVs get thrown across the map as "attack squads".
        const scriptMeta = new Map<string, { role: TeamRole; intent: TargetIntent }>();
        const readScriptMeta = (scriptId: string): { role: TeamRole; intent: TargetIntent } => {
            const cached = scriptMeta.get(scriptId);
            if (cached) {
                return cached;
            }
            const result: { role: TeamRole; intent: TargetIntent } = { role: "attack", intent: "anything" };
            const section = aiIni.getSection(scriptId);
            if (section) {
                const actions: { action: number; arg: number }[] = [];
                for (const [key, value] of section.entries) {
                    if (!/^\d+$/.test(key)) continue;
                    const raw = rawString(value);
                    if (!raw) continue;
                    const [actionStr, argStr] = raw.split(",");
                    const action = parseInt(actionStr, 10);
                    const arg = parseInt(argStr, 10);
                    if (Number.isFinite(action)) {
                        actions.push({ action, arg: Number.isFinite(arg) ? arg : 0 });
                    }
                }
                let intent: TargetIntent = null;
                for (const { action, arg } of actions) {
                    if (action === 0 && arg >= 1 && QUARRY_TO_INTENT[arg]) {
                        intent = QUARRY_TO_INTENT[arg];
                        break;
                    }
                    if (action === 46) {
                        const facts = buildingByIndex?.(arg % 65536) ?? null;
                        intent = !facts
                            ? "buildings"
                            : facts.isFactory
                              ? "factories"
                              : facts.isRefinery
                                ? "harvesters"
                                : facts.isBaseDefense
                                  ? "defenses"
                                  : facts.power > 0
                                    ? "power"
                                    : "buildings";
                        break;
                    }
                    if (action === 59) {
                        intent = "buildings";
                        break;
                    }
                }
                if (intent) {
                    result.role = "attack";
                    result.intent = intent;
                } else if (actions.some(({ action }) => action === 9)) {
                    // Deploy — MCV expansion team.
                    result.role = "expand";
                    result.intent = null;
                } else if (
                    actions.some(
                        ({ action, arg }) =>
                            action === 58 || action === 61 || action === 62 || action === 63 ||
                            (action === 11 && arg === 11),
                    )
                ) {
                    // Move-to-friendly-structure / occupy-bunker / area-guard
                    // loops — home guard, not an assault team.
                    result.role = "guard";
                    result.intent = null;
                }
            }
            scriptMeta.set(scriptId, result);
            return result;
        };

        const atList = aiIni.getSection("AITriggerTypes");
        if (atList) {
            for (const [id, value] of atList.entries) {
                const raw = rawString(value);
                if (!raw) continue;
                const fields = raw.split(",");
                if (fields.length < 18) continue;
                const teamType = teamTypes.get(fields[1]?.trim());
                if (!teamType) continue;
                const taskForce = taskForces.get(teamType.taskForceId);
                if (!taskForce) continue;
                const comparator = parseComparator(fields[6]?.trim() ?? "");
                const trigger: AiTrigger = {
                    id,
                    name: fields[0]?.trim() ?? id,
                    teamTypeId: teamType.id,
                    side: parseInt(fields[12], 10) || 0,
                    conditionType: parseInt(fields[4], 10),
                    conditionObject: fields[5]?.trim() ?? "<none>",
                    comparatorValue: comparator.value,
                    comparatorOp: comparator.op,
                    startWeight: parseFloat(fields[7]) || 0,
                    minWeight: parseFloat(fields[8]) || 0,
                    maxWeight: parseFloat(fields[9]) || 100,
                    forSkirmish: fields[10]?.trim() === "1",
                    isBaseDefense: fields[13]?.trim() === "1" || teamType.isBaseDefense,
                    enabledInEasy: fields[15]?.trim() === "1",
                    enabledInMedium: fields[16]?.trim() === "1",
                    enabledInHard: fields[17]?.trim() === "1",
                };
                if (!trigger.forSkirmish || trigger.startWeight <= 0) {
                    continue;
                }
                // Engineer teams need capture scripting we don't emulate in
                // combat squads; the dedicated EngineerMission covers that role.
                if (Object.keys(taskForce.units).some((name) => ENGINEER_NAMES.has(name))) {
                    continue;
                }
                let totalCost = 0;
                for (const [unitName, count] of Object.entries(taskForce.units)) {
                    totalCost += unitCost(unitName) * count;
                }
                const meta = readScriptMeta(teamType.scriptId);
                this.entries.push({
                    trigger,
                    teamType,
                    taskForce,
                    totalCost,
                    currentWeight: trigger.startWeight,
                    targetIntent: meta.intent,
                    role: meta.role,
                    index: this.entries.length,
                    successCount: 0,
                    totalCount: 0,
                });
            }
        }
    }

    /**
     * Offensive triggers currently eligible for this player: side matches,
     * difficulty allows, condition holds, and every taskforce unit is
     * currently producible (tech tree progression gates teams naturally).
     */
    public getEligibleAttackTriggers(
        game: GameApi,
        playerData: PlayerData,
        difficulty: "easy" | "medium" | "hard",
        buildableUnits: Set<string>,
    ): AiTriggerEntry[] {
        const mySide = sideTypeToTriggerSide(playerData.country!);
        if (mySide === undefined) {
            // The built-in retail trigger database has no semantics for a
            // data-defined Ares side. Do not run its side-filtered teams under
            // a guessed vanilla side; a profile-specific AI can consume the
            // stable country/side IDs instead.
            return [];
        }
        // Precompute the world census ONCE: per-trigger conditions used to
        // issue a full-world scan each (a burst of 40-120 scans per pass).
        const enemyCounts = new Map<string, number>();
        // Retail AITriggerType conditions read the enemy house's REAL
        // inventory (no shroud check) — census globally, or an unscouted
        // human fails every "enemy owns X" condition and the trigger pool
        // collapses to the unconditional starter teams.
        for (const id of (game as any).getEnemyUnitsGlobal(playerData.name)) {
            const rules: any = (game.getGameObjectData(id) as any)?.rules;
            if (rules?.name) {
                enemyCounts.set(rules.name, (enemyCounts.get(rules.name) ?? 0) + 1);
            }
        }
        const selfCounts = new Map<string, number>();
        for (const id of game.getVisibleUnits(playerData.name, "self")) {
            const rules: any = (game.getGameObjectData(id) as any)?.rules;
            if (rules?.name) {
                selfCounts.set(rules.name, (selfCounts.get(rules.name) ?? 0) + 1);
            }
        }
        const enemies = this.getEnemies(game, playerData);
        return this.entries.filter((entry) => {
            const { trigger, taskForce } = entry;
            if (trigger.isBaseDefense) return false;
            // Guard/patrol and MCV-expansion teams are not assault teams.
            if (entry.role !== "attack") return false;
            if (trigger.side !== 0 && trigger.side !== mySide) return false;
            if (difficulty === "easy" && !trigger.enabledInEasy) return false;
            if (difficulty === "medium" && !trigger.enabledInMedium) return false;
            if (difficulty === "hard" && !trigger.enabledInHard) return false;
            if (entry.currentWeight <= 0) return false;
            if (!Object.keys(taskForce.units).every((name) => buildableUnits.has(name))) return false;
            return this.evaluateConditionCached(game, playerData, entry.trigger, enemyCounts, selfCounts, enemies);
        });
    }

    private evaluateConditionCached(
        game: GameApi,
        playerData: PlayerData,
        trigger: AiTrigger,
        enemyCounts: Map<string, number>,
        selfCounts: Map<string, number>,
        enemies: PlayerData[],
    ): boolean {
        const { conditionType, conditionObject, comparatorValue, comparatorOp } = trigger;
        switch (conditionType) {
            case -1:
                return true;
            case 0:
                return compare(enemyCounts.get(conditionObject) ?? 0, comparatorOp, comparatorValue);
            case 1:
                return compare(selfCounts.get(conditionObject) ?? 0, comparatorOp, comparatorValue);
            case 2:
            case 3: {
                const factor = conditionType === 2 ? 1 : 0.5;
                return enemies.some((enemy) => enemy.power.total < enemy.power.drain * factor);
            }
            case 4:
                return enemies.some((enemy) => compare(enemy.credits, comparatorOp, comparatorValue));
            case 5:
                return this.ownSuperweaponCharged(game, playerData.name, 1 /* IronCurtain */);
            case 6:
                return this.ownSuperweaponCharged(game, playerData.name, 3 /* ChronoSphere */);
            default:
                return false;
        }
    }

    /** Weighted deterministic pick; returns null on an empty pool. */
    public pickWeighted(game: GameApi, pool: AiTriggerEntry[], bias: (entry: AiTriggerEntry) => number): AiTriggerEntry | null {
        if (pool.length === 0) {
            return null;
        }
        const weights = pool.map((entry) => Math.max(1, Math.round(entry.currentWeight * bias(entry) * 10)));
        const total = weights.reduce((sum, w) => sum + w, 0);
        let roll = game.generateRandomInt(0, total - 1);
        for (let i = 0; i < pool.length; i++) {
            roll -= weights[i];
            if (roll < 0) {
                return pool[i];
            }
        }
        return pool[pool.length - 1];
    }

    /** Team outcome feedback, like retail: failed teams fade, winners repeat. */
    public reportOutcome(entry: AiTriggerEntry, success: boolean): void {
        entry.totalCount++;
        let delta = FAILURE_WEIGHT_DELTA;
        if (success) {
            entry.successCount++;
            // Retail track record: proven teams earn a compounding bonus.
            const record = entry.successCount / entry.totalCount;
            delta =
                SUCCESS_WEIGHT_DELTA +
                Math.max(0, entry.successCount * (record - 0.5)) * TRACK_RECORD_COEFFICIENT;
        }
        entry.currentWeight = Math.min(
            entry.trigger.maxWeight,
            Math.max(entry.trigger.minWeight, entry.currentWeight + delta),
        );
    }

    /** Retail AIMinorSuperReadyPercent: charged enough to plan around. */
    private ownSuperweaponCharged(game: GameApi, playerName: string, swType: number): boolean {
        try {
            const all = (game as any).getAllSuperWeaponData?.() ?? [];
            return all.some(
                (sw: any) =>
                    sw.playerName === playerName &&
                    Number(sw.type) === swType &&
                    (Number(sw.status) === 2 || (sw.chargeProgress ?? 0) >= 0.7),
            );
        } catch (err) {
            return false;
        }
    }

    private getEnemies(game: GameApi, playerData: PlayerData): PlayerData[] {
        return game
            .getPlayers()
            .filter((name) => name !== playerData.name && !game.areAlliedPlayers(playerData.name, name))
            .map((name) => game.getPlayerData(name))
            .filter((p) => p.isCombatant);
    }
}
