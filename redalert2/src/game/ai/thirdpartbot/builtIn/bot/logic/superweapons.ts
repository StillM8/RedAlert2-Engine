import { GameApi, LandType, ObjectType, SuperWeaponStatus, SuperWeaponType, UnitData, Vector2 } from "../../game-api";
import { SupabotContext } from "./common/context";
import { MissionController } from "./mission/missionController";
import { AttackMission, AttackMissionState } from "./mission/missions/attackMission";
import { DefenceMission } from "./mission/missions/defenceMission";
import { DebugLogger } from "./common/utils";
import { EffectiveBotConfig } from "../../botProfiles";
import { resolveAresSuperWeaponAITargeting } from "@/extensions/ares/AresSuperWeaponAI";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

// How often the officer polls superweapon state.
const SW_CHECK_INTERVAL_TICKS = 75;

// Enemy units are bucketed into cells this wide when hunting for the juiciest
// blast centroid.
const CLUSTER_CELL_TILES = 8;

// Ready-to-fire delay by difficulty (deliberation time, in ticks).
// Retail fires on ready at every difficulty (RA1 Super_Weapon_Handler checks
// Is_Ready every frame; RA2's [IQ] keeps SW autofire on for all AIs) — the
// easy delay is our own mercy rule, kept deliberately.
const FIRE_DELAY_BY_DIFFICULTY: Record<string, number> = {
    easy: 1350,
    normal: 0,
    brutal: 0,
};

// Retail AISuperDefenseProbability=90,50,10: chance to answer an enemy
// superweapon launch with Force Shield, by difficulty.
const FORCE_SHIELD_PROBABILITY: Record<string, number> = {
    easy: 10,
    normal: 50,
    brutal: 90,
};

// Enemy superweapons worth shielding against (nuke, storm, dominator).
const MAJOR_OFFENSIVE_SW = new Set<number>([
    SuperWeaponType.MultiMissile,
    SuperWeaponType.LightningStorm,
    SuperWeaponType.PsychicDominator,
]);

// Retail AIIonCannon*Value building-category weights for offensive SW
// placement (rulesmd [General], TS Ion Cannon lineage): production and tech
// structures are the prize, defenses are not.
function retailCategoryWeight(rules: any, isBuilding: boolean, difficultyId: string): number {
    if (!isBuilding) {
        return 0; // mobile units fall back to cost-based scoring
    }
    if (rules.constructionYard) {
        return 100;
    }
    if (rules.factory !== undefined && rules.factory !== 0) {
        return 100;
    }
    if ((rules.power ?? 0) > 0) {
        return difficultyId === "brutal" ? 60 : 100;
    }
    if (rules.isBaseDefense) {
        return 35;
    }
    return 50;
}

interface Cluster {
    score: number;
    x: number;
    y: number;
    count: number;
    infantry: number;
}

function superWeaponIndex(superWeapon: { index?: unknown; type?: unknown }): number {
    const index = Number(superWeapon.index);
    return Number.isFinite(index) ? index : Number(superWeapon.type);
}

/**
 * Fires the bot's superweapons like a retail AI would: nukes and storms on
 * the enemy's most valuable cluster, iron curtain on our own armored push,
 * paradrops into the fight, recon powers on cooldown. All target picks are
 * deterministic (sorted iteration, no PRNG) — bots run in lockstep.
 */
export class SuperweaponOfficer {
    private lastCheckAt = 0;
    /** SW type -> tick we first saw it Ready (for the deliberation delay). */
    private readySince = new Map<number, number>();
    /** Enemy major superweapons currently Ready ("player:type"), to detect launches. */
    private enemyReadySw = new Set<string>();

    constructor(private config: EffectiveBotConfig) {}

    public onAiUpdate(context: SupabotContext, missionController: MissionController, logger: DebugLogger): void {
        const { game, player, matchAwareness } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < this.lastCheckAt + SW_CHECK_INTERVAL_TICKS) {
            return;
        }
        this.lastCheckAt = currentTick;

        let allSw: any[];
        try {
            allSw = (game as any).getAllSuperWeaponData?.() ?? [];
        } catch (err) {
            return;
        }
        // Anti-superweapon watch (retail AISuperDefenseProbability): when an
        // enemy nuke/storm/dominator LAUNCHES (Ready -> not Ready), roll to
        // answer with Force Shield on our densest base cluster.
        this.watchEnemyLaunches(context, allSw, logger);

        const mySw = allSw.filter((sw) => sw.playerName === player.name);
        if (mySw.length === 0) {
            this.readySince.clear();
            return;
        }

        // Prune deliberation timers for weapons we no longer own (sold or
        // destroyed while Ready) — else a rebuilt weapon skips its delay.
        const ownedTypes = new Set(mySw.map((sw) => superWeaponIndex(sw)));
        for (const type of [...this.readySince.keys()]) {
            if (!ownedTypes.has(type)) {
                this.readySince.delete(type);
            }
        }

        const fireDelay = FIRE_DELAY_BY_DIFFICULTY[this.config.difficultyId] ?? 450;

        for (const sw of mySw) {
            const type = superWeaponIndex(sw);
            if (Number(sw.status) !== SuperWeaponStatus.Ready) {
                this.readySince.delete(type);
                continue;
            }
            if (!this.readySince.has(type)) {
                this.readySince.set(type, currentTick);
            }
            if (currentTick < this.readySince.get(type)! + fireDelay) {
                continue;
            }
            if (this.tryFire(context, missionController, type, logger, sw)) {
                this.readySince.delete(type);
            }
        }
    }

    private tryFire(
        context: SupabotContext,
        missionController: MissionController,
        type: number,
        logger: DebugLogger,
        superWeaponData?: any,
    ): boolean {
        const { game, player, matchAwareness } = context;
        const playerData = game.getPlayerData(player.name);

        const aresResult = this.tryFireWithAresTargeting(
            context,
            missionController,
            type,
            logger,
            superWeaponData,
        );
        if (aresResult !== undefined) {
            return aresResult;
        }

        switch (type) {
            case SuperWeaponType.MultiMissile:
            case SuperWeaponType.LightningStorm:
            case SuperWeaponType.PsychicDominator: {
                const cluster = this.bestEnemyCluster(game, playerData.name, false);
                if (!cluster) {
                    return false;
                }
                logger(`Firing superweapon ${type} at enemy cluster (${cluster.x},${cluster.y}) worth ${Math.round(cluster.score)}`);
                player.actions.activateSuperWeapon(type, { rx: cluster.x, ry: cluster.y });
                return true;
            }
            case SuperWeaponType.GeneticConverter: {
                // Mutator turns infantry into Brutes for US: aim at infantry.
                const cluster = this.bestEnemyCluster(game, playerData.name, true) ?? this.bestEnemyCluster(game, playerData.name, false);
                if (!cluster) {
                    return false;
                }
                logger(`Firing genetic mutator at (${cluster.x},${cluster.y})`);
                player.actions.activateSuperWeapon(type, { rx: cluster.x, ry: cluster.y });
                return true;
            }
            case SuperWeaponType.IronCurtain: {
                // Shield our biggest armored push as it engages.
                const target = this.findArmoredPushCenter(game, missionController, 3);
                if (!target) {
                    return false;
                }
                logger(`Iron curtain on our push at (${target.x},${target.y})`);
                player.actions.activateSuperWeapon(type, { rx: target.x, ry: target.y });
                return true;
            }
            case SuperWeaponType.ForceShield: {
                // Primary use is answering enemy superweapon launches (see
                // watchEnemyLaunches). Fallback: base under heavy attack, but
                // gated by the same retail probability so easy bots rarely
                // burn it on a tank poke.
                const underAttack = missionController
                    .getMissions()
                    .some((m) => m instanceof DefenceMission && m.getPriority() > 0);
                if (!underAttack) {
                    return false;
                }
                const probability = FORCE_SHIELD_PROBABILITY[this.config.difficultyId] ?? 50;
                if (game.generateRandomInt(0, 99) >= probability) {
                    return false;
                }
                const conyard = game
                    .getVisibleUnits(player.name, "self", (r) => r.constructionYard)
                    .map((id) => game.getUnitData(id))
                    .find((u) => !!u);
                if (!conyard) {
                    return false;
                }
                logger(`Force shield on our conyard`);
                player.actions.activateSuperWeapon(type, { rx: conyard.tile.rx, ry: conyard.tile.ry });
                return true;
            }
            case SuperWeaponType.PsychicReveal:
            case SuperWeaponType.SpyPlane: {
                // Recon the strongest enemy's base; effectively free.
                const enemy = this.firstEnemy(game, playerData.name);
                if (!enemy) {
                    return false;
                }
                player.actions.activateSuperWeapon(type, {
                    rx: enemy.startLocation.x,
                    ry: enemy.startLocation.y,
                });
                return true;
            }
            case SuperWeaponType.ParaDrop:
            case SuperWeaponType.AmerParaDrop: {
                // Drop into our ongoing push, or defensively at the rally point.
                const pushCenter = this.findArmoredPushCenter(game, missionController, 1);
                const target = pushCenter ?? matchAwareness.getMainRallyPoint();
                if (!target) {
                    return false;
                }
                logger(`Paradrop at (${target.x},${target.y})`);
                player.actions.activateSuperWeapon(type, { rx: Math.round(target.x), ry: Math.round(target.y) });
                return true;
            }
            case SuperWeaponType.ChronoSphere: {
                // Teleport our armored push right onto its target. Requires a
                // vehicle-heavy squad (organics die in transit) and a safe
                // landing tile (water sinks vehicles).
                const push = this.findChronoCandidate(game, missionController);
                if (!push) {
                    return false;
                }
                const dest = this.findLandingTile(game, push.destination);
                if (!dest) {
                    return false;
                }
                logger(`Chronoshifting push from (${push.source.x},${push.source.y}) to (${dest.x},${dest.y})`);
                player.actions.activateSuperWeapon(
                    type,
                    { rx: push.source.x, ry: push.source.y },
                    { rx: dest.x, ry: dest.y },
                );
                return true;
            }
            default:
                // ChronoWarp (GUI alias) and anything unknown: never fire.
                return false;
        }
    }

    /**
     * Routes custom Ares types and explicitly configured vanilla types through
     * the documented SW.AITargeting mode. The target heuristics remain in the
     * host AI, while mode defaults/empty-cell semantics come from the shared
     * Ares normalized definition.
     */
    private tryFireWithAresTargeting(
        context: SupabotContext,
        missionController: MissionController,
        type: number,
        logger: DebugLogger,
        superWeaponData?: any,
    ): boolean | undefined {
        const ares = superWeaponData?.ares;
        if (!ares?.extensionType && !ares?.swAITargeting) {
            return undefined;
        }

        const profile = resolveAresSuperWeaponAITargeting({
            ...ares,
            type: superWeaponData?.type,
            typeId: superWeaponData?.typeId,
        });
        if (!profile.supported) {
            logger(`Ares superweapon ${superWeaponData?.name ?? type} has unsupported SW.AITargeting=${profile.rawMode ?? ""}`);
            return false;
        }

        const { game, player, matchAwareness } = context;
        const playerData = game.getPlayerData(player.name);
        const underAttack = missionController
            .getMissions()
            .some((mission) => mission instanceof DefenceMission && mission.getPriority() > 0);
        // These two constraints are directly observable in the standalone
        // host. Preferred-cell and active-effect constraints need corresponding
        // state in the shared AI API and remain diagnostics-only for now.
        if (profile.constraints.includes("low-power") && !playerData.power.isLowPower) {
            return false;
        }
        if (profile.constraints.includes("attacked") && !underAttack) {
            return false;
        }
        const requiredTarget = (unit: UnitData): boolean =>
            this.matchesAresAITarget(unit, profile.requiredTarget);
        let target: any;
        switch (profile.mode) {
            case "nuke":
            case "lightning-storm":
            case "psychic-dominator":
            case "offensive":
                target = this.bestEnemyCluster(game, playerData.name, false, requiredTarget);
                break;
            case "genetic-mutator":
                target = this.bestEnemyCluster(game, playerData.name, true, requiredTarget);
                break;
            case "stealth":
                target = this.bestEnemyCluster(game, playerData.name, false, (unit) =>
                    !!unit.isCloaked && requiredTarget(unit));
                break;
            case "paradrop":
            case "drop-pod":
                target = this.findArmoredPushCenter(game, missionController, 1) ??
                    matchAwareness.getMainRallyPoint() ??
                    this.firstEnemy(game, playerData.name)?.startLocation;
                break;
            case "force-shield":
                target = this.bestOwnBuildingCluster(game, playerData.name);
                break;
            case "iron-curtain":
                target = this.findArmoredPushCenter(game, missionController, 3) ??
                    this.bestOwnBuildingCluster(game, playerData.name);
                break;
            case "self": {
                const provider = game
                    .getVisibleUnits(player.name, "self", (rules: any) => rules.superWeapon === superWeaponData?.name)
                    .map((id) => game.getUnitData(id))
                    .find((unit) => !!unit);
                target = provider?.tile;
                break;
            }
            case "base":
                target = this.bestOwnBuildingCluster(game, playerData.name);
                break;
            case "enemy-base":
                target = this.firstEnemy(game, playerData.name)?.startLocation;
                break;
            case "no-target":
            case "hunter-seeker":
            case "attack":
            case "low-power":
            case "low-power-attack":
            case "lightning-random":
                target = matchAwareness.getMainRallyPoint() ?? playerData.startLocation;
                break;
            case "none":
                return false;
            case "multi-missile":
                target = this.bestEnemyCluster(game, playerData.name, false, requiredTarget);
                break;
            case "unknown":
                return false;
        }

        if (!target && profile.allowsEmptyCell) {
            target = playerData.startLocation ?? { x: 0, y: 0 };
        }
        if (!target) {
            return false;
        }

        const rx = Number(target.rx ?? target.x);
        const ry = Number(target.ry ?? target.y);
        if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
            return false;
        }
        logger(`Firing Ares superweapon ${superWeaponData?.name ?? type} at (${Math.round(rx)},${Math.round(ry)}) using ${profile.mode}`);
        player.actions.activateSuperWeapon(type, { rx: Math.round(rx), ry: Math.round(ry) });
        return true;
    }

    /**
     * Applies the content-mask portion of Antares' GetPotentialAITargets /
     * CanFireAt logic to the data exposed to the host bot. Cell-only masks
     * (land/water) cannot reject an empty centroid here, so the activation
     * path remains the final authority for those masks.
     */
    private matchesAresAITarget(unit: UnitData, requiredTarget: string): boolean {
        const targets = new Set(requiredTarget
            .split(",")
            .map((token) => token.trim().toLocaleLowerCase("en-US"))
            .filter(Boolean));
        if (!targets.size || targets.has("none") || targets.has("all")) {
            return true;
        }

        const typeTargets = ["infantry", "units", "buildings"].filter((target) => targets.has(target));
        if (typeTargets.length > 0) {
            const unitType = unit.type as any;
            const matchesType = (targets.has("buildings") && unitType === ObjectType.Building) ||
                (targets.has("infantry") && unitType === ObjectType.Infantry) ||
                (targets.has("units") && (unitType === ObjectType.Vehicle || unitType === ObjectType.Aircraft));
            if (!matchesType) return false;
        }

        if (targets.has("water") && unit.zone !== undefined && unit.zone !== ZoneType.Water) {
            return false;
        }
        if (targets.has("land") && unit.zone === ZoneType.Water) {
            return false;
        }
        return true;
    }

    /**
     * Detect enemy major-SW launches (Ready -> gone) and roll the retail
     * AISuperDefenseProbability {brutal 90 / normal 50 / easy 10} to raise
     * Force Shield over our densest base cluster. The launch target isn't
     * exposed to bots, so shielding our highest-value cluster is the honest
     * approximation.
     */
    private watchEnemyLaunches(
        context: SupabotContext,
        allSw: { playerName: string; index?: number; type: any; status: any }[],
        logger: DebugLogger,
    ): void {
        const { game, player } = context;
        const currentReady = new Set<string>();
        for (const sw of allSw) {
            const type = superWeaponIndex(sw);
            if (sw.playerName === player.name || !MAJOR_OFFENSIVE_SW.has(type)) {
                continue;
            }
            if (game.areAlliedPlayers(player.name, sw.playerName)) {
                continue;
            }
            if (Number(sw.status) === SuperWeaponStatus.Ready) {
                currentReady.add(`${sw.playerName}:${type}`);
            }
        }
        let launchDetected = false;
        for (const key of this.enemyReadySw) {
            if (!currentReady.has(key)) {
                launchDetected = true;
                break;
            }
        }
        this.enemyReadySw = currentReady;
        if (!launchDetected) {
            return;
        }

        const shield = allSw.find(
            (sw) =>
                sw.playerName === player.name &&
                superWeaponIndex(sw) === SuperWeaponType.ForceShield &&
                Number(sw.status) === SuperWeaponStatus.Ready,
        );
        if (!shield) {
            return;
        }
        const probability = FORCE_SHIELD_PROBABILITY[this.config.difficultyId] ?? 50;
        if (game.generateRandomInt(0, 99) >= probability) {
            logger(`Enemy superweapon launch detected — force shield held (roll failed).`);
            return;
        }
        const cluster = this.bestOwnBuildingCluster(game, player.name);
        if (!cluster) {
            return;
        }
        logger(`Enemy superweapon launch detected — raising force shield at (${cluster.x},${cluster.y})!`);
        player.actions.activateSuperWeapon(SuperWeaponType.ForceShield, { rx: cluster.x, ry: cluster.y });
        this.readySince.delete(SuperWeaponType.ForceShield);
    }

    /** Our densest building cluster by value (what the enemy would nuke). */
    private bestOwnBuildingCluster(game: GameApi, playerName: string): Cluster | null {
        const buckets = new Map<number, Cluster>();
        for (const id of game.getVisibleUnits(playerName, "self", (r) => true)) {
            const unit = game.getUnitData(id);
            if (!unit || (unit.type as any) !== ObjectType.Building) {
                continue;
            }
            const cx = Math.floor(unit.tile.rx / CLUSTER_CELL_TILES);
            const cy = Math.floor(unit.tile.ry / CLUSTER_CELL_TILES);
            const key = cx * 10000 + cy;
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { score: 0, x: 0, y: 0, count: 0, infantry: 0 };
                buckets.set(key, bucket);
            }
            bucket.score += ((unit.rules as any).cost ?? unit.maxHitPoints);
            bucket.x += unit.tile.rx;
            bucket.y += unit.tile.ry;
            bucket.count++;
        }
        let best: Cluster | null = null;
        const keys = [...buckets.keys()].sort((a, b) => a - b);
        for (const key of keys) {
            const bucket = buckets.get(key)!;
            if (!best || bucket.score > best.score) {
                best = bucket;
            }
        }
        if (!best || best.count === 0) {
            return null;
        }
        return { ...best, x: Math.round(best.x / best.count), y: Math.round(best.y / best.count) };
    }

    /** Densest enemy cluster by unit value; infantryOnly counts infantry bodies. */
    private bestEnemyCluster(
        game: GameApi,
        playerName: string,
        infantryOnly: boolean,
        extraFilter?: (unit: UnitData) => boolean,
    ): Cluster | null {
        const enemyIds = game.getVisibleUnits(playerName, "enemy");
        const buckets = new Map<number, Cluster>();
        for (const id of enemyIds) {
            const unit = game.getUnitData(id);
            if (!unit) {
                continue;
            }
            if (extraFilter && !extraFilter(unit)) {
                continue;
            }
            const isInfantry = (unit.type as any) === ObjectType.Infantry;
            if (infantryOnly && !isInfantry) {
                continue;
            }
            const cx = Math.floor(unit.tile.rx / CLUSTER_CELL_TILES);
            const cy = Math.floor(unit.tile.ry / CLUSTER_CELL_TILES);
            const key = cx * 10000 + cy;
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { score: 0, x: 0, y: 0, count: 0, infantry: 0 };
                buckets.set(key, bucket);
            }
            const rules: any = unit.rules;
            const isBuilding = (unit.type as any) === ObjectType.Building;
            // Retail category table dominates for structures; mobile blobs
            // still count by cost so an army with no visible base is a target.
            const categoryWeight = retailCategoryWeight(rules, isBuilding, this.config.difficultyId);
            const value = infantryOnly
                ? 100
                : isBuilding
                  ? (rules.cost ?? unit.maxHitPoints) * (categoryWeight / 50)
                  : (rules.cost ?? unit.maxHitPoints);
            bucket.score += value;
            bucket.x += unit.tile.rx;
            bucket.y += unit.tile.ry;
            bucket.count++;
            if (isInfantry) {
                bucket.infantry++;
            }
        }
        let best: Cluster | null = null;
        // Sorted iteration keeps the pick deterministic across clients.
        const keys = [...buckets.keys()].sort((a, b) => a - b);
        for (const key of keys) {
            const bucket = buckets.get(key)!;
            if (infantryOnly && bucket.infantry < 3) {
                continue;
            }
            if (!best || bucket.score > best.score) {
                best = bucket;
            }
        }
        if (!best || best.count === 0) {
            return null;
        }
        return {
            ...best,
            x: Math.round(best.x / best.count),
            y: Math.round(best.y / best.count),
        };
    }

    /** Center of our biggest currently-attacking squad with >= minVehicles vehicles. */
    private findArmoredPushCenter(
        game: GameApi,
        missionController: MissionController,
        minVehicles: number,
    ): Vector2 | null {
        let best: { center: Vector2; vehicles: number } | null = null;
        for (const mission of missionController.getMissions()) {
            if (!(mission instanceof AttackMission) || mission.getState() !== AttackMissionState.Attacking) {
                continue;
            }
            const center = mission.getCenterOfMass();
            if (!center) {
                continue;
            }
            const vehicles = mission
                .getUnitIds()
                .map((id) => game.getUnitData(id))
                .filter((u) => u && (u.type as any) === ObjectType.Vehicle).length;
            if (vehicles >= minVehicles && (!best || vehicles > best.vehicles)) {
                best = { center, vehicles };
            }
        }
        return best ? new Vector2(Math.round(best.center.x), Math.round(best.center.y)) : null;
    }

    private findChronoCandidate(
        game: GameApi,
        missionController: MissionController,
    ): { source: Vector2; destination: Vector2 } | null {
        for (const mission of missionController.getMissions()) {
            if (!(mission instanceof AttackMission) || mission.getState() !== AttackMissionState.Attacking) {
                continue;
            }
            const center = mission.getCenterOfMass();
            const target = mission.getAttackArea();
            if (!center || !target) {
                continue;
            }
            const units = mission.getUnitIds().map((id) => game.getUnitData(id)).filter((u): u is UnitData => !!u);
            const vehicles = units.filter((u) => (u.type as any) === ObjectType.Vehicle).length;
            // Majority-vehicle squads only: chrono kills organic passengers.
            if (vehicles >= 4 && vehicles * 2 >= units.length && center.distanceTo(target) > 20) {
                return {
                    source: new Vector2(Math.round(center.x), Math.round(center.y)),
                    destination: target,
                };
            }
        }
        return null;
    }

    /** A clear-ground tile near `near` that vehicles survive landing on. */
    private findLandingTile(game: GameApi, near: Vector2): Vector2 | null {
        const offsets = [
            [0, 0], [3, 0], [-3, 0], [0, 3], [0, -3],
            [5, 5], [-5, 5], [5, -5], [-5, -5],
        ];
        for (const [dx, dy] of offsets) {
            const x = Math.round(near.x + dx);
            const y = Math.round(near.y + dy);
            const tile = game.mapApi.getTile(x, y);
            if (!tile) {
                continue;
            }
            const landType = (tile as any).landType;
            if (landType === LandType.Clear || landType === LandType.Road) {
                return new Vector2(x, y);
            }
        }
        return null;
    }

    /** The scariest surviving enemy: most assets on the board (deterministic). */
    private firstEnemy(game: GameApi, playerName: string) {
        const enemies = game
            .getPlayers()
            .filter((name) => name !== playerName && !game.areAlliedPlayers(playerName, name))
            .map((name) => game.getPlayerData(name))
            .filter((p) => p.isCombatant);
        let best: any = null;
        let bestScore = -1;
        for (const enemy of enemies) {
            let score = 0;
            try {
                score = game.getVisibleUnits(enemy.name, "self").length;
            } catch (err) {
                score = 0;
            }
            if (score > bestScore) {
                bestScore = score;
                best = enemy;
            }
        }
        return best;
    }
}
