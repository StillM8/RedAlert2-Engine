import { FactoryType, GameApi, ObjectType, PlayerData, UnitData, Vector2 } from "../../../../game-api";
import { CombatSquad } from "./squads/combatSquad";
import { Mission, MissionAction, disbandMission, noop, requestUnits } from "../mission";
import { MatchAwareness } from "../../awareness";
import { MissionController } from "../missionController";
import { RetreatMission } from "./retreatMission";
import { DebugLogger, isOwnedByNeutral, maxBy } from "../../common/utils";
import { manageMoveMicro } from "./squads/common";
import { MissionContext, SupabotContext } from "../../common/context";
import { UnitComposition } from "../../../strategy/strategy";
import { SideComposition } from "../../../strategy/compositionUtils";
import { AiTriggerDatabase, AiTriggerEntry, TargetIntent } from "../../ai-ini/aiTriggerDb";
import { EffectiveBotConfig, TargetPreference } from "../../../../botProfiles";
import { isTriggerMasked } from "../../../strategy/doctrines";
import type { AttackLane } from "./squads/combatSquad";

export enum AttackFailReason {
    NoTargets = "NoTargets",
    DefenceTooStrong = "DefenceTooStrong",
    UnableToAcquireUnits = "UnableToAcquireUnits",
    OutOfUnits = "OutOfUnits",
    // The squad judged the fight lost and broke off (see CombatSquad).
    Repelled = "Repelled",
}

export enum AttackMissionState {
    Preparing = 0,
    Attacking = 1,
    Retreating = 2,
}

const NO_TARGET_RETARGET_TICKS = 300;
const NO_TARGET_IDLE_TIMEOUT_TICKS = 600;

// Ongoing attacks top up with fresh units at this cadence/priority. Priority
// sits BELOW the preparing ramp's starting value (1), so an assembling squad
// always outbids reinforcement for contested units and never donates its own.
const REINFORCE_INTERVAL_TICKS = 150;
const REINFORCE_PRIORITY = 0.75;

const ATTACK_MISSION_PRIORITY_RAMP = 1.01;
const ATTACK_MISSION_MAX_PRIORITY = 50;
// While preparing the squad, how many ticks to wait before dropping one unit from the desired squad size. If the squad size drops below the minimum, the attack mission is aborted.
const REQUESTED_UNIT_COUNT_DECAY_TICKS = 120;

/**
 * A mission that tries to attack a certain area.
 */
export class AttackMission extends Mission<AttackFailReason> {
    private squad: CombatSquad;

    private lastTargetSeenAt = 0;
    private hasPickedNewTarget: boolean = false;

    private state: AttackMissionState = AttackMissionState.Preparing;
    private requestedUnitCount: number;
    private lastRequestedUnitCountDecayAt: number | null = null;
    private preparingSinceTick: number | null = null;
    private lastReinforceRequestAt = 0;

    constructor(
        uniqueName: string,
        private priority: number,
        rallyArea: Vector2,
        private attackArea: Vector2,
        private radius: number,
        private composition: SideComposition,
        logger: DebugLogger,
        // Launch with a partial squad after this long assembling; retail teams
        // don't wait forever for the perfect roster and neither should we.
        private launchTimeoutTicks: number = 1350,
        // The team's retail-script hunting preference (harvesters, factories...).
        private targetIntent: TargetIntent = null,
        // Approach lane (Generals-style Center/Flank/Backdoor pathing).
        lane: AttackLane = "center",
        // Called once, on the Preparing -> Attacking transition.
        private onLaunch?: () => void,
    ) {
        super(uniqueName, logger);
        this.squad = new CombatSquad(rallyArea, attackArea, radius, true, lane);
        this.requestedUnitCount = composition.maximumUnits;
    }

    private launch(currentTick: number): void {
        this.priority = ATTACK_MISSION_INITIAL_PRIORITY;
        this.state = AttackMissionState.Attacking;
        // Start the no-target clock AT LAUNCH. It defaulted to 0, so any squad
        // launching after tick NO_TARGET_IDLE_TIMEOUT_TICKS toward an objective
        // with no currently-visible hostiles (an unexplored start location by
        // construction, or a target that moved while we assembled) satisfied
        // the disband test on its very first Attacking update and dissolved
        // before moving a single tile — the "bots turtle" symptom.
        this.lastTargetSeenAt = currentTick;
        this.onLaunch?.();
    }

    _onAiUpdate(context: MissionContext): MissionAction {
        switch (this.state) {
            case AttackMissionState.Preparing:
                return this.handlePreparingState(context);
            case AttackMissionState.Attacking:
                return this.handleAttackingState(context);
            case AttackMissionState.Retreating:
                return this.handleRetreatingState(context);
        }
    }

    private handlePreparingState(context: MissionContext) {
        const { game } = context;
        const currentTick = game.getCurrentTick();
        if (this.preparingSinceTick === null) {
            this.preparingSinceTick = currentTick;
        }

        const timedOut = currentTick > this.preparingSinceTick + this.launchTimeoutTicks;
        const currentUnits = this.getUnitIds().length;
        const partialLaunchFloor = Math.max(2, Math.ceil(this.composition.minimumUnits * 0.5));

        if (timedOut) {
            if (currentUnits >= partialLaunchFloor) {
                this.logger(`Attack ${this.getUniqueName()} launching after timeout with ${currentUnits} units.`);
                this.launch(currentTick);
                return noop();
            }
            return disbandMission(AttackFailReason.UnableToAcquireUnits);
        }

        this.decayDesiredCompositionIfNeeded(game);
        if (this.requestedUnitCount < this.composition.minimumUnits) {
            if (currentUnits >= partialLaunchFloor) {
                this.logger(`Attack ${this.getUniqueName()} launching with partial squad (${currentUnits}).`);
                this.launch(currentTick);
                return noop();
            }
            return disbandMission(AttackFailReason.UnableToAcquireUnits);
        }

        const desiredComposition = this.getDesiredComposition();
        const missingUnits = this.getMissingUnits(game, desiredComposition);
        if (missingUnits.length > 0) {
            this.priority = Math.min(this.priority * ATTACK_MISSION_PRIORITY_RAMP, ATTACK_MISSION_MAX_PRIORITY);
            // distribute the priority among the amount of missing units of each type
            const totalMissingUnits = missingUnits.reduce((sum, [, numMissing]) => sum + numMissing, 0);
            const unitPriorities = Object.fromEntries(
                missingUnits.map(([unitName, numMissing]) => [
                    unitName,
                    (this.priority * numMissing) / totalMissingUnits,
                ]),
            );
            return requestUnits(unitPriorities);
        } else {
            this.launch(currentTick);
            return noop();
        }
    }

    private handleAttackingState(context: MissionContext) {
        const { game, matchAwareness, actionBatcher } = context;
        const playerData = game.getPlayerData(context.player.name);
        if (this.getUnitIds().length === 0) {
            // TODO: disband directly (we no longer retreat when losing)
            this.state = AttackMissionState.Retreating;
            return noop();
        }

        const foundTargets = matchAwareness
            .getHostilesNearPoint2d(this.attackArea, this.radius)
            .map((unit) => game.getUnitData(unit.unitId))
            .filter((unit): unit is UnitData => !!unit && !isOwnedByNeutral(unit));

        const update = this.squad.onAiUpdate(context, this, this.logger);

        if (update.type !== "noop") {
            return update;
        }

        if (foundTargets.length > 0) {
            this.lastTargetSeenAt = game.getCurrentTick();
            this.hasPickedNewTarget = false;
        } else if (game.getCurrentTick() > this.lastTargetSeenAt + NO_TARGET_IDLE_TIMEOUT_TICKS) {
            return disbandMission(AttackFailReason.NoTargets);
        } else if (
            !this.hasPickedNewTarget &&
            game.getCurrentTick() > this.lastTargetSeenAt + NO_TARGET_RETARGET_TICKS
        ) {
            const newTarget = generateTarget(game, playerData, matchAwareness, false, "any", this.targetIntent);
            if (newTarget) {
                // Keep the mission's own record in sync — the superweapon
                // officer reads getAttackArea() for chronoshift destinations.
                this.attackArea = newTarget;
                this.squad.setAttackArea(newTarget);
                this.hasPickedNewTarget = true;
            }
        }

        // Reinforcement stream: fresh production keeps flowing to an ongoing
        // push instead of pooling at home. Low priority so it never starves a
        // still-assembling squad.
        if (
            game.getCurrentTick() > this.lastReinforceRequestAt + REINFORCE_INTERVAL_TICKS &&
            this.getUnitIds().length < this.composition.maximumUnits
        ) {
            this.lastReinforceRequestAt = game.getCurrentTick();
            const desiredComposition = this.getDesiredComposition();
            const missingUnits = this.getMissingUnits(game, desiredComposition);
            if (missingUnits.length > 0) {
                const unitPriorities = Object.fromEntries(
                    missingUnits.map(([unitName]) => [unitName, REINFORCE_PRIORITY]),
                );
                return requestUnits(unitPriorities);
            }
        }

        return noop();
    }

    private handleRetreatingState(context: MissionContext) {
        const { game, actionBatcher, matchAwareness } = context;
        this.getUnits(game).forEach((unitId) => {
            const action = manageMoveMicro(unitId, matchAwareness.getMainRallyPoint());
            if (action) {
                actionBatcher.push(action);
            }
        });
        // Note: probably should just disband rather than have a retreating state
        return disbandMission(AttackFailReason.OutOfUnits);
    }

    public getGlobalDebugText(): string | undefined {
        return this.squad.getGlobalDebugText() ?? "<none>";
    }

    public getState() {
        return this.state;
    }

    public getAttackArea(): Vector2 {
        return this.attackArea;
    }

    // This mission can give up its units while preparing.
    public isUnitsLocked(): boolean {
        return this.state !== AttackMissionState.Preparing;
    }

    public getPriority() {
        return this.priority;
    }

    private decayDesiredCompositionIfNeeded(game: GameApi): void {
        const currentTick = game.getCurrentTick();
        if (this.lastRequestedUnitCountDecayAt === null) {
            this.lastRequestedUnitCountDecayAt = currentTick;
            return;
        }

        if (currentTick <= this.lastRequestedUnitCountDecayAt + REQUESTED_UNIT_COUNT_DECAY_TICKS) {
            return;
        }

        this.lastRequestedUnitCountDecayAt = currentTick;
        this.requestedUnitCount--;
    }

    private getDesiredComposition(): UnitComposition {
        const compositionWeights = this.composition.composition;
        const totalWeights = Object.values(compositionWeights).reduce((a, b) => a + b, 0);
        if (totalWeights <= 0) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(compositionWeights).map(([unitName, weight]) => [
                unitName,
                Math.round((weight * this.requestedUnitCount) / totalWeights),
            ]),
        );
    }
}

// Calculates the weight for initiating an attack on the position of a unit or building.
// This is separate from unit micro; the squad will be ordered to attack in the vicinity of the point.
const getTargetWeight: (unitData: UnitData, tryFocusHarvester: boolean) => number = (unitData, tryFocusHarvester) => {
    if (tryFocusHarvester && unitData.rules.harvester) {
        return 100000;
    } else if (unitData.type as any === ObjectType.Building) {
        return unitData.maxHitPoints * 10;
    } else {
        return unitData.maxHitPoints;
    }
};

/** Does this unit match the retail script's hunting intent? */
function matchesIntent(unit: UnitData, intent: TargetIntent): boolean {
    const rules: any = unit.rules;
    switch (intent) {
        case "harvesters":
            return !!rules.harvester || !!rules.refinery;
        case "buildings":
            return (unit.type as any) === ObjectType.Building;
        case "defenses":
            return !!rules.isBaseDefense;
        case "factories":
            return rules.factory !== undefined && rules.factory !== FactoryType.None;
        case "power":
            return (unit.type as any) === ObjectType.Building && (rules.power ?? 0) > 0;
        case "infantry":
            return (unit.type as any) === ObjectType.Infantry;
        case "vehicles":
            return (unit.type as any) === ObjectType.Vehicle;
        default:
            return false;
    }
}

function generateTarget(
    gameApi: GameApi,
    playerData: PlayerData,
    matchAwareness: MatchAwareness,
    includeBaseLocations: boolean = false,
    targetPreference: TargetPreference = "any",
    targetIntent: TargetIntent = null,
    focusEnemyName: string | null = null,
): Vector2 | null {
    // Randomly decide between harvester and base.
    try {
        const harvesterBias = targetPreference === "harvester" ? 3 : 1;
        const tryFocusHarvester = gameApi.generateRandomInt(0, 1 + harvesterBias) > 1 - harvesterBias;
        // getVisibleUnits("enemy") already filters to combatant owners, and
        // target scoring only needs the lightweight object data — the old
        // per-unit getUnitData + getPlayerData pair allocated hundreds of
        // objects per call.
        let enemyUnits = gameApi
            .getVisibleUnits(playerData.name, "enemy")
            .map((unitId) => gameApi.getGameObjectData(unitId))
            .filter((u): u is UnitData => !!u) as UnitData[];
        // FFA: concentrate on the focus enemy when we can see them.
        if (focusEnemyName) {
            const focused = enemyUnits.filter((u) => u.owner === focusEnemyName);
            if (focused.length > 0) {
                enemyUnits = focused;
            }
        }

        const weighted = (u: UnitData) => {
            let weight = getTargetWeight(u, tryFocusHarvester);
            // The team's retail script says what it hunts: strongly prefer it.
            if (targetIntent && targetIntent !== "anything" && matchesIntent(u, targetIntent)) {
                weight = weight * 4;
            }
            if (targetPreference === "weakest") {
                // Prefer targets with few defenders around them.
                const defenders = matchAwareness.getHostilesNearPoint(u.tile.rx, u.tile.ry, 8).length;
                weight = weight / (1 + defenders);
            }
            return weight;
        };

        const maxUnit = maxBy(enemyUnits, weighted);
        if (maxUnit) {
            return new Vector2(maxUnit.tile.rx, maxUnit.tile.ry);
        }
        if (includeBaseLocations) {
            const mapApi = gameApi.mapApi;
            const enemyPlayers = gameApi
                .getPlayers()
                .map((p) => gameApi.getPlayerData(p))
                // getPlayers() still contains defeated players and observers. A
                // dead player's corner never gets explored, so it stays an
                // eligible "unexplored enemy base" forever and the bot marches
                // wave after wave at nothing.
                .filter((otherPlayer) => otherPlayer.isCombatant && otherPlayer.name !== playerData.name)
                .filter((otherPlayer) => !gameApi.areAlliedPlayers(playerData.name, otherPlayer.name));

            const unexploredEnemyLocations = enemyPlayers.filter((otherPlayer) => {
                const tile = mapApi.getTile(otherPlayer.startLocation.x, otherPlayer.startLocation.y);
                if (!tile) {
                    return false;
                }
                return !mapApi.isVisibleTile(tile, playerData.name);
            });
            if (unexploredEnemyLocations.length > 0) {
                const idx = gameApi.generateRandomInt(0, unexploredEnemyLocations.length - 1);
                return unexploredEnemyLocations[idx].startLocation;
            }
        }
    } catch (err) {
        // There's a crash here when accessing a building that got destroyed. Will catch and ignore or now.
        return null;
    }
    return null;
}

// Launch-to-launch gate per difficulty. Retail TeamDelays are 2000/2500/3500
// ticks (hard/normal/easy) — we keep the retail RATIO (1 : 1.25 : 1.75) at a
// faster absolute pace so the Generals-style relentless cadence survives.
// Personality multipliers layer on top.
const LAUNCH_GATE_BY_DIFFICULTY: Record<string, number> = {
    brutal: 600,
    normal: 750,
    easy: 1050,
};

// Number of ticks between attacking "bases" (enemy starting locations).
const BASE_ATTACK_COOLDOWN_TICKS = 600;

// Retail AIHateDelays: ticks before the AI picks its first enemy.
const HATE_DELAY_BY_DIFFICULTY: Record<string, number> = {
    brutal: 30,
    normal: 50,
    easy: 70,
};
// How long a grudge (someone attacked our base) locks the focus.
const GRUDGE_HOLD_TICKS = 900;
const FOCUS_REVIEW_INTERVAL_TICKS = 450;

const ATTACK_MISSION_INITIAL_PRIORITY = 1;

// Ticks per second at the base game speed, for profile delay conversion.
const TICKS_PER_SECOND = 15;

export class AttackMissionFactory {
    private readonly visibleTargetCooldownTicks: number;
    private readonly baseAttackCooldownTicks: number;
    private readonly firstAttackAllowedTick: number;
    private readonly maxPreparing: number;
    private readonly launchTimeoutTicks: number;
    private readonly targetPreference: TargetPreference;
    private lastAttackAt: number;
    // Generals-style cadence: the cooldown gates LAUNCHES, not assembly — a
    // new team starts building the moment the previous one ships, so there is
    // never a quiet period.
    private lastLaunchAt: number;
    // Escalation ladder: increments per launched attack; caps team cost early
    // so openings are probes and the late game is combined-arms deathballs.
    private waveIndex: number;
    private readonly maxWaveIndex: number;
    // FFA focus: which enemy this bot is currently hunting.
    private focusEnemyName: string | null = null;
    private lastFocusPickAt = -100000;
    // While open (after repelling an enemy attack), cooldowns are waived and
    // one extra squad may assemble: hit them while they're weak.
    private counterattackUntilTick = 0;

    constructor(
        private config?: EffectiveBotConfig,
        private triggerDb?: AiTriggerDatabase | null,
    ) {
        // Difficulty sets the base gate (retail TeamDelays ratio); the
        // personality multiplier shapes tempo on top — no double-dipping.
        const cooldownMultiplier = config?.attackCooldownMultiplier ?? 1;
        const launchGate = LAUNCH_GATE_BY_DIFFICULTY[config?.difficultyId ?? "normal"] ?? 750;
        // Hard 100s ceiling between wave launches: easy x turtle
        // (1050 x 1.7 = 1785 ticks) was the only combo above it and read
        // as "the AI stopped attacking" mid-game.
        this.visibleTargetCooldownTicks = Math.min(1500, Math.round(launchGate * cooldownMultiplier));
        this.baseAttackCooldownTicks = Math.round(BASE_ATTACK_COOLDOWN_TICKS * cooldownMultiplier);
        this.firstAttackAllowedTick = (config?.firstAttackDelaySeconds ?? 0) * TICKS_PER_SECOND;
        this.maxPreparing = config?.maxPreparingAttacks ?? 2;
        this.launchTimeoutTicks = config?.attackLaunchTimeoutTicks ?? 1350;
        this.targetPreference = config?.targetPreference ?? "any";
        this.lastAttackAt = -this.visibleTargetCooldownTicks;
        this.lastLaunchAt = -this.visibleTargetCooldownTicks;
        // Brutal starts a wave up and escalates without limit; easy never
        // leaves the probe waves.
        const difficulty = config?.difficultyId ?? "normal";
        // waveCostCeiling() saturates to Infinity at wave >= 4, so maxWaveIndex
        // 4 and 99 were the SAME clamp. Cap each difficulty inside a distinct
        // tier: easy stays on probes (<=2500), normal tops out mid-tier
        // (<=6000), only brutal reaches the uncapped tier.
        this.waveIndex = difficulty === "brutal" ? 1 : 0;
        this.maxWaveIndex = difficulty === "easy" ? 1 : difficulty === "normal" ? 3 : 99;
    }

    /** Wave ladder cost ceiling for the current escalation index. */
    private waveCostCeiling(): number {
        const wave = Math.min(this.waveIndex, this.maxWaveIndex);
        if (wave <= 1) return 2500;
        if (wave <= 3) return 6000;
        return Number.POSITIVE_INFINITY;
    }

    /** Personality-flavored approach lane roll. */
    private rollLane(game: GameApi): AttackLane {
        const sneaky = this.config?.personalityId === "harasser" || this.config?.personalityId === "opportunist";
        const roll = game.generateRandomInt(0, 99);
        if (sneaky) {
            return roll < 25 ? "center" : roll < 65 ? "flank" : "backdoor";
        }
        return roll < 50 ? "center" : roll < 80 ? "flank" : "backdoor";
    }

    /**
     * Retail-style enemy focus: pick the CLOSEST enemy after AIHateDelays,
     * then stay committed — switching only on a grudge (someone is attacking
     * our base: RA1 sets Enemy to the attacker immediately) or when the
     * current focus is crippled. No more quiet 2-minute re-rolls.
     */
    private updateFocusEnemy(game: GameApi, playerData: PlayerData, matchAwareness: MatchAwareness): void {
        const currentTick = game.getCurrentTick();
        const hateDelay = HATE_DELAY_BY_DIFFICULTY[this.config?.difficultyId ?? "normal"] ?? 50;
        if (currentTick < hateDelay) {
            return;
        }
        if (this.focusEnemyName && currentTick < this.lastFocusPickAt + FOCUS_REVIEW_INTERVAL_TICKS) {
            return;
        }
        this.lastFocusPickAt = currentTick;
        const enemies = game
            .getPlayers()
            .filter((name) => name !== playerData.name && !game.areAlliedPlayers(playerData.name, name))
            .map((name) => game.getPlayerData(name))
            .filter((p) => p.isCombatant);
        if (enemies.length === 0) {
            this.focusEnemyName = null;
            return;
        }
        if (enemies.length === 1) {
            this.focusEnemyName = enemies[0].name;
            return;
        }

        // Grudge: whoever has combat units in our base right now becomes the
        // enemy, and stays it for a while.
        const hostilesAtHome = matchAwareness.getHostilesNearPoint2d(playerData.startLocation, 25);
        if (hostilesAtHome.length > 0) {
            const aggressor = hostilesAtHome
                .map(({ unitId }) => game.getUnitData(unitId))
                .find((u) => u && game.getPlayerData(u.owner)?.isCombatant);
            if (aggressor && aggressor.owner !== this.focusEnemyName) {
                this.focusEnemyName = aggressor.owner;
                this.lastFocusPickAt = currentTick + GRUDGE_HOLD_TICKS - FOCUS_REVIEW_INTERVAL_TICKS;
                return;
            }
        }

        // Sticky: keep the current focus unless they're crippled or gone.
        if (this.focusEnemyName) {
            const focus = enemies.find((enemy) => enemy.name === this.focusEnemyName);
            if (focus && game.getVisibleUnits(focus.name, "self").length > 0) {
                return;
            }
        }

        // (Re)pick: closest by start location, with a personality tiebreak
        // flavor — pile-on personalities prefer the weakest instead.
        const pileOn = this.config?.personalityId === "opportunist" || this.config?.personalityId === "boomer";
        let best = enemies[0];
        let bestScore = Number.POSITIVE_INFINITY;
        for (const enemy of enemies) {
            let score: number;
            if (pileOn) {
                score = game.getVisibleUnits(enemy.name, "self").length;
            } else {
                const dx = enemy.startLocation.x - playerData.startLocation.x;
                const dy = enemy.startLocation.y - playerData.startLocation.y;
                score = dx * dx + dy * dy;
            }
            if (score < bestScore) {
                bestScore = score;
                best = enemy;
            }
        }
        this.focusEnemyName = best.name;
    }

    getName(): string {
        return "AttackMissionFactory";
    }

    /** Open a short window of heightened aggression (e.g. after repelling an attack). */
    public openCounterattackWindow(currentTick: number, durationTicks: number = 900): void {
        this.counterattackUntilTick = Math.max(this.counterattackUntilTick, currentTick + durationTicks);
    }

    /** Team cost class → personality bias multiplier. */
    private costBias(entry: AiTriggerEntry): number {
        const bias = this.config?.teamCostBias;
        if (!bias) {
            return 1;
        }
        if (entry.totalCost < 2000) {
            return bias.cheap;
        }
        if (entry.totalCost > 5000) {
            return bias.heavy;
        }
        return bias.medium;
    }

    /**
     * Pick the attack composition: a retail ai.ini team when the trigger
     * database has an eligible one, else the legacy hand-rolled composition.
     */
    private pickComposition(
        context: SupabotContext,
        fallback: SideComposition | null,
        logger: DebugLogger,
    ): { composition: SideComposition; triggerEntry: AiTriggerEntry | null } | null {
        const { game } = context;
        const playerData = game.getPlayerData(context.player.name);
        if (playerData.aiTriggersEnabled === false) {
            return null;
        }
        const armySizeMultiplier = this.config?.armySizeMultiplier ?? 1;

        if (this.triggerDb && playerData.country && !game.shouldIgnoreGlobalAITriggers?.()) {
            const difficulty =
                this.config?.difficultyId === "easy"
                    ? "easy"
                    : this.config?.difficultyId === "brutal"
                      ? "hard"
                      : "medium";
            const buildable = new Set(context.player.production.getAvailableObjects().map((o) => o.name));
            let pool = this.triggerDb.getEligibleAttackTriggers(game, playerData, difficulty, buildable);
            // Per-match trigger mask: a quarter of the deck sits out each
            // game, so the attack-team sequence differs match to match.
            const maskRoll = this.config?.matchDoctrine?.maskedTriggerRoll;
            if (maskRoll !== undefined) {
                const unmasked = pool.filter((entry) => !isTriggerMasked(entry.index, maskRoll));
                if (unmasked.length > 0) {
                    pool = unmasked;
                }
            }
            // Wave ladder: early waves send probes, later waves heavy teams.
            const ceiling = this.waveCostCeiling();
            const inWave = pool.filter((entry) => entry.totalCost <= ceiling);
            if (inWave.length > 0) {
                pool = inWave;
            }
            const heavyBias = this.config?.matchDoctrine?.doctrine.heavyTeamBias ?? 1;
            const picked = this.triggerDb.pickWeighted(
                game,
                pool,
                (entry) => this.costBias(entry) * (entry.totalCost > 5000 ? heavyBias : 1),
            );
            if (picked) {
                const totalUnits = picked.taskForce.totalUnits;
                const composition: SideComposition = {
                    composition: picked.taskForce.units,
                    minimumUnits: Math.max(1, Math.ceil(totalUnits * 0.6 * armySizeMultiplier)),
                    maximumUnits: Math.max(1, Math.ceil(totalUnits * armySizeMultiplier)),
                };
                logger(
                    `Attack team from ai.ini: "${picked.taskForce.name}" (trigger "${picked.trigger.name}", weight ${picked.currentWeight}, pool ${pool.length})`,
                );
                return { composition, triggerEntry: picked };
            }
        }

        if (fallback) {
            return { composition: fallback, triggerEntry: null };
        }
        return null;
    }

    maybeCreateMissions(
        context: SupabotContext,
        missionController: MissionController,
        logger: DebugLogger,
        fallbackComposition: SideComposition | null,
    ): void {
        const { game, matchAwareness } = context;
        const playerData = game.getPlayerData(context.player.name);
        if (playerData.aiTriggersEnabled === false) {
            return;
        }
        const counterattacking = game.getCurrentTick() < this.counterattackUntilTick;

        if (game.getCurrentTick() < this.firstAttackAllowedTick) {
            return;
        }
        // Cooldown counts from the previous LAUNCH: assembly happens during
        // the cooldown, so the next wave ships the moment it expires.
        if (!counterattacking && game.getCurrentTick() < this.lastLaunchAt + this.visibleTargetCooldownTicks) {
            return;
        }
        this.updateFocusEnemy(game, playerData, matchAwareness);

        // Cap concurrent assembling attacks (personality-driven multi-prong).
        const preparingCount = missionController
            .getMissions()
            .filter(
                (mission): mission is AttackMission =>
                    mission instanceof AttackMission && mission.getState() === AttackMissionState.Preparing,
            ).length;
        if (preparingCount >= this.maxPreparing + (counterattacking ? 1 : 0)) {
            return;
        }

        const picked = this.pickComposition(context, fallbackComposition, logger);
        if (!picked) {
            return;
        }
        const { composition, triggerEntry } = picked;

        const attackRadius = 10;

        const includeEnemyBases = game.getCurrentTick() > this.lastAttackAt + this.baseAttackCooldownTicks;

        const intent = triggerEntry?.targetIntent ?? null;
        const attackArea = generateTarget(
            game,
            playerData,
            matchAwareness,
            includeEnemyBases,
            this.targetPreference,
            intent,
            this.focusEnemyName,
        );

        if (!attackArea) {
            return;
        }

        const squadName = "attack_" + game.getCurrentTick();
        const lane = this.rollLane(game);

        const triggerDb = this.triggerDb;
        const tryAttack = missionController.addMission(
            new AttackMission(
                squadName,
                ATTACK_MISSION_INITIAL_PRIORITY,
                matchAwareness.getMainRallyPoint(),
                attackArea,
                attackRadius,
                composition,
                logger,
                this.launchTimeoutTicks,
                intent,
                lane,
                () => {
                    this.lastLaunchAt = game.getCurrentTick();
                    this.waveIndex++;
                },
            ).withOnFinish((unitIds, reason) => {
                logger(
                    `Attack ${squadName} (${JSON.stringify(composition)}) with ${
                        unitIds.length
                    } units finished with reason: ${reason}`,
                );
                // Retail-style trigger feedback: only COMBAT outcomes count.
                // Cleared the area = success; wiped or repelled = failure.
                // Assembly hiccups (UnableToAcquireUnits — production was
                // busy) and forced disbands (recalls, stuck pathing) are not
                // verdicts on the composition: the retail -50 was benching
                // expensive teams the bot never actually fielded.
                if (triggerDb && triggerEntry) {
                    if (reason === AttackFailReason.NoTargets) {
                        triggerDb.reportOutcome(triggerEntry, true);
                    } else if (reason === AttackFailReason.OutOfUnits || reason === AttackFailReason.Repelled) {
                        triggerDb.reportOutcome(triggerEntry, false);
                    }
                }
                missionController.addMission(
                    new RetreatMission(
                        "retreat-from-" + squadName + game.getCurrentTick(),
                        matchAwareness.getMainRallyPoint(),
                        unitIds,
                        logger,
                    ),
                );
            }),
        );
        if (tryAttack) {
            this.lastAttackAt = game.getCurrentTick();
        }
    }
}
