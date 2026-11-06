import { resolveAresSuperWeaponAITargeting, type AresSuperWeaponAITargetingProfile } from "@/extensions/ares/AresSuperWeaponAI";
import { getAresPreferredTargetingCell } from "@/extensions/ares/AresSuperWeaponTargetingCell";
import { ShroudType } from "@/game/map/MapShroud";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { ObjectType } from "@/engine/type/ObjectType";
import {
    planAresSuperWeaponTarget,
    type AresSuperWeaponPlannerInput,
    type AresSuperWeaponTargetCell,
    type AresSuperWeaponTargetPoint,
    type AresSuperWeaponTargetUnit,
} from "@/extensions/ares/AresSuperWeaponTargetPlanner";
import {
    isAresSuperWeaponActivationAllowed,
    isAresSuperWeaponFireIntoShroudAllowed,
} from "@/extensions/ares/AresSuperWeaponFilters";
import { isAresSuperWeaponLaunchAllowed } from "@/extensions/ares/AresSuperWeaponLaunch";
import { isAresEmpulseLaunchSite, isAresEmpulseLaunchSiteInRange } from "@/game/superweapon/EMPulseEffect";

export interface AresAutoFireCandidate {
    id?: string | number;
    x: number;
    y: number;
    targetKind: "infantry" | "units" | "buildings" | "aircraft";
    houseRelation: "owner" | "allies" | "enemies" | "neutral";
    isCloaked?: boolean;
    value?: number;
    score?: number;
    threat?: number;
    visible?: boolean;
    zone?: ZoneType;
    inLimbo?: boolean;
    isAirborne?: boolean;
}

export interface AresAutoFireHost {
    lightningStormActive(): boolean;
    psychicDominatorActive(): boolean;
    lowPower(): boolean | undefined;
    underAttack(): boolean | undefined;
}

export function resolveAresSuperWeaponTargetingProfile(
    rules: any,
): AresSuperWeaponAITargetingProfile {
    return resolveAresSuperWeaponAITargeting({
        ...(rules?.ares ?? {}),
        type: rules?.type,
        typeId: rules?.typeId,
        extensionType: rules?.ares?.extensionType ?? rules?.extensionType ?? rules?.ares?.typeId ?? rules?.typeId,
    });
}

export function resolveAresSuperWeaponAutoFireProfile(
    rules: any,
): AresSuperWeaponAITargetingProfile | undefined {
    const ares = rules?.ares;
    if (!ares || ares.swAutoFire !== true) return undefined;
    const profile = resolveAresSuperWeaponTargetingProfile(rules);
    return profile.supported ? profile : undefined;
}

export function isAresAutoFireAllowed(
    profile: AresSuperWeaponAITargetingProfile,
    player: any,
    host: AresAutoFireHost,
): boolean {
    for (const constraint of profile.constraints) {
        switch (constraint) {
            case "low-power":
                if (host.lowPower() !== true) return false;
                break;
            case "attacked":
                if (host.underAttack() !== true) return false;
                break;
            case "lightning-storm-inactive":
                if (host.lightningStormActive()) return false;
                break;
            case "dominator-inactive":
                if (host.psychicDominatorActive()) return false;
                break;
            case "offensive-cell-set":
                if (!getAresPreferredTargetingCell(player, "offensive")) return false;
                break;
            case "offensive-cell-clear":
                if (getAresPreferredTargetingCell(player, "offensive")) return false;
                break;
            case "defensive-cell-set":
                if (!getAresPreferredTargetingCell(player, "defensive")) return false;
                break;
            case "defensive-cell-clear":
                if (getAresPreferredTargetingCell(player, "defensive")) return false;
                break;
            default:
                break;
        }
    }
    return true;
}

function resolveRelation(world: any, player: any, owner: any): AresAutoFireCandidate["houseRelation"] {
    if (!owner || owner === player) return owner ? "owner" : "neutral";
    if (owner.isNeutral === true || owner.multiplayPassive === true) return "neutral";
    return world?.alliances?.areAllied?.(player, owner) === true ? "allies" : "enemies";
}

function compareObjectIds(first: any, second: any): number {
    const firstId = first?.id;
    const secondId = second?.id;
    const firstNumber = Number(firstId);
    const secondNumber = Number(secondId);
    if (firstId !== undefined && secondId !== undefined &&
        Number.isFinite(firstNumber) && Number.isFinite(secondNumber) && firstNumber !== secondNumber) {
        return firstNumber - secondNumber;
    }
    const firstKey = String(firstId ?? first?.name ?? "");
    const secondKey = String(secondId ?? second?.name ?? "");
    return firstKey.localeCompare(secondKey);
}

function getObjectTile(object: any): any {
    return object?.centerTile ?? object?.tile;
}

function getTargetKind(object: any): AresAutoFireCandidate["targetKind"] | undefined {
    return object?.isInfantry?.() || object?.rules?.type === ObjectType.Infantry
        ? "infantry"
        : object?.isBuilding?.() || object?.rules?.type === ObjectType.Building
            ? "buildings"
            : object?.isAircraft?.() || object?.rules?.type === ObjectType.Aircraft
                ? "aircraft"
                : object?.isUnit?.() || object?.rules?.type === ObjectType.Vehicle
                    ? "units"
                    : undefined;
}

function isObjectInLimbo(object: any): boolean {
    return object?.inLimbo === true || object?.limboData !== undefined || object?.isSpawned === false;
}

function isObjectAirborne(object: any): boolean {
    return object?.isAirborne === true || object?.airborne === true ||
        object?.isInAir === true || object?.isInAir?.() === true || object?.zone === ZoneType.Air;
}

function getObjectZone(world: any, object: any, tile: any): ZoneType | undefined {
    return object?.zone ?? worldZone(world, tile);
}

function isObjectVisible(world: any, player: any, object: any, tile: any): boolean {
    const shroud = world?.mapShroudTrait?.getPlayerShroud?.(player);
    if (!shroud || !tile) return true;
    if (typeof shroud.isShrouded === "function") return !shroud.isShrouded(tile);
    if (typeof shroud.getShroudType === "function") {
        return shroud.getShroudType(tile) !== ShroudType.Unexplored;
    }
    return true;
}

export function collectAresAutoFireCandidates(world: any, player: any): AresAutoFireCandidate[] {
    const objects = world?.world?.getAllObjects?.() ?? world?.getAllObjects?.() ?? [];
    const sorted = [...objects].sort(compareObjectIds);
    const candidates: AresAutoFireCandidate[] = [];
    for (const object of sorted) {
        if (!object || object.owner === player || object.isDestroyed) continue;
        const targetKind = getTargetKind(object);
        const tile = getObjectTile(object);
        if (!targetKind || !tile) continue;
        candidates.push({
            id: object.id,
            x: tile.rx,
            y: tile.ry,
            targetKind,
            houseRelation: resolveRelation(world, player, object.owner),
            isCloaked: object.cloakableTrait?.isCloaked?.() ?? object.isCloaked === true,
            value: object.rules?.threatPosed ?? object.rules?.threat ?? object.rules?.cost ?? object.maxHitPoints,
            score: object.rules?.threatPosed ?? object.rules?.threat ?? object.rules?.cost ?? object.maxHitPoints,
            threat: object.rules?.threatPosed ?? object.rules?.threat,
            visible: isObjectVisible(world, player, object, tile),
            zone: getObjectZone(world, object, tile),
            inLimbo: isObjectInLimbo(object),
            isAirborne: isObjectAirborne(object),
        });
    }
    return candidates.filter((candidate) => candidate.visible !== false);
}

export interface AresSuperWeaponWorldPlannerOptions {
    gateUnits?: readonly AresSuperWeaponTargetUnit[];
    underAttack?: boolean;
    lightningStormActive?: boolean;
    psychicDominatorActive?: boolean;
    candidateFilter?: (candidate: AresSuperWeaponTargetUnit) => boolean;
    targetFilter?: (target: AresSuperWeaponTargetPoint, candidate?: AresSuperWeaponTargetUnit) => boolean;
    launchAllowed?: (target: AresSuperWeaponTargetPoint) => boolean;
    activationAllowed?: (target: AresSuperWeaponTargetPoint) => boolean;
    fireIntoShroudAllowed?: (target: AresSuperWeaponTargetPoint) => boolean;
    randomInt?: (min: number, max: number) => number;
    randomCell?: () => AresSuperWeaponTargetPoint | undefined;
    selfTargets?: readonly AresSuperWeaponTargetPoint[];
    deliveryTargets?: readonly AresSuperWeaponTargetPoint[];
    dropPodTargets?: readonly AresSuperWeaponTargetPoint[];
    attackTargets?: readonly AresSuperWeaponTargetPoint[];
    forceShieldTargets?: readonly AresSuperWeaponTargetPoint[];
    enemyHouseExists?: boolean;
}

function worldObjects(world: any): any[] {
    return world?.world?.getAllObjects?.() ?? world?.getAllObjects?.() ?? [];
}

function worldTile(world: any, point: AresSuperWeaponTargetPoint): any {
    return world?.map?.tiles?.getByMapCoords?.(point.x, point.y) ?? { rx: point.x, ry: point.y };
}

function worldZone(world: any, tile: any): any {
    return world?.map?.getTileZone?.(tile);
}

function worldCellVisible(world: any, player: any, tile: any): boolean {
    const shroud = world?.mapShroudTrait?.getPlayerShroud?.(player);
    if (!shroud || !tile) return true;
    if (typeof shroud.isShrouded === "function") return !shroud.isShrouded(tile);
    if (typeof shroud.getShroudType === "function") {
        return shroud.getShroudType(tile) !== ShroudType.Unexplored;
    }
    return true;
}

function worldStartLocation(world: any, player: any): AresSuperWeaponTargetPoint | undefined {
    const direct = asPlannerPoint(player?.startLocation);
    if (direct) return direct;
    const index = player?.startLocation;
    const location = typeof index === "number" ? world?.map?.startingLocations?.[index] : undefined;
    return asPlannerPoint(location);
}

function asPlannerPoint(value: any): AresSuperWeaponTargetPoint | undefined {
    const point = value?.x !== undefined || value?.y !== undefined
        ? { x: Number(value.x), y: Number(value.y) }
        : { x: Number(value?.rx), y: Number(value?.ry) };
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
}

function worldEnemyBase(world: any, player: any): AresSuperWeaponTargetPoint | undefined {
    const combatants = world?.getCombatants?.() ?? [];
    const candidates = combatants
        .filter((candidate: any) => candidate && resolveRelation(world, player, candidate) === "enemies")
        .map((candidate: any) => ({ candidate, point: worldStartLocation(world, candidate) }))
        .filter((entry: any) => !!entry.point)
        .sort((first: any, second: any) =>
            String(first.candidate.name ?? first.candidate.id ?? "").localeCompare(
                String(second.candidate.name ?? second.candidate.id ?? "")));
    return candidates[0]?.point;
}

function worldCells(world: any, player: any): AresSuperWeaponTargetCell[] {
    const cells: AresSuperWeaponTargetCell[] = [];
    const all = world?.map?.tiles?.getAll?.();
    if (Array.isArray(all)) {
        for (const tile of all) {
            cells.push({
                x: tile.rx,
                y: tile.ry,
                zone: worldZone(world, tile),
                visible: worldCellVisible(world, player, tile),
            });
        }
        return cells.sort((first, second) => first.x - second.x || first.y - second.y);
    }
    const size = world?.map?.tiles?.getMapSize?.();
    if (size) {
        for (let y = 0; y < Number(size.height); y++) {
            for (let x = 0; x < Number(size.width); x++) {
                const tile = world?.map?.tiles?.getByMapCoords?.(x, y);
                if (tile) {
                    cells.push({ x, y, zone: worldZone(world, tile), visible: worldCellVisible(world, player, tile) });
                }
            }
        }
    }
    return cells.sort((first, second) => first.x - second.x || first.y - second.y);
}

function worldUnits(world: any, player: any): AresSuperWeaponTargetUnit[] {
    const objects = [...worldObjects(world)].sort(compareObjectIds);
    const units: AresSuperWeaponTargetUnit[] = [];
    for (const object of objects) {
        if (!object || object.isDestroyed) continue;
        const tile = getObjectTile(object);
        const targetKind = getTargetKind(object);
        if (!tile || !targetKind) continue;
        units.push({
            id: object.id,
            x: tile.rx,
            y: tile.ry,
            targetKind,
            houseRelation: resolveRelation(world, player, object.owner),
            isCloaked: object.cloakableTrait?.isCloaked?.() ?? object.isCloaked === true,
            value: object.rules?.threatPosed ?? object.rules?.threat ?? object.rules?.cost ?? object.maxHitPoints,
            score: object.rules?.threatPosed ?? object.rules?.threat ?? object.rules?.cost ?? object.maxHitPoints,
            threat: object.rules?.threatPosed ?? object.rules?.threat,
            visible: worldCellVisible(world, player, tile),
            zone: getObjectZone(world, object, tile),
            inLimbo: isObjectInLimbo(object),
            isAirborne: isObjectAirborne(object),
        });
    }
    return units;
}

function worldProviderTargets(world: any, player: any, rules: any): AresSuperWeaponTargetPoint[] {
    const expected = String(rules?.name ?? "").trim().toLocaleLowerCase("en-US");
    if (!expected) return [];
    const targets: AresSuperWeaponTargetPoint[] = [];
    for (const object of worldObjects(world)) {
        if (!object?.isBuilding?.() || object.owner !== player || object.isDestroyed) continue;
        const providers = [
            object.rules?.superWeapon,
            object.rules?.superWeapon2,
            ...(Array.isArray(object.rules?.superWeapons) ? object.rules.superWeapons : []),
            ...(object.superWeaponTraits ?? []).map((trait: any) => trait?.name),
        ].filter((value: any) => typeof value === "string")
            .map((value: string) => value.trim().toLocaleLowerCase("en-US"));
        const tile = getObjectTile(object);
        if (providers.includes(expected) && tile) targets.push({ x: tile.rx, y: tile.ry });
    }
    return targets.sort((first, second) => first.x - second.x || first.y - second.y);
}

const DROP_POD_RING_OFFSETS = [
    [-12, -12], [12, -12], [-12, 12], [12, 12],
    [0, -16], [16, 0], [0, 16], [-16, 0],
] as const;

function worldDropPodTargets(
    world: any,
    player: any,
    anchor: AresSuperWeaponTargetPoint | undefined,
): AresSuperWeaponTargetPoint[] {
    if (!anchor) return [];
    return DROP_POD_RING_OFFSETS
        .map(([dx, dy]) => worldOpenCells(world, player, { x: anchor.x + dx, y: anchor.y + dy })[0])
        .filter((point): point is AresSuperWeaponTargetPoint => !!point);
}

function worldOpenCells(
    world: any,
    player: any,
    anchor: AresSuperWeaponTargetPoint | undefined,
): AresSuperWeaponTargetPoint[] {
    const cells = worldCells(world, player);
    const occupied = new Set(worldUnits(world, player).map((unit) => `${unit.x},${unit.y}`));
    return cells
        .filter((cell) => cell.zone !== ZoneType.Water && !occupied.has(`${cell.x},${cell.y}`))
        .filter((cell) => !anchor || Math.abs(cell.x - anchor.x) + Math.abs(cell.y - anchor.y) <= 64)
        .sort((first, second) => {
            const firstDistance = anchor ? Math.abs(first.x - anchor.x) + Math.abs(first.y - anchor.y) : 0;
            const secondDistance = anchor ? Math.abs(second.x - anchor.x) + Math.abs(second.y - anchor.y) : 0;
            return firstDistance - secondDistance || first.x - second.x || first.y - second.y;
        })
        .map((cell) => ({ x: cell.x, y: cell.y }));
}

function worldEmpulseCandidateFilter(
    world: any,
    player: any,
    ares: any,
    configured?: (candidate: AresSuperWeaponTargetUnit) => boolean,
): ((candidate: AresSuperWeaponTargetUnit) => boolean) | undefined {
    if (String(ares?.extensionType ?? "").toLocaleLowerCase("en-US") !== "empulse") {
        return configured;
    }
    const sites = worldObjects(world).filter((object: any) =>
        object?.isBuilding?.() && object.owner === player &&
        isAresEmpulseLaunchSite(object, ares, { superWeapon: undefined }));
    return (candidate) => configured?.(candidate) !== false &&
        sites.some((site: any) => isAresEmpulseLaunchSiteInRange(
            site,
            { rx: candidate.x, ry: candidate.y },
            ares,
        ));
}

export function createAresSuperWeaponWorldPlannerInput(
    world: any,
    player: any,
    rules: any,
    options: AresSuperWeaponWorldPlannerOptions = {},
): AresSuperWeaponPlannerInput {
    const profile = resolveAresSuperWeaponTargetingProfile(rules);
    const ares = rules?.ares;
    const startLocation = worldStartLocation(world, player);
    const enemyBase = worldEnemyBase(world, player);
    const units = worldUnits(world, player);
    const enemyHouseExists = options.enemyHouseExists ?? (
        (world?.getCombatants?.() ?? []).some((candidate: any) =>
            candidate && resolveRelation(world, player, candidate) === "enemies") ||
        units.some((unit) => unit.visible !== false && unit.houseRelation === "enemies"));
    const preferredCells = {
        offensive: getAresPreferredTargetingCell(player, "offensive"),
        defensive: getAresPreferredTargetingCell(player, "defensive"),
    };
    const selfTargets = options.selfTargets ?? worldProviderTargets(world, player, rules);
    const deliveryTargets = options.deliveryTargets ?? worldOpenCells(world, player, enemyBase ?? startLocation);
    const dropPodTargets = options.dropPodTargets ?? worldDropPodTargets(world, player, startLocation);
    const launchAllowed = options.launchAllowed ?? (ares
        ? (target: AresSuperWeaponTargetPoint) => isAresSuperWeaponLaunchAllowed(
            { name: rules?.name, ...ares },
            player,
            worldTile(world, target),
            world,
        )
        : undefined);
    const activationAllowed = options.activationAllowed ?? (ares
        ? (target: AresSuperWeaponTargetPoint) => isAresSuperWeaponActivationAllowed(
            ares.swRequiresHouse,
            ares.swRequiresTarget,
            player,
            worldTile(world, target),
            world,
        )
        : undefined);
    const fireIntoShroudAllowed = options.fireIntoShroudAllowed ?? (ares
        ? (target: AresSuperWeaponTargetPoint) => isAresSuperWeaponFireIntoShroudAllowed(
            ares.swFireIntoShroud,
            player,
            worldTile(world, target),
            world,
        )
        : undefined);
    return {
        profile,
        units,
        gateUnits: options.gateUnits ?? units,
        cells: worldCells(world, player),
        preferredCells,
        underAttack: options.underAttack ?? (typeof player?.isUnderAttack === "function"
            ? player.isUnderAttack()
            : player?.isUnderAttack === true || player?.underAttack === true),
        lowPower: player?.powerTrait?.isLowPower?.() === true,
        lightningStormActive: options.lightningStormActive,
        psychicDominatorActive: options.psychicDominatorActive,
        startLocation,
        enemyBase,
        enemyHouseExists,
        selfTargets,
        deliveryTargets,
        dropPodTargets,
        attackTargets: options.attackTargets,
        forceShieldTargets: options.forceShieldTargets,
        extensionType: ares?.extensionType,
        requiresTarget: ares?.swRequiresTarget,
        requiresHouse: ares?.swRequiresHouse,
        candidateFilter: worldEmpulseCandidateFilter(world, player, ares, options.candidateFilter),
        targetFilter: options.targetFilter,
        launchAllowed,
        activationAllowed,
        fireIntoShroudAllowed,
        randomInt: options.randomInt,
        randomCell: options.randomCell,
    };
}

export function planAresSuperWeaponTargetFromWorld(
    world: any,
    player: any,
    rules: any,
    options: AresSuperWeaponWorldPlannerOptions = {},
): AresSuperWeaponTargetPoint | undefined {
    return planAresSuperWeaponTarget(createAresSuperWeaponWorldPlannerInput(world, player, rules, options));
}

export interface AresSuperWeaponSelectionOptions {
    units?: readonly AresSuperWeaponTargetUnit[];
    gateUnits?: readonly AresSuperWeaponTargetUnit[];
    cells?: readonly AresSuperWeaponTargetCell[];
    preferredCells?: Partial<Record<"offensive" | "defensive", AresSuperWeaponTargetPoint>>;
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
    underAttack?: boolean;
    lowPower?: boolean;
    lightningStormActive?: boolean;
    psychicDominatorActive?: boolean;
    enforceConstraints?: boolean;
}

export function selectAresSuperWeaponAutoFireTarget(
    profile: AresSuperWeaponAITargetingProfile,
    player: any,
    candidates: readonly AresAutoFireCandidate[],
    options: AresSuperWeaponSelectionOptions = {},
): AresSuperWeaponTargetPoint | undefined {
    const preferred = profile.preference === "offensive" || profile.preference === "defensive"
        ? options.preferredCells?.[profile.preference] ?? getAresPreferredTargetingCell(player, profile.preference)
        : undefined;
    const cells = [
        ...candidates.map((candidate) => ({
            x: candidate.x,
            y: candidate.y,
            zone: candidate.zone,
            visible: candidate.visible,
        })),
        ...(options.cells ?? []),
    ];
    const input: AresSuperWeaponPlannerInput = {
        profile,
        units: (options.units ?? candidates) as AresSuperWeaponTargetUnit[],
        gateUnits: options.gateUnits ?? (options.units ?? candidates) as AresSuperWeaponTargetUnit[],
        cells,
        preferredCells: {
            offensive: options.preferredCells?.offensive ?? getAresPreferredTargetingCell(player, "offensive"),
            defensive: options.preferredCells?.defensive ?? getAresPreferredTargetingCell(player, "defensive"),
        },
        startLocation: options.startLocation,
        ownBaseCenter: options.ownBaseCenter,
        enemyBase: options.enemyBase,
        enemyHouseExists: options.enemyHouseExists,
        selfTargets: options.selfTargets,
        attackTargets: options.attackTargets,
        deliveryTargets: options.deliveryTargets,
        dropPodTargets: options.dropPodTargets,
        forceShieldTargets: options.forceShieldTargets,
        extensionType: options.extensionType,
        requiresTarget: options.requiresTarget,
        requiresHouse: options.requiresHouse,
        candidateFilter: options.candidateFilter,
        targetFilter: options.targetFilter,
        launchAllowed: options.launchAllowed,
        activationAllowed: options.activationAllowed,
        fireIntoShroudAllowed: options.fireIntoShroudAllowed,
        randomInt: options.randomInt,
        randomCell: options.randomCell,
        underAttack: options.underAttack,
        lowPower: options.lowPower,
        lightningStormActive: options.lightningStormActive,
        psychicDominatorActive: options.psychicDominatorActive,
        enforceConstraints: options.enforceConstraints ?? true,
    };
    const selected = planAresSuperWeaponTarget(input);
    if (!selected) return undefined;
    if (preferred && selected.x === preferred.x && selected.y === preferred.y) return selected;
    return candidates.find((candidate) => candidate.x === selected.x && candidate.y === selected.y) ?? selected;
}

export {
    matchesAresSuperWeaponHouse,
    matchesAresSuperWeaponTarget,
    planAresSuperWeaponTarget,
} from "@/extensions/ares/AresSuperWeaponTargetPlanner";
export type {
    AresSuperWeaponPlannerInput,
    AresSuperWeaponTargetCell,
    AresSuperWeaponTargetPoint,
    AresSuperWeaponTargetUnit,
} from "@/extensions/ares/AresSuperWeaponTargetPlanner";
