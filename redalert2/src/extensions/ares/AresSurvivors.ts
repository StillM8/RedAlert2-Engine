import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

function iniOf(rules: any): any {
    return rules?.ini;
}

function numberValue(rules: any, directName: string, iniName: string, fallback: number): number {
    const direct = rules?.[directName];
    if (Number.isFinite(direct)) return Number(direct);
    return Number(iniOf(rules)?.getNumber?.(iniName, fallback) ?? fallback);
}

function rankPrefix(level: VeteranLevel | number | undefined): "Rookie" | "Veteran" | "Elite" {
    if ((level ?? VeteranLevel.None) >= VeteranLevel.Elite) return "Elite";
    if ((level ?? VeteranLevel.None) >= VeteranLevel.Veteran) return "Veteran";
    return "Rookie";
}

export function getAresSurvivorPilotCount(object: any): number {
    const fallback = object?.rules?.crewed ? 1 : 0;
    return Math.max(0, Math.floor(numberValue(object?.rules, "survivorPilots", "Survivor.Pilots", fallback)));
}

export function getAresSurvivorPilotChance(object: any, crewEscapePercent: number): number {
    const prefix = rankPrefix(object?.veteranLevel);
    const authored = numberValue(
        object?.rules,
        `survivor${prefix}PilotChance`,
        `Survivor.${prefix}PilotChance`,
        -1,
    );
    return authored < 0 ? crewEscapePercent : Math.max(0, Math.min(100, authored));
}

/**
 * -1 is intentionally preserved: Ares uses it as the original-game passenger
 * survivor behavior (ground transports eject cargo, airborne transports do not).
 */
export function getAresSurvivorPassengerChance(object: any): number {
    const prefix = rankPrefix(object?.veteranLevel);
    const authored = numberValue(
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

export function shouldAresPassengerSurvive(transport: any, context: any): boolean {
    const chance = getAresSurvivorPassengerChance(transport);
    if (chance < 0) {
        // Original YR behavior represented by Ares' special -1 default.
        return transport?.zone !== ZoneType.Air;
    }
    return rollAresSurvivorPercent(context, chance);
}
