import { GameApi, LandType, ObjectType, SuperWeaponStatus, SuperWeaponType, UnitData, Vector2 } from "../../game-api";
import { SupabotContext } from "./common/context";
import { MissionController } from "./mission/missionController";
import { AttackMission, AttackMissionState } from "./mission/missions/attackMission";
import { DefenceMission } from "./mission/missions/defenceMission";
import { DebugLogger } from "./common/utils";
import { EffectiveBotConfig } from "../../botProfiles";
import {
    normalizeAresSuperWeaponAIHouse,
    resolveAresSuperWeaponAITargeting,
} from "@/extensions/ares/AresSuperWeaponAI";
import { isAresSuperWeaponLaunchAllowed } from "@/extensions/ares/AresSuperWeaponLaunch";
import { selectAresEmpulseLaunchSites } from "@/game/superweapon/EMPulseEffect";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { hasAresSuperWeaponProvider } from "@/extensions/ares/AresSuperWeaponProviders";

// How often the officer polls superweapon state.
const SW_CHECK_INTERVAL_TICKS = 75;

// Enemy units are bucketed into cells this wide when hunting for the juiciest
// blast centroid.
const CLUSTER_CELL_TILES = 8;

// Ares' ParaDrop-style AI looks for a usable 5x5 landing area.  The bot does
// not own the full engine placement solver, so it searches a deterministic
// five-cell neighborhood and leaves final placement legality to the action
// processor.
const DELIVERY_AREA_RADIUS = 2;
const DROP_POD_RING_OFFSETS = [
    [-12, -12], [12, -12], [-12, 12], [12, 12],
    [0, -16], [16, 0], [0, 16], [-16, 0],
] as const;

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
    target?: UnitData;
}

type ClusterScoring = "ion" | "threat";

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
        if (!ares) {
            return undefined;
        }
        // AutoFire also uses the Ares AI targeter even when UseAITargeting is
        // absent. Keep ordinary vanilla entries on their existing path.
        if (!ares.extensionType && !ares.swAITargeting &&
            ares.swUseAITargeting !== true && ares.swAutoFire !== true) {
            return undefined;
        }

        // Firestorm changes the owner's wall state and has no target cell.
        // Keep it out of the generic cell-targeting path even if a malformed
        // or future ruleset supplies an explicit AI mode.
        if (String(ares.extensionType ?? "").toLocaleLowerCase("en-US") === "firestorm") {
            return false;
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
        if (profile.constraints.includes("low-power") && !playerData.power.isLowPower) {
            return false;
        }
        if (profile.constraints.includes("attacked") && !underAttack) {
            return false;
        }
        if (profile.constraints.includes("lightning-storm-inactive") &&
            (game as any).isSuperWeaponEffectActive?.(SuperWeaponType.LightningStorm) === true) {
            return false;
        }
        if (profile.constraints.includes("dominator-inactive") &&
            (game as any).isSuperWeaponEffectActive?.(SuperWeaponType.PsychicDominator) === true) {
            return false;
        }
        // Map actions 135/140 are optional in the bot API. A supplied host
        // state is honored; without it, *_Cell_Set cannot fire and
        // *_Cell_Clear is satisfied because no preferred cell is known.
        const preferredCell = (kind: "offensive" | "defensive"): any =>
            (game as any).getAresSuperWeaponTargetingCell?.(playerData.name, kind);
        for (const constraint of profile.constraints) {
            if (constraint === "offensive-cell-set" && !preferredCell("offensive")) return false;
            if (constraint === "offensive-cell-clear" && preferredCell("offensive")) return false;
            if (constraint === "defensive-cell-set" && !preferredCell("defensive")) return false;
            if (constraint === "defensive-cell-clear" && preferredCell("defensive")) return false;
        }
        const requiredTarget = (unit: UnitData): boolean =>
            this.matchesAresAITarget(game, unit, profile.requiredTarget);
        const nonCloakedRequiredTarget = (unit: UnitData): boolean =>
            !unit.isCloaked && requiredTarget(unit);
        const extension = String(ares.extensionType ?? "").toLocaleLowerCase("en-US");
        const launchTargetAllowed = this.createAresLaunchTargetFilter(
            game,
            playerData.name,
            ares,
            superWeaponData,
        );
        const clusterLaunchFilter = (cluster: Cluster): boolean =>
            !launchTargetAllowed || launchTargetAllowed({ rx: cluster.x, ry: cluster.y });
        let target: any;
        // Map actions 135/140 establish an Ares preferred target. Preference
        // overrides the ordinary selector whenever that cell is set; this is
        // intentionally resolved before content clustering because the
        // preferred cell may be empty or outside the visible-object list.
        if (profile.preference === "offensive" || profile.preference === "defensive") {
            target = preferredCell(profile.preference);
        }
        if (!target) {
            switch (profile.mode) {
                case "nuke":
                case "lightning-storm":
                case "psychic-dominator":
                case "offensive":
                    target = extension === "empulse"
                        ? this.bestEnemyCluster(
                            game,
                            playerData.name,
                            false,
                            profile.mode === "offensive" ? requiredTarget : nonCloakedRequiredTarget,
                            (cluster) => this.hasEmpulseCannonInRange(game, playerData.name, ares, cluster) &&
                                clusterLaunchFilter(cluster),
                            profile.requiredHouse,
                        )
                        : this.bestEnemyCluster(
                            game,
                            playerData.name,
                            false,
                            profile.mode === "offensive" ? requiredTarget : nonCloakedRequiredTarget,
                            clusterLaunchFilter,
                            profile.requiredHouse,
                        );
                    break;
                case "genetic-mutator":
                    target = this.bestEnemyCluster(
                        game,
                        playerData.name,
                        true,
                        requiredTarget,
                        clusterLaunchFilter,
                        profile.requiredHouse,
                    );
                    break;
                case "stealth":
                    target = this.bestEnemyCluster(
                        game,
                        playerData.name,
                        false,
                        (unit) => !!unit.isCloaked && requiredTarget(unit),
                        clusterLaunchFilter,
                        profile.requiredHouse,
                    );
                    break;
                case "paradrop":
                    target = extension === "unitdelivery"
                        ? this.findUnitDeliveryTarget(game, playerData.name, matchAwareness)
                        : this.findArmoredPushCenter(game, missionController, 1) ??
                          matchAwareness.getMainRallyPoint() ??
                          this.firstEnemy(game, playerData.name)?.startLocation;
                    break;
                case "drop-pod":
                    target = extension === "droppod"
                        ? this.findDropPodTarget(game, playerData.name)
                        : this.findArmoredPushCenter(game, missionController, 1) ??
                          matchAwareness.getMainRallyPoint() ??
                          this.firstEnemy(game, playerData.name)?.startLocation;
                    break;
                case "force-shield":
                    // ForceShield responds to the last AIDefendAgainst launch;
                    // watchEnemyLaunches owns that response path. It must not
                    // spend a ready charge merely because the officer polled it.
                    return false;
                case "iron-curtain":
                    // Ares waits for a team-script Iron Curtain request instead of
                    // auto-firing this mode.
                    return false;
                case "self": {
                    const provider = game
                        .getVisibleUnits(player.name, "self", (rules: any) =>
                            hasAresSuperWeaponProvider(rules) &&
                            [rules.superWeapon, rules.superWeapon2, ...(rules.superWeapons ?? [])]
                                .filter(Boolean)
                                .some((provider: string) => provider.toLocaleLowerCase("en-US") ===
                                    String(superWeaponData?.name ?? "").toLocaleLowerCase("en-US")))
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
                    target = extension === "empulse" && ares.empulseTargetSelf === true
                        ? this.findEmpulseCannonCell(game, playerData.name, ares)
                        : playerData.startLocation;
                    break;
                case "hunter-seeker":
                    // The handler ignores the click cell, but Ares only lets this
                    // mode fire after the house has selected a favorite enemy.
                    if (!this.firstEnemy(game, playerData.name) ||
                        game.getVisibleUnits(playerData.name, "enemy").length === 0) {
                        return false;
                    }
                    target = playerData.startLocation;
                    break;
                case "attack":
                    target = matchAwareness.getMainRallyPoint() ?? playerData.startLocation;
                    break;
                case "low-power":
                case "low-power-attack":
                    target = playerData.startLocation;
                    break;
                case "lightning-random":
                    target = this.findRandomMapCell(game);
                    break;
                case "none":
                    return false;
                case "multi-missile":
                    target = this.bestEnemyCluster(
                        game,
                        playerData.name,
                        false,
                        nonCloakedRequiredTarget,
                        clusterLaunchFilter,
                        profile.requiredHouse,
                        "threat",
                    );
                    break;
                case "unknown":
                    return false;
            }
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
        if (launchTargetAllowed && !launchTargetAllowed({ rx, ry })) {
            return false;
        }
        logger(`Firing Ares superweapon ${superWeaponData?.name ?? type} at (${Math.round(rx)},${Math.round(ry)}) using ${profile.mode}`);
        player.actions.activateSuperWeapon(type, { rx: Math.round(rx), ry: Math.round(ry) });
        return true;
    }

    /**
     * Reuse the simulation launch gate while the bot is choosing a target.
     * The public bot API exposes immutable UnitData, so this creates a small
     * adapter only for Ares weapons that actually author range, designator,
     * or inhibitor restrictions. Unrestricted weapons take the undefined
     * fast path and retain the ordinary AI cost.
     */
    private createAresLaunchTargetFilter(
        game: GameApi,
        playerName: string,
        ares: any,
        superWeaponData?: any,
    ): ((target: { rx: number; ry: number }) => boolean) | undefined {
        const restricted = [
            ares.swRangeMinimum,
            ares.swRangeMaximum,
            ...(ares.swDesignators ?? []),
            ...(ares.swInhibitors ?? []),
        ].some((value: any) => Number.isFinite(value) ||
            (typeof value === "string" && value.trim().length > 0)) ||
            ares.swAnyDesignator === true ||
            ares.swAnyInhibitor === true;
        if (!restricted) return undefined;

        const ids = typeof (game as any).getAllUnits === "function"
            ? (game as any).getAllUnits()
            : ["self", "allied", "enemy"].flatMap((relation) =>
                game.getVisibleUnits(playerName, relation as any));
        const uniqueIds = [...new Set(ids)];
        const data = uniqueIds
            .map((id) => game.getUnitData(id))
            .filter((unit): unit is UnitData => !!unit);
        const ownerRefs = new Map<string, any>();
        const objects: any[] = [];
        const ownerRef = (name: string): any => {
            let owner = ownerRefs.get(name);
            if (owner) return owner;
            owner = {
                name,
                id: name,
                getOwnedObjects: () => objects.filter((object) => object.owner === owner),
                getOwnedObjectsByType: (type: ObjectType) => objects
                    .filter((object) => object.owner === owner && object.type === type),
                powerTrait: {
                    isLowPower: () => {
                        try {
                            return game.getPlayerData(name).power.isLowPower;
                        }
                        catch {
                            return false;
                        }
                    },
                },
            };
            ownerRefs.set(name, owner);
            return owner;
        };
        for (const unit of data) {
            const owner = ownerRef(unit.owner);
            const type = unit.type as any;
            objects.push({
                ...unit,
                owner,
                centerTile: unit.tile,
                rules: { ...unit.rules, type, name: unit.rules?.name ?? unit.name },
                healthTrait: { health: unit.hitPoints },
                poweredTrait: type === ObjectType.Building
                    ? { isPoweredOn: () => unit.isPoweredOn !== false }
                    : undefined,
                isTechno: () => true,
                isBuilding: () => type === ObjectType.Building,
                isInfantry: () => type === ObjectType.Infantry,
                isVehicle: () => type === ObjectType.Vehicle,
                isAircraft: () => type === ObjectType.Aircraft,
                isUnit: () => type !== ObjectType.Building,
                isSpawned: true,
                isDestroyed: false,
                isDisposed: false,
                isCrashing: false,
            });
        }
        const owner = ownerRef(playerName);
        const world = {
            alliances: {
                areAllied: (first: any, second: any) => {
                    if (first === second || first?.name === second?.name) return true;
                    try {
                        return game.areAlliedPlayers(first?.name, second?.name);
                    }
                    catch {
                        return false;
                    }
                },
            },
            getWorld: () => ({ getAllObjects: () => objects }),
        };
        const rules = { ...ares, name: superWeaponData?.name ?? ares.name };
        return (target) => isAresSuperWeaponLaunchAllowed(rules, owner, target, world);
    }

    /** Deterministic project-RNG cell selection for Ares LightningRandom. */
    private findRandomMapCell(game: GameApi): Vector2 | null {
        const size = (game.mapApi as any).getRealMapSize?.();
        const width = Number(size?.width ?? size?.x);
        const height = Number(size?.height ?? size?.y);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            return null;
        }
        const x = game.generateRandomInt(0, Math.max(0, Math.floor(width) - 1));
        const y = game.generateRandomInt(0, Math.max(0, Math.floor(height) - 1));
        return game.mapApi.getTile(x, y) ? new Vector2(x, y) : null;
    }

    /**
     * Applies the content-mask portion of Antares' GetPotentialAITargets /
     * CanFireAt logic to the data exposed to the host bot. Cell-only masks
     * (land/water) cannot reject an empty centroid here, so the activation
     * path remains the final authority for those masks.
     */
    private matchesAresAITarget(game: GameApi, unit: UnitData, requiredTarget: string): boolean {
        const targets = new Set(requiredTarget
            .split(",")
            .map((token) => token.trim().toLocaleLowerCase("en-US"))
            .filter(Boolean));
        if (!targets.size || targets.has("none") || targets.has("all")) {
            return true;
        }

        const tile = game.mapApi.getTile(unit.tile.rx, unit.tile.ry);
        const zone = tile && typeof (game.mapApi as any).getTileZone === "function"
            ? (game.mapApi as any).getTileZone(tile)
            : unit.zone;
        if (targets.has("water") && zone !== ZoneType.Water) {
            return false;
        }
        if (targets.has("land") && zone !== undefined && zone !== ZoneType.Ground) {
            return false;
        }

        const typeTargets = ["infantry", "units", "buildings"].filter((target) => targets.has(target));
        // An occupied candidate can never satisfy an empty-only AI mask. A
        // future cell sampler can handle empty-cell targeting directly.
        if (targets.has("empty") && typeTargets.length === 0) {
            return false;
        }
        if (!typeTargets.length) {
            return true;
        }

        const unitType = unit.type as any;
        return (targets.has("buildings") && unitType === ObjectType.Building) ||
            (targets.has("infantry") && unitType === ObjectType.Infantry) ||
            (targets.has("units") && (unitType === ObjectType.Vehicle || unitType === ObjectType.Aircraft));
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
        clusterFilter?: (cluster: Cluster) => boolean,
        requiredHouse?: string,
        scoring: ClusterScoring = "ion",
    ): Cluster | null {
        const enemyIds = this.getAresHouseUnitIds(game, playerName, requiredHouse);
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
            const value = scoring === "threat"
                ? (unit.isCloaked
                    ? game.generateRandomInt(0, 100)
                    : Number(rules.threatPosed ?? rules.threat ?? rules.cost ?? unit.maxHitPoints))
                : infantryOnly
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
            if (!bucket.target || value > this.clusterTargetScore(bucket.target, scoring)) {
                bucket.target = unit;
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
            const candidate = {
                ...bucket,
                // Keep the candidate on a real eligible object. This lets
                // range checks and AIRequiresTarget evaluate the same cell
                // that will be sent to the activation action.
                x: bucket.target?.tile.rx ?? Math.round(bucket.x / bucket.count),
                y: bucket.target?.tile.ry ?? Math.round(bucket.y / bucket.count),
            };
            if (clusterFilter && !clusterFilter(candidate)) {
                continue;
            }
            if (!best || candidate.score > best.score) {
                best = candidate;
            }
        }
        if (!best || best.count === 0) {
            return null;
        }
        return {
            ...best,
            x: best.target?.tile.rx ?? best.x,
            y: best.target?.tile.ry ?? best.y,
        };
    }

    private clusterTargetScore(unit: UnitData, scoring: ClusterScoring): number {
        if (scoring === "threat") {
            return Number(unit.rules.threatPosed ?? unit.rules.threat ?? unit.rules.cost ?? unit.maxHitPoints);
        }
        return Number(unit.rules.cost ?? unit.maxHitPoints);
    }

    /** Maps Ares' AI-required house relation onto the standalone bot API. */
    private getAresHouseUnitIds(game: GameApi, playerName: string, rawHouse?: string): any[] {
        const house = normalizeAresSuperWeaponAIHouse(rawHouse);
        if (house === "none" || house === "unknown") {
            return [];
        }
        const relations = house === "owner"
            ? ["self"]
            : house === "allies" || house === "team"
              ? ["allied"]
              : house === "all"
                ? ["self", "allied", "enemy"]
                : ["enemy"];
        const ids = relations.flatMap((relation) => game.getVisibleUnits(playerName, relation as any));
        return [...new Set(ids)].sort((a, b) => String(a).localeCompare(String(b)));
    }

    /**
     * Ares UnitDelivery uses the ParaDrop targeter by default, but delivery
     * is not an attack centroid: it needs a free landing area near the
     * favorite enemy base.  The action/runtime placement code remains the
     * final authority for exact object footprints.
     */
    private findUnitDeliveryTarget(
        game: GameApi,
        playerName: string,
        matchAwareness: SupabotContext["matchAwareness"],
    ): Vector2 | null {
        const anchor = this.firstEnemy(game, playerName)?.startLocation ??
            matchAwareness.getMainRallyPoint() ??
            game.getPlayerData(playerName).startLocation;
        return anchor ? this.findBestDeliveryArea(game, anchor) : null;
    }

    /** DropPod's default is a land cell in an outer sector around own base. */
    private findDropPodTarget(game: GameApi, playerName: string): Vector2 | null {
        const anchor = game.getPlayerData(playerName).startLocation;
        if (!anchor) return null;
        const randomIndex = typeof (game as any).generateRandomInt === "function"
            ? (game as any).generateRandomInt(0, DROP_POD_RING_OFFSETS.length - 1)
            : 0;
        for (let i = 0; i < DROP_POD_RING_OFFSETS.length; i++) {
            const offset = DROP_POD_RING_OFFSETS[(randomIndex + i) % DROP_POD_RING_OFFSETS.length];
            const sector = new Vector2(anchor.x + offset[0], anchor.y + offset[1]);
            const target = this.findBestDeliveryArea(game, sector);
            if (target) return target;
        }
        return this.findBestDeliveryArea(game, anchor);
    }

    private findBestDeliveryArea(game: GameApi, anchor: { x: number; y: number }): Vector2 | null {
        let best: { score: number; x: number; y: number } | null = null;
        for (let dy = -DELIVERY_AREA_RADIUS; dy <= DELIVERY_AREA_RADIUS; dy++) {
            for (let dx = -DELIVERY_AREA_RADIUS; dx <= DELIVERY_AREA_RADIUS; dx++) {
                const x = Math.round(anchor.x + dx);
                const y = Math.round(anchor.y + dy);
                const tile = game.mapApi.getTile(x, y);
                if (!tile || !this.isDeliveryLand(tile)) continue;

                let occupied = 0;
                for (let ay = -DELIVERY_AREA_RADIUS; ay <= DELIVERY_AREA_RADIUS; ay++) {
                    for (let ax = -DELIVERY_AREA_RADIUS; ax <= DELIVERY_AREA_RADIUS; ax++) {
                        const areaTile = game.mapApi.getTile(x + ax, y + ay);
                        if (!areaTile) {
                            occupied += 25;
                            continue;
                        }
                        occupied += this.objectsOnDeliveryTile(game, areaTile).length;
                    }
                }
                // Prefer an actually empty area, then the closest stable
                // candidate.  Coordinates provide deterministic tie breaks.
                const distance = dx * dx + dy * dy;
                const score = occupied * 10000 + distance * 100 + y * 2 + x;
                if (!best || score < best.score) {
                    best = { score, x, y };
                }
            }
        }
        return best ? new Vector2(best.x, best.y) : null;
    }

    private objectsOnDeliveryTile(game: GameApi, tile: any): any[] {
        try {
            return typeof game.mapApi.getObjectsOnTile === "function"
                ? game.mapApi.getObjectsOnTile(tile) ?? []
                : [];
        } catch (err) {
            return [];
        }
    }

    private isDeliveryLand(tile: any): boolean {
        const landType = tile.landType ?? tile.onBridgeLandType;
        return landType === undefined || (
            landType !== LandType.Water &&
            landType !== LandType.Wall &&
            landType !== LandType.Cliff
        );
    }

    private empulseCannonRulesMatch(rules: any, ares: any): boolean {
        const configured = Array.isArray(ares?.empulseCannons)
            ? ares.empulseCannons.map((name: string) => name.toLocaleLowerCase("en-US"))
            : [];
        if (configured.length > 0) {
            return configured.includes(String(rules?.name ?? "").toLocaleLowerCase("en-US"));
        }
        return rules?.empulseCannon === true;
    }

    private getEmpulseCannons(game: GameApi, playerName: string, ares: any): UnitData[] {
        return game
            .getVisibleUnits(playerName, "self", (rules: any) => this.empulseCannonRulesMatch(rules, ares))
            .map((id) => game.getUnitData(id))
            .filter((unit): unit is UnitData => !!unit);
    }

    private findEmpulseCannonCell(game: GameApi, playerName: string, ares: any): Vector2 | null {
        const cannon = selectAresEmpulseLaunchSites(
            this.toAresEmpulseBuildings(game, playerName, ares),
            { ...ares, extensionType: "EMPulse", empulseTargetSelf: true },
            { rx: 0, ry: 0 },
        )[0];
        return cannon?.tile ? new Vector2(cannon.tile.rx, cannon.tile.ry) : null;
    }

    private toAresEmpulseBuildings(game: GameApi, playerName: string, ares: any): any[] {
        const playerData = game.getPlayerData(playerName);
        return this.getEmpulseCannons(game, playerName, ares).map((cannon) => ({
            id: cannon.id,
            name: cannon.name,
            tile: cannon.tile,
            hitPoints: cannon.hitPoints,
            rules: cannon.rules,
            isPoweredOn: cannon.isPoweredOn,
            poweredTrait: { isPoweredOn: () => cannon.isPoweredOn !== false },
            owner: { powerTrait: { isLowPower: () => playerData.power.isLowPower } },
            primaryWeapon: cannon.primaryWeapon
                ? {
                    rules: {
                        minimumRange: cannon.primaryWeapon.minRange ?? cannon.primaryWeapon.rules?.minimumRange,
                        range: cannon.primaryWeapon.maxRange ?? cannon.primaryWeapon.rules?.range,
                    },
                }
                : undefined,
        }));
    }

    private hasEmpulseCannonInRange(
        game: GameApi,
        playerName: string,
        ares: any,
        target: Cluster,
    ): boolean {
        return selectAresEmpulseLaunchSites(
            this.toAresEmpulseBuildings(game, playerName, ares),
            ares,
            { rx: target.x, ry: target.y },
            { superWeapon: undefined },
        ).length > 0;
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
