import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { LocomotorType } from "@/game/type/LocomotorType";
import { Engine } from "@/engine/Engine";

function iniOf(rules: any): any {
    return rules?.ini;
}

function numberValue(rules: any, directName: string, iniName: string, fallback: number): number {
    const direct = rules?.[directName];
    if (Number.isFinite(direct)) return Number(direct);
    return Number(iniOf(rules)?.getNumber?.(iniName, fallback) ?? fallback);
}

/**
 * Survivor chance keys are documented as 0..100 integers, but this engine's
 * generic IniSection parser deliberately turns a literal `50%` into 0.5.
 * Read the raw string here so both `50` and `50%` mean fifty percent while a
 * bare `1` remains one percent (not one hundred percent).
 */
function percentValue(rules: any, directName: string, iniName: string, fallback: number): number {
    const direct = rules?.[directName];
    if (Number.isFinite(direct)) return Number(direct);
    const raw = String(iniOf(rules)?.getString?.(iniName) ?? "").trim();
    if (!raw) return fallback;
    const percentLiteral = raw.endsWith("%");
    const value = Number(percentLiteral ? raw.slice(0, -1).trim() : raw);
    return Number.isFinite(value) ? value : fallback;
}

function normalizePercentFallback(value: number): number {
    // GeneralRules/CrewRules are populated through IniSection.getNumber(), so
    // an authored 50% arrives here as 0.5. Plain numeric 50 remains 50.
    return value >= 0 && value <= 1 ? value * 100 : value;
}

function rankPrefix(level: VeteranLevel | number | undefined): "Rookie" | "Veteran" | "Elite" {
    if ((level ?? VeteranLevel.None) >= VeteranLevel.Elite) return "Elite";
    if ((level ?? VeteranLevel.None) >= VeteranLevel.Veteran) return "Veteran";
    return "Rookie";
}

/** Explicit Survivor.* keys opt a rules object into the feature even in
 * standalone tests/tools that do not initialize an Ares profile. */
export function hasAresSurvivorRules(rules: any): boolean {
    if (!rules) return false;
    if (Number.isFinite(rules.survivorPilotCount) || rules.survivorBySide) return true;
    const entries = iniOf(rules)?.entries;
    if (!entries?.keys) return false;
    for (const key of entries.keys()) {
        if (/^survivor\./i.test(String(key).trim())) return true;
    }
    return false;
}

/**
 * Ares defaults (for example PilotCount defaulting to one for Crewed=yes)
 * apply only when the selected content activates the Ares runtime. Explicit
 * Survivor.* keys are also honored in isolated tests/tools.
 */
export function isAresSurvivorRuntimeEnabled(rules?: any): boolean {
    return Engine.getActiveProfile().extensionRuntime === "ares" || hasAresSurvivorRules(rules);
}

export function getAresSurvivorPilotCount(object: any): number {
    const fallback = object?.rules?.crewed ? 1 : 0;
    return Math.max(0, Math.floor(numberValue(object?.rules, "survivorPilotCount", "Survivor.PilotCount", fallback)));
}

export function getAresSurvivorPilotChance(object: any, crewEscapePercent: number): number {
    const prefix = rankPrefix(object?.veteranLevel);
    const authored = percentValue(
        object?.rules,
        `survivor${prefix}PilotChance`,
        `Survivor.${prefix}PilotChance`,
        -1,
    );
    const value = authored < 0 ? normalizePercentFallback(crewEscapePercent) : authored;
    return Math.max(0, Math.min(100, value));
}

/**
 * -1 is intentionally preserved: Ares uses it as the original-game passenger
 * survivor behavior (ground transports eject cargo, airborne transports do not).
 */
export function getAresSurvivorPassengerChance(object: any): number {
    const prefix = rankPrefix(object?.veteranLevel);
    const authored = percentValue(
        object?.rules,
        `survivor${prefix}PassengerChance`,
        `Survivor.${prefix}PassengerChance`,
        -1,
    );
    return authored < 0 ? -1 : Math.max(0, Math.min(100, authored));
}

export function getAresTechnicianChance(object: any): number {
    const fallback = object?.isBuilding?.() && object?.rules?.primary ? 15 : 0;
    return Math.max(0, Math.min(100, numberValue(
        object?.rules,
        "crewTechnicianChance",
        "Crew.TechnicianChance",
        fallback,
    )));
}

export function getAresEngineerChance(object: any): number {
    const buildingFactory = object?.isBuilding?.() && object?.rules?.factory === 1;
    const fallback = buildingFactory ? 25 : 0;
    return Math.max(0, Math.min(100, numberValue(
        object?.rules,
        "crewEngineerChance",
        "Crew.EngineerChance",
        fallback,
    )));
}

export function getAresSideSurvivorOverride(object: any): string | undefined {
    const side = object?.owner?.country?.sideDefinition;
    const index = Number.isFinite(side?.index)
        ? Number(side.index)
        : Number.isFinite(side?.order)
            ? Number(side.order)
            : Number(object?.owner?.country?.side ?? 0);
    const direct = object?.rules?.survivorBySide?.[index];
    const value = String(
        direct ?? iniOf(object?.rules)?.getString?.(`Survivor.Side${index}`) ?? "",
    ).trim();
    if (!value || /^<none>$/i.test(value) || /^none$/i.test(value)) return undefined;
    return value;
}

export function rollAresSurvivorPercent(context: any, percent: number): boolean {
    if (percent <= 0) return false;
    if (percent >= 100) return true;
    return context.generateRandomInt(0, 99) < percent;
}

/**
 * Ares' -1 passenger chance means the original YR transport-class rule, not
 * the object's transient zone at the moment destroyObject finally runs. A
 * crashing jumpjet may already be back on the ground by then but must still
 * retain the Nighthawk-style "cargo does not escape" default.
 */
export function usesOriginalAirbornePassengerDeath(transport: any): boolean {
    const locomotor = transport?.rules?.locomotor;
    return transport?.isAircraft?.() === true ||
        transport?.rules?.consideredAircraft === true ||
        locomotor === LocomotorType.Jumpjet ||
        locomotor === LocomotorType.Aircraft ||
        transport?.zone === ZoneType.Air;
}

export function shouldAresPassengerSurvive(transport: any, context: any): boolean {
    const chance = getAresSurvivorPassengerChance(transport);
    if (chance < 0) {
        return !usesOriginalAirbornePassengerDeath(transport);
    }
    return rollAresSurvivorPercent(context, chance);
}

/**
 * Ares pilots inherit the destroyed unit's exact veterancy/experience rather
 * than merely its rank. VeteranTrait intentionally has no serialization API
 * yet, so keep the one compatibility access here instead of scattering casts
 * across gameplay code. setRankFromTransport applies all rank side-effects;
 * the source XP remainder is restored afterwards.
 */
export function copyAresSurvivorExperience(source: any, survivor: any, world: any): void {
    const sourceTrait: any = source?.veteranTrait;
    const survivorTrait: any = survivor?.veteranTrait;
    if (!sourceTrait || !survivorTrait) return;
    if (typeof survivorTrait.setRankFromTransport === "function") {
        survivorTrait.setRankFromTransport(source.veteranLevel ?? VeteranLevel.None, world);
    }
    else if (typeof survivorTrait.setVeteranLevel === "function") {
        survivorTrait.setVeteranLevel(source.veteranLevel ?? VeteranLevel.None);
    }
    if (Number.isFinite(sourceTrait.xp)) {
        survivorTrait.xp = sourceTrait.xp;
    }
}
