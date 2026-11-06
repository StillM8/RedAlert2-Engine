import type {
    AresSuperWeaponAITargetingProfile,
    AresSuperWeaponAITargetingMode,
} from "@/extensions/ares/AresSuperWeaponAI";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

export type AresSuperWeaponTargetKind = "infantry" | "units" | "buildings" | "aircraft";
export type AresSuperWeaponHouseRelation = "owner" | "allies" | "enemies" | "neutral";
export type AresSuperWeaponTargetPoint = { x: number; y: number };

export interface AresSuperWeaponTargetUnit extends AresSuperWeaponTargetPoint {
    id?: string | number;
    targetKind: AresSuperWeaponTargetKind;
    houseRelation: AresSuperWeaponHouseRelation;
    isCloaked?: boolean;
    value?: number;
    score?: number;
    threat?: number;
    visible?: boolean;
    zone?: ZoneType;
    inLimbo?: boolean;
    isAirborne?: boolean;
    canBePermaMindControlled?: boolean;
    immuneToPsionics?: boolean;
}

export interface AresSuperWeaponTargetCell extends AresSuperWeaponTargetPoint {
    zone?: ZoneType;
    visible?: boolean;
}

export interface AresSuperWeaponPlannerInput {
    profile: AresSuperWeaponAITargetingProfile;
    units?: readonly AresSuperWeaponTargetUnit[];
    gateUnits?: readonly AresSuperWeaponTargetUnit[];
    cells?: readonly AresSuperWeaponTargetCell[];
    preferredCells?: Partial<Record<"offensive" | "defensive", AresSuperWeaponTargetPoint>>;
    underAttack?: boolean;
    lowPower?: boolean;
    lightningStormActive?: boolean;
    psychicDominatorActive?: boolean;
    startLocation?: AresSuperWeaponTargetPoint;
    ownBaseCenter?: AresSuperWeaponTargetPoint;
    enemyBase?: AresSuperWeaponTargetPoint;
    enemyHouseExists?: boolean;
    selfTargets?: readonly AresSuperWeaponTargetPoint[];
    attackTargets?: readonly AresSuperWeaponTargetPoint[];
    deliveryTargets?: readonly AresSuperWeaponTargetPoint[];
    dropPodTargets?: readonly AresSuperWeaponTargetPoint[];
    forceShieldTargets?: readonly AresSuperWeaponTargetPoint[];
    extensionType?: string;
    requiresTarget?: string;
    requiresHouse?: string;
    candidateFilter?: (candidate: AresSuperWeaponTargetUnit) => boolean;
    targetFilter?: (target: AresSuperWeaponTargetPoint, candidate?: AresSuperWeaponTargetUnit) => boolean;
    launchAllowed?: (target: AresSuperWeaponTargetPoint) => boolean;
    activationAllowed?: (target: AresSuperWeaponTargetPoint) => boolean;
    fireIntoShroudAllowed?: (target: AresSuperWeaponTargetPoint) => boolean;
    randomInt?: (min: number, max: number) => number;
    randomCell?: () => AresSuperWeaponTargetPoint | undefined;
    enforceConstraints?: boolean;
}

interface SelectedTarget {
    point: AresSuperWeaponTargetPoint;
    candidate?: AresSuperWeaponTargetUnit;
}

interface ClusterTarget extends SelectedTarget {
    score: number;
    key: string;
}

const CONTENT_TARGETS = new Set(["infantry", "units", "buildings", "aircraft"]);
const CLOAK_IGNORING_TARGET_MODES = new Set<AresSuperWeaponAITargetingMode>([
    "nuke",
    "lightning-storm",
    "psychic-dominator",
    "genetic-mutator",
    "offensive",
]);
const UNIT_MODES = new Set<AresSuperWeaponAITargetingMode>([
    "nuke",
    "lightning-storm",
    "psychic-dominator",
    "genetic-mutator",
    "offensive",
    "stealth",
    "multi-missile",
]);

function compact(value: string | undefined): string {
    return (value ?? "").trim().toLocaleLowerCase("en-US").replace(/[._\s-]+/g, "");
}

function pointKey(point: AresSuperWeaponTargetPoint): string {
    return `${point.x},${point.y}`;
}

function comparePoints(first: AresSuperWeaponTargetPoint, second: AresSuperWeaponTargetPoint): number {
    return first.x - second.x || first.y - second.y;
}

function unitKey(unit: AresSuperWeaponTargetUnit): string {
    const id = unit.id === undefined ? "" : String(unit.id);
    return `${id}\u0000${unit.x},${unit.y}\u0000${unit.targetKind}`;
}

function compareUnits(first: AresSuperWeaponTargetUnit, second: AresSuperWeaponTargetUnit): number {
    const firstId = Number(first.id);
    const secondId = Number(second.id);
    if (first.id !== undefined && second.id !== undefined &&
        Number.isFinite(firstId) && Number.isFinite(secondId) && firstId !== secondId) {
        return firstId - secondId;
    }
    return unitKey(first).localeCompare(unitKey(second)) || comparePoints(first, second);
}

function numericScore(value: number | undefined, fallback = 1): number {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function asPoint(value: any): AresSuperWeaponTargetPoint | undefined {
    const x = Number(value?.x ?? value?.rx);
    const y = Number(value?.y ?? value?.ry);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function normalizePoints(values: readonly AresSuperWeaponTargetPoint[] | undefined): AresSuperWeaponTargetPoint[] {
    const points = (values ?? []).map(asPoint).filter((point): point is AresSuperWeaponTargetPoint => !!point);
    return [...new Map(points.map((point) => [pointKey(point), point])).values()].sort(comparePoints);
}

function orderedPoints(values: readonly any[] | undefined): AresSuperWeaponTargetPoint[] {
    const points = (values ?? []).map(asPoint).filter((point): point is AresSuperWeaponTargetPoint => !!point);
    return [...new Map(points.map((point) => [pointKey(point), point])).values()];
}

function targetTokens(value: string | undefined): Set<string> {
    return new Set((value ?? "")
        .split(",")
        .map((token) => token.trim().toLocaleLowerCase("en-US"))
        .filter(Boolean));
}

function unitMatchesKind(unit: AresSuperWeaponTargetUnit, token: string): boolean {
    if (token === "buildings") return unit.targetKind === "buildings";
    if (token === "infantry") return unit.targetKind === "infantry";
    if (token === "aircraft") return unit.targetKind === "aircraft";
    return token === "units" && (unit.targetKind === "units" || unit.targetKind === "aircraft");
}

export function matchesAresSuperWeaponHouse(
    requiredHouse: string | undefined,
    relation: AresSuperWeaponHouseRelation,
): boolean {
    const token = compact(requiredHouse);
    if (!token || token === "none" || token === "all") return true;
    if (token === "owner" || token === "self") return relation === "owner";
    if (token === "allies" || token === "ally" || token === "friend" || token === "friends" || token === "friendly") {
        return relation === "allies";
    }
    if (token === "team") return relation === "owner" || relation === "allies";
    if (token === "enemies" || token === "enemy") return relation === "enemies";
    if (token === "others") return relation === "enemies" || relation === "neutral";
    return false;
}

export function matchesAresSuperWeaponTarget(
    requiredTarget: string | undefined,
    point: AresSuperWeaponTargetPoint,
    cell: AresSuperWeaponTargetCell | undefined,
    units: readonly AresSuperWeaponTargetUnit[],
): boolean {
    const targets = targetTokens(requiredTarget);
    if (!targets.size || targets.has("none") || targets.has("all")) return true;

    const zone = cell?.zone;
    if (targets.has("land") || targets.has("water")) {
        if (zone === ZoneType.Ground && !targets.has("land")) return false;
        if (zone === ZoneType.Water && !targets.has("water")) return false;
        if (zone !== ZoneType.Ground && zone !== ZoneType.Water) return false;
    }

    const content = [...targets].filter((token) => CONTENT_TARGETS.has(token));
    if (!content.length) return !targets.has("empty") || units.length === 0;
    if (!units.length) return targets.has("empty");
    return content.some((token) => units.some((unit) => unitMatchesKind(unit, token)));
}

function hasEnemyHouse(input: AresSuperWeaponPlannerInput): boolean {
    if (input.enemyHouseExists !== undefined) return input.enemyHouseExists;
    return asPoint(input.enemyBase) !== undefined || (input.units ?? []).some((unit) =>
        unit.visible !== false && unit.houseRelation === "enemies");
}

function relationForConstraint(
    input: AresSuperWeaponPlannerInput,
    candidate: AresSuperWeaponTargetUnit | undefined,
    hasPreferred: boolean,
): boolean {
    if (input.enemyHouseExists === false) return false;
    if (hasEnemyHouse(input) || hasPreferred) return true;
    return candidate?.houseRelation === "enemies";
}

function constraintsAllow(
    input: AresSuperWeaponPlannerInput,
    candidate: AresSuperWeaponTargetUnit | undefined,
    hasPreferred: boolean,
): boolean {
    if (input.enforceConstraints === false) return true;
    for (const constraint of input.profile.constraints) {
        switch (constraint) {
            case "low-power":
                if (input.lowPower !== true) return false;
                break;
            case "attacked":
                if (input.underAttack !== true) return false;
                break;
            case "lightning-storm-inactive":
                if (input.lightningStormActive === true) return false;
                break;
            case "dominator-inactive":
                if (input.psychicDominatorActive === true) return false;
                break;
            case "offensive-cell-set":
                if (!input.preferredCells?.offensive) return false;
                break;
            case "offensive-cell-clear":
                if (input.preferredCells?.offensive) return false;
                break;
            case "defensive-cell-set":
                if (!input.preferredCells?.defensive) return false;
                break;
            case "defensive-cell-clear":
                if (input.preferredCells?.defensive) return false;
                break;
            case "enemy":
                if (!relationForConstraint(input, candidate, hasPreferred)) return false;
                break;
        }
    }
    return true;
}

function cellMap(input: AresSuperWeaponPlannerInput): Map<string, AresSuperWeaponTargetCell> {
    const cells = new Map<string, AresSuperWeaponTargetCell>();
    for (const cell of input.cells ?? []) {
        const point = asPoint(cell);
        if (!point) continue;
        cells.set(pointKey(point), { ...point, zone: cell.zone, visible: cell.visible });
    }
    for (const unit of [...(input.units ?? []), ...(input.gateUnits ?? [])]) {
        const key = pointKey(unit);
        const existing = cells.get(key);
        if (!existing) {
            cells.set(key, { x: unit.x, y: unit.y, zone: unit.zone, visible: unit.visible });
        }
        else {
            if (unit.visible === false) existing.visible = false;
            if (existing.zone === undefined && unit.zone !== undefined) existing.zone = unit.zone;
        }
    }
    for (const point of [
        input.startLocation,
        input.ownBaseCenter,
        input.enemyBase,
        ...(input.selfTargets ?? []),
        ...(input.attackTargets ?? []),
        ...(input.deliveryTargets ?? []),
        ...(input.dropPodTargets ?? []),
        ...(input.forceShieldTargets ?? []),
        ...Object.values(input.preferredCells ?? {}),
    ]) {
        const normalized = asPoint(point);
        if (normalized && !cells.has(pointKey(normalized))) {
            cells.set(pointKey(normalized), { x: normalized.x, y: normalized.y, visible: true });
        }
    }
    return cells;
}

function orderedCells(input: AresSuperWeaponPlannerInput): AresSuperWeaponTargetCell[] {
    return [...cellMap(input).values()].sort(comparePoints);
}

function unitsAt(input: AresSuperWeaponPlannerInput, point: AresSuperWeaponTargetPoint): AresSuperWeaponTargetUnit[] {
    const key = pointKey(point);
    const source = input.gateUnits ?? input.units ?? [];
    return source
        .filter((unit) => pointKey(unit) === key)
        .sort(compareUnits);
}

function cellFor(input: AresSuperWeaponPlannerInput, point: AresSuperWeaponTargetPoint): AresSuperWeaponTargetCell {
    return cellMap(input).get(pointKey(point)) ?? { x: point.x, y: point.y, visible: true };
}

function candidateVisible(
    input: AresSuperWeaponPlannerInput,
    candidate: AresSuperWeaponTargetUnit,
): boolean {
    return candidate.visible !== false && cellFor(input, candidate).visible !== false;
}

function candidateMatches(
    input: AresSuperWeaponPlannerInput,
    candidate: AresSuperWeaponTargetUnit,
    mode: AresSuperWeaponAITargetingMode,
): boolean {
    if (!candidateVisible(input, candidate)) return false;
    if ((mode === "psychic-dominator" || mode === "genetic-mutator") && candidate.inLimbo === true) return false;
    if (CLOAK_IGNORING_TARGET_MODES.has(mode) && candidate.isCloaked === true) return false;
    if (mode === "stealth" && candidate.isCloaked !== true) return false;
    if (mode === "genetic-mutator" && candidate.targetKind !== "infantry") return false;
    if (!matchesAresSuperWeaponTarget(
        input.profile.requiredTarget,
        candidate,
        cellFor(input, candidate),
        [candidate],
    )) return false;
    if (!matchesAresSuperWeaponHouse(input.profile.requiredHouse, candidate.houseRelation)) return false;
    return input.candidateFilter?.(candidate) !== false;
}

function unitValue(unit: AresSuperWeaponTargetUnit): number {
    return numericScore(unit.score ?? unit.value, 1);
}

function unitThreat(
    unit: AresSuperWeaponTargetUnit,
    randomInt?: (min: number, max: number) => number,
): number {
    if (unit.isCloaked === true && randomInt) return numericScore(randomInt(0, 100), 0);
    return numericScore(unit.threat, unitValue(unit));
}

function clusterRepresentative(
    units: AresSuperWeaponTargetUnit[],
    mode: AresSuperWeaponAITargetingMode,
    randomInt?: (min: number, max: number) => number,
): AresSuperWeaponTargetUnit {
    return [...units].sort((first, second) => {
        const firstScore = mode === "multi-missile" ? unitThreat(first, randomInt) : unitValue(first);
        const secondScore = mode === "multi-missile" ? unitThreat(second, randomInt) : unitValue(second);
        return secondScore - firstScore || compareUnits(first, second);
    })[0];
}

function localClusterCandidates(
    units: readonly AresSuperWeaponTargetUnit[],
    radius: number,
    scoringUnits: readonly AresSuperWeaponTargetUnit[] = units,
): ClusterTarget[] {
    return units
        .map((unit) => ({
            point: { x: unit.x, y: unit.y },
            candidate: unit,
            score: scoringUnits.filter((candidate) =>
                Math.abs(candidate.x - unit.x) <= radius &&
                Math.abs(candidate.y - unit.y) <= radius).length,
            key: `${unit.x},${unit.y}:${unitKey(unit)}`,
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((first, second) =>
            second.score - first.score ||
            comparePoints(first.point, second.point) ||
            first.key.localeCompare(second.key));
}

function isSelectorHostile(unit: AresSuperWeaponTargetUnit): boolean {
    return unit.houseRelation === "enemies" || unit.houseRelation === "neutral";
}

function isSelectorAirborne(unit: AresSuperWeaponTargetUnit): boolean {
    return unit.isAirborne === true || unit.zone === ZoneType.Air;
}

function clusterCandidates(
    input: AresSuperWeaponPlannerInput,
    mode: AresSuperWeaponAITargetingMode,
): ClusterTarget[] {
    const eligible = (input.units ?? [])
        .filter((unit) => candidateMatches(input, unit, mode))
        .sort(compareUnits);
    if (!eligible.length) return [];

    if (mode === "psychic-dominator") {
        const representatives = eligible.filter(isSelectorHostile);
        const capturable = eligible.filter((unit) =>
            isSelectorHostile(unit) &&
            !isSelectorAirborne(unit) &&
            unit.targetKind !== "buildings" &&
            unit.canBePermaMindControlled !== false &&
            unit.immuneToPsionics !== true);
        return localClusterCandidates(representatives, 1, capturable);
    }
    if (mode === "genetic-mutator") {
        const hostileInfantry = eligible.filter((unit) =>
            isSelectorHostile(unit) && !isSelectorAirborne(unit));
        return localClusterCandidates(hostileInfantry, 1);
    }

    const groups = new Map<string, AresSuperWeaponTargetUnit[]>();
    for (const unit of eligible) {
        const key = `${Math.floor(unit.x / 8)},${Math.floor(unit.y / 8)}`;
        const group = groups.get(key) ?? [];
        group.push(unit);
        groups.set(key, group);
    }
    const threatScores = new Map<AresSuperWeaponTargetUnit, number>();
    if (mode === "multi-missile") {
        for (const unit of eligible) threatScores.set(unit, unitThreat(unit, input.randomInt));
    }
    return [...groups.entries()]
        .flatMap(([key, group]) => {
            const score = mode === "multi-missile"
                ? group.reduce((sum, unit) => sum + (threatScores.get(unit) ?? 0), 0)
                : group.reduce((sum, unit) => sum + unitValue(unit), 0);
            return [...group]
                .sort((first, second) => {
                    const firstScore = mode === "multi-missile"
                        ? threatScores.get(first) ?? 0
                        : unitValue(first);
                    const secondScore = mode === "multi-missile"
                        ? threatScores.get(second) ?? 0
                        : unitValue(second);
                    return secondScore - firstScore || compareUnits(first, second);
                })
                .map((representative, index) => ({
                    point: { x: representative.x, y: representative.y },
                    candidate: representative,
                    score,
                    key: `${key}:${index}:${unitKey(representative)}`,
                }));
        })
        .sort((first, second) =>
            second.score - first.score ||
            comparePoints(first.point, second.point) ||
            first.key.localeCompare(second.key));
}

function modeUsesUnits(mode: AresSuperWeaponAITargetingMode): boolean {
    return UNIT_MODES.has(mode);
}

function preferredPoint(input: AresSuperWeaponPlannerInput): AresSuperWeaponTargetPoint | undefined {
    if (input.profile.preference !== "offensive" && input.profile.preference !== "defensive") return undefined;
    return asPoint(input.preferredCells?.[input.profile.preference]);
}

function randomCellOrder(input: AresSuperWeaponPlannerInput): AresSuperWeaponTargetCell[] {
    const cells = orderedCells(input);
    const supplied = asPoint(input.randomCell?.());
    if (supplied) {
        const selected = cells.find((cell) => cell.x === supplied.x && cell.y === supplied.y);
        if (selected) return [selected, ...cells.filter((cell) => cell.x !== selected.x || cell.y !== selected.y)];
        return [{ x: supplied.x, y: supplied.y, visible: true }, ...cells];
    }
    if (cells.length < 2 || !input.randomInt) return cells;
    const start = Math.max(0, Math.min(cells.length - 1, Math.trunc(input.randomInt(0, cells.length - 1))));
    return [...cells.slice(start), ...cells.slice(0, start)];
}

function basePoint(input: AresSuperWeaponPlannerInput): AresSuperWeaponTargetPoint | undefined {
    const ownBase = asPoint(input.ownBaseCenter);
    if (ownBase) return ownBase;
    const buildings = (input.units ?? []).filter((unit) =>
        unit.houseRelation === "owner" && unit.targetKind === "buildings" && unit.visible !== false);
    const groups = new Map<string, AresSuperWeaponTargetUnit[]>();
    for (const building of buildings) {
        const key = `${Math.floor(building.x / 8)},${Math.floor(building.y / 8)}`;
        const group = groups.get(key) ?? [];
        group.push(building);
        groups.set(key, group);
    }
    const clusters = [...groups.entries()].map(([key, group]) => {
        const representative = clusterRepresentative(group, "offensive");
        return {
            point: { x: representative.x, y: representative.y },
            score: group.reduce((sum, unit) => sum + unitValue(unit), 0),
            key,
        };
    }).sort((first, second) =>
        second.score - first.score || comparePoints(first.point, second.point) || first.key.localeCompare(second.key));
    return clusters[0]?.point ?? asPoint(input.startLocation);
}

function paradropPoints(input: AresSuperWeaponPlannerInput): SelectedTarget[] {
    const provided = normalizePoints(input.deliveryTargets);
    const authoredCells = (input.cells ?? [])
        .map((cell): AresSuperWeaponTargetCell | undefined => {
            const point = asPoint(cell);
            return point ? { ...point, zone: cell.zone, visible: cell.visible } : undefined;
        })
        .filter((cell): cell is AresSuperWeaponTargetCell => !!cell);
    const cells = [...new Map(authoredCells.map((cell) => [pointKey(cell), cell])).values()];
    const anchor = asPoint(input.enemyBase) ?? asPoint(input.ownBaseCenter) ?? asPoint(input.startLocation);
    const rank = (values: readonly AresSuperWeaponTargetPoint[]): SelectedTarget[] => {
        const origin = anchor ?? values[0];
        return values
            .map((value) => ({
                point: { x: value.x, y: value.y },
                score: (input.units ?? [])
                    .filter((unit) => Math.abs(unit.x - value.x) <= 2 && Math.abs(unit.y - value.y) <= 2)
                    .reduce((sum, unit) => sum + unitValue(unit), 0),
                distance: origin
                    ? Math.abs(value.x - origin.x) + Math.abs(value.y - origin.y)
                    : 0,
            }))
            .sort((first, second) =>
                first.score - second.score ||
                first.distance - second.distance ||
                comparePoints(first.point, second.point))
            .map(({ point }) => ({ point }));
    };

    if (provided.length) return rank(provided);
    if (!authoredCells.length) {
        const fallback = input.attackTargets?.length
            ? input.attackTargets
            : [input.enemyBase, input.startLocation];
        return orderedPoints(fallback as any).map((value) => ({ point: value }));
    }

    const cellLookup = new Map(cells.map((cell) => [pointKey(cell), cell]));
    const occupied = new Set((input.units ?? []).map((unit) => pointKey(unit)));
    const land = cells.filter((cell) =>
        (cell.zone === undefined || cell.zone === ZoneType.Ground) && !occupied.has(pointKey(cell)));
    const complete = land.filter((cell) => {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const nearby = cellLookup.get(`${cell.x + dx},${cell.y + dy}`);
                if (!nearby ||
                    (nearby.zone !== undefined && nearby.zone !== ZoneType.Ground) ||
                    occupied.has(pointKey(nearby))) {
                    return false;
                }
            }
        }
        return true;
    });
    return rank(complete.length ? complete : land);
}

function pointsForMode(input: AresSuperWeaponPlannerInput): SelectedTarget[] {
    const mode = input.profile.mode;
    if (modeUsesUnits(mode)) {
        return clusterCandidates(input, mode);
    }
    const point = (value: any): SelectedTarget | undefined => {
        const normalized = asPoint(value);
        return normalized ? { point: normalized } : undefined;
    };
    switch (mode) {
        case "self": {
            const targets = input.selfTargets === undefined
                ? (input.units ?? [])
                    .filter((unit) => unit.houseRelation === "owner" && unit.targetKind === "buildings" && unit.visible !== false)
                    .map((unit) => ({ x: unit.x, y: unit.y }))
                : input.selfTargets;
            return normalizePoints(targets).map((value) => ({ point: value }));
        }
        case "base": {
            const value = basePoint(input);
            return value ? [{ point: value }] : [];
        }
        case "enemy-base": {
            const value = point(input.enemyBase) ?? point(
                (input.units ?? [])
                    .filter((unit) => unit.houseRelation === "enemies" && unit.targetKind === "buildings" && unit.visible !== false)
                    .sort(compareUnits)[0],
            );
            return value ? [value] : [];
        }
        case "paradrop":
            return paradropPoints(input);
        case "drop-pod": {
            const values = input.extensionType?.toLocaleLowerCase("en-US") === "droppod"
                ? input.dropPodTargets
                : input.attackTargets;
            const fallback = values?.length ? values : [input.enemyBase, input.startLocation];
            return orderedPoints(fallback as any).map((value) => ({ point: value }));
        }
        case "force-shield":
            return normalizePoints(input.forceShieldTargets).map((value) => ({ point: value }));
        case "no-target": {
            const value = point(input.startLocation);
            return value ? [value] : [];
        }
        case "hunter-seeker": {
            const value = point(input.startLocation);
            return hasEnemyHouse(input) && value ? [value] : [];
        }
        case "attack": {
            const values = input.attackTargets?.length ? input.attackTargets : [input.startLocation];
            return orderedPoints(values as any).map((value) => ({ point: value }));
        }
        case "low-power":
        case "low-power-attack": {
            const values = input.attackTargets?.length ? input.attackTargets : [input.startLocation];
            return orderedPoints(values as any).map((value) => ({ point: value }));
        }
        case "lightning-random":
            return randomCellOrder(input).map((value) => ({ point: { x: value.x, y: value.y } }));
        case "iron-curtain":
        case "none":
        case "unknown":
            return [];
        default:
            return [];
    }
}

function profileAllowsEmptyCell(profile: AresSuperWeaponAITargetingProfile): boolean {
    return profile.allowsEmptyCell || targetTokens(profile.requiredTarget).has("empty");
}

function finalAllowed(
    input: AresSuperWeaponPlannerInput,
    selected: SelectedTarget,
    enforceProfile = true,
): boolean {
    const point = selected.point;
    const cell = cellFor(input, point);
    const objects = unitsAt(input, point);
    if (selected.candidate && !candidateVisible(input, selected.candidate)) return false;
    if (selected.candidate && input.candidateFilter && !input.candidateFilter(selected.candidate)) return false;
    if (input.targetFilter && !input.targetFilter(point, selected.candidate)) return false;
    if (enforceProfile && !matchesAresSuperWeaponTarget(
        input.profile.requiredTarget,
        point,
        cell,
        objects,
    )) return false;
    if (enforceProfile && objects.length &&
        !objects.some((unit) => matchesAresSuperWeaponHouse(input.profile.requiredHouse, unit.houseRelation))) return false;
    if (input.requiresTarget !== undefined &&
        !matchesAresSuperWeaponTarget(input.requiresTarget, point, cell, objects)) return false;
    if (input.requiresHouse !== undefined && objects.length &&
        !objects.some((unit) => matchesAresSuperWeaponHouse(input.requiresHouse, unit.houseRelation))) return false;
    if (input.launchAllowed && !input.launchAllowed(point)) return false;
    if (input.activationAllowed && !input.activationAllowed(point)) return false;
    const fireIntoShroudAllowed = input.fireIntoShroudAllowed?.(point);
    if (fireIntoShroudAllowed === false) return false;
    return true;
}

export function planAresSuperWeaponTarget(
    input: AresSuperWeaponPlannerInput,
): AresSuperWeaponTargetPoint | undefined {
    if (!input.profile.supported) return undefined;
    const preferred = preferredPoint(input);
    if (preferred) {
        if (!constraintsAllow(input, undefined, true)) return undefined;
        return finalAllowed(input, { point: preferred }, false) ? preferred : undefined;
    }
    if (!constraintsAllow(input, undefined, false)) return undefined;

    const candidates = pointsForMode(input);
    for (const candidate of candidates) {
        if (!constraintsAllow(input, candidate.candidate, false)) continue;
        if (finalAllowed(input, candidate)) return candidate.point;
    }

    const canUseEmptyCellFallback = input.profile.mode !== "paradrop" ||
        input.extensionType?.toLocaleLowerCase("en-US") === "unitdelivery";
    if (profileAllowsEmptyCell(input.profile) &&
        canUseEmptyCellFallback &&
        input.profile.mode !== "hunter-seeker" &&
        !(input.profile.mode === "no-target" && input.extensionType?.toLocaleLowerCase("en-US") === "empulse")) {
        for (const cell of orderedCells(input)) {
            const candidate = { point: { x: cell.x, y: cell.y } };
            if (finalAllowed(input, candidate)) return candidate.point;
        }
    }
    return undefined;
}

export function collectAresSuperWeaponTargetCells(input: AresSuperWeaponPlannerInput): AresSuperWeaponTargetCell[] {
    return orderedCells(input);
}
