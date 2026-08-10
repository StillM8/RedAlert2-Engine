import { ApiEventType, Bot, GameApi, ApiEvent, ObjectType, FactoryType, QueueType, OrderType } from "../game-api";

import { MissionController } from "./logic/mission/missionController";
import { QueueController } from "./logic/building/queueController";
import { MatchAwareness, MatchAwarenessImpl } from "./logic/awareness";
import { formatTimeDuration } from "./logic/common/utils";
import { IncrementalGridCache } from "./logic/map/incrementalGridCache";
import { SupabotContext } from "./logic/common/context";
import { Strategy } from "./strategy/strategy";
import { DefaultStrategy } from "./strategy/defaultStrategy";
import { BOT_PERSONALITIES, BotProfile, NORMAL_BOT_PROFILE, resolveBotConfig } from "../botProfiles";
import { BaseBuildingMission } from "./logic/mission/missions/baseBuildingMission";
import { SuperweaponOfficer } from "./logic/superweapons";
import { AttackMission, AttackMissionState } from "./logic/mission/missions/attackMission";
import { DefenceMission } from "./logic/mission/missions/defenceMission";
import { rollMatchDoctrine, rollMatchIdentity } from "./strategy/doctrines";

const DEBUG_STATE_UPDATE_INTERVAL_SECONDS = 6;

const DEBUG_MESSAGES_BUFFER_LENGTH = 20;

// Number of ticks per second at the base speed.
const NATURAL_TICK_RATE = 15;

export class BuiltInBot extends Bot {
    private tickRatio?: number;
    private phaseOffset = 0;
    private botUpdateCount = 0;
    // How many bot updates between mission/strategy passes (set in onGameStart).
    private missionUpdateDivisor = 3;
    private queueController: QueueController;
    private tickOfLastAttackOrder: number = 0;
    private lastDeployAttemptTick: number = -9999;
    private deployAttemptCount: number = 0;

    private missionController: MissionController | null = null;
    private matchAwareness: MatchAwareness | null = null;
    private strategy: Strategy;
    private superweaponOfficer: SuperweaponOfficer | null = null;
    private lastRecallCheckAt = 0;
    private lastRepairRotationAt = 0;
    private lastFireSaleCheckAt = 0;
    private fireSaleDone = false;
    private lastEmergencySellAt = 0;

    // Messages to display in visualisation mode only.
    public _debugMessages: string[] = [];
    public _globalDebugText: string = "";
    public _debugGridCaches: { grid: IncrementalGridCache<any>; tag: string }[] = [];

    constructor(
        name: string,
        /** Content-defined country ID; vanilla enum values remain accepted as strings. */
        country: string,
        private tryAllyWith: string[] = [],
        private enableLogging = true,
        private profile: BotProfile = NORMAL_BOT_PROFILE,
        private strategyOverride?: Strategy,
    ) {
        super(name, country);
        this.queueController = new QueueController();
        // Placeholder until onGameStart rolls the match personality.
        this.strategy = strategyOverride ?? new DefaultStrategy();
    }

    override onGameStart(game: GameApi) {
        // Bot cadence must track SIM TICKS, not the wall clock: getTickRate()
        // follows the lobby game-speed slider (10..60 tps) while every pacing
        // constant in this bot (launch gates, timeouts, decay windows) is raw
        // ticks — so at the default speed 6 every difficulty thought ~6x
        // slower per game tick than intended. Clamp to 2x the base rate:
        // full speed-independence would triple brutal's per-tick AI cost on
        // device; this halves the sluggishness at identical worst-case cost.
        const gameRate = Math.min(game.getTickRate(), 2 * game.getBaseTickRate());
        const botApm = this.profile.apm;
        const botRate = botApm / 60;
        this.tickRatio = Math.ceil(gameRate / botRate);
        // Phase-stagger bots so 7 AIs don't all pay their full update on the
        // SAME tick (a 7x per-frame spike). The name is identical on every
        // client, so the offset is lockstep-safe.
        let hash = 0;
        for (let i = 0; i < this.name.length; i++) {
            hash = (hash * 31 + this.name.charCodeAt(i)) >>> 0;
        }
        this.phaseOffset = hash % this.tickRatio;
        // Missions run every Nth bot update. At high apm a bot update is a
        // fraction of a second so 3 is right, but at apm 60 (easy) a bot
        // update is already sparse: a fixed 3x divisor put easy's mission
        // cadence below what the squad-order (10t), fight-eval (45t) and
        // stuck-check (90t) intervals assume. Integer math on values fixed at
        // game start — lockstep-identical on every client.
        this.missionUpdateDivisor = Math.max(1, Math.min(3, Math.round(gameRate / this.tickRatio)));

        const myPlayer = game.getPlayerData(this.name);

        if (!myPlayer.country) {
            throw new Error(`Player ${this.name} has no country`);
        }

        // Roll a per-match personality + doctrine with the shared game PRNG
        // (never Math.random — bots run in lockstep on every client).
        // Personality = tempo, doctrine = tools; jitter + opening book +
        // trigger mask make every match play out differently.
        const identity = rollMatchIdentity(game, BOT_PERSONALITIES.length);
        const personality = BOT_PERSONALITIES[identity.personalityIndex];
        const config = resolveBotConfig(this.profile, personality);
        config.matchDoctrine = rollMatchDoctrine(game, config.unitNameWeights, myPlayer.country.name, identity);
        if (!this.strategyOverride) {
            this.strategy = new DefaultStrategy(config);
        }
        this.queueController.setConfig(config);
        this.superweaponOfficer = new SuperweaponOfficer(config);
        const doctrine = config.matchDoctrine;
        this.logBotStatus(
            `Difficulty "${this.profile.id}", personality "${personality.id}", doctrine "${doctrine.doctrine.id}", opening "${doctrine.opening.id}"`,
        );
        console.log(
            `[BuiltInBot] "${this.name}" rolled personality "${personality.id}" doctrine "${doctrine.doctrine.id}" opening "${doctrine.opening.id}" (difficulty "${this.profile.id}", country ${myPlayer.country.name})`,
        );
        this.missionController = new MissionController((message, sayInGame) => this.logBotStatus(message, sayInGame));

        // TODO: Strategy should have an onGameStart call which sets up the initial missions.
        this.missionController.addMission(
            new BaseBuildingMission(QueueType.Structures, (message, sayInGame) =>
                this.logBotStatus(message, sayInGame),
            config),
        );
        this.missionController.addMission(
            new BaseBuildingMission(QueueType.Armory, (message, sayInGame) => this.logBotStatus(message, sayInGame),
            config),
        );

        this.matchAwareness = new MatchAwarenessImpl(
            game,
            myPlayer,
            null,
            myPlayer.startLocation,
            (message, sayInGame) => this.logBotStatus(message, sayInGame),
            config.aggressionThreatFactor,
        );

        this._debugGridCaches = [
            { grid: this.matchAwareness.getSectorCache(), tag: "sector-cache" },
            { grid: this.matchAwareness.getBuildSpaceCache()._cache, tag: "build-cache" },
        ];

        this.matchAwareness.onGameStart(game, myPlayer);

        this.tryAllyWith
            .filter((playerName) => playerName !== this.name)
            .forEach((playerName) => this.actionsApi.toggleAlliance(playerName, true));
    }

    override onGameTick(game: GameApi) {
        if (!this.matchAwareness || !this.missionController || !this.strategy) {
            if (game.getCurrentTick() % 150 === 0) {
                console.warn(`[BuiltInBot] "${this.name}" tick skipped: awareness=${!!this.matchAwareness} missions=${!!this.missionController} strategy=${!!this.strategy}`);
            }
            return;
        }

        // Periodic heartbeat log (debug only — console output has real cost
        // in the WKWebView, and the device log forwarder ships every line).
        if (this.getDebugMode() && game.getCurrentTick() % 300 === 0) {
            const myPlayer = game.getPlayerData(this.name);
            const conYards = game.getVisibleUnits(this.name, 'self', (r) => r.constructionYard);
            const allUnits = game.getVisibleUnits(this.name, 'self');
            console.log(`[BuiltInBot] "${this.name}" tick=${game.getCurrentTick()} credits=${myPlayer.credits} units=${allUnits.length} conyards=${conYards.length}`);
        }

        let threatCache = this.matchAwareness.getThreatCache();

        if ((game.getCurrentTick() / NATURAL_TICK_RATE) % DEBUG_STATE_UPDATE_INTERVAL_SECONDS === 0) {
            this.updateDebugState(game);
        }

        if ((game.getCurrentTick() + this.phaseOffset) % this.tickRatio! === 0) {
            this.tryInitialMcvDeploy(game);
            this.tryInitialGuardOrders(game);

            try {
                this.matchAwareness.onAiUpdate(this.context);
                threatCache = this.matchAwareness.getThreatCache();
            } catch (err) {
                this.logger?.error?.("BuiltIn awareness update failed", err);
            }

            const fullContext: SupabotContext = {
                ...this.context,
                matchAwareness: this.matchAwareness,
            };

            // hacky resign condition
            const armyUnits = game.getVisibleUnits(this.name, "self", (r) => r.isSelectableCombatant);
            const mcvUnits = game.getVisibleUnits(
                this.name,
                "self",
                (r) => !!r.deploysInto && game.getGeneralRules().baseUnit.includes(r.name),
            );
            const productionBuildings = game.getVisibleUnits(
                this.name,
                "self",
                (r) => r.type == ObjectType.Building && r.factory != FactoryType.None,
            );
            if (armyUnits.length == 0 && productionBuildings.length == 0 && mcvUnits.length == 0) {
                this.logBotStatus(`No army or production left, quitting.`);
                this.context.player.actions.quitGame();
            }

            // Mission/strategy logic every 3rd BOT update. This must be a
            // bot-local counter: gating on global tick % 3 while the update
            // itself runs on (tick + phaseOffset) % tickRatio === 0 means the
            // two conditions can be mathematically incompatible (e.g. ratio 9,
            // offset 5 → bot ticks are always ≡ 1 mod 3) — such bots NEVER ran
            // missions, strategy, or superweapons and sat idle all game.
            this.botUpdateCount++;
            if (this.botUpdateCount % this.missionUpdateDivisor === 0) {
                this.missionController.onAiUpdate(fullContext);
                this.strategy = this.strategy.onAiUpdate(fullContext, this.missionController, (message, sayInGame) =>
                    this.logBotStatus(message, sayInGame),
                );
                this.superweaponOfficer?.onAiUpdate(fullContext, this.missionController, (message, sayInGame) =>
                    this.logBotStatus(message, sayInGame),
                );
                this.maybeRecallDefenders(fullContext);
                this.maybeSendToRepair(fullContext);
                this.maybeEmergencySell(fullContext);
                this.maybeFireSale(fullContext);
            }

            const unitTypeRequests = this.missionController.getRequestedUnitTypes();

            // Queue-controller logic.
            this.queueController.onAiUpdate(fullContext, threatCache, unitTypeRequests, (message) =>
                this.logBotStatus(message),
            );
        }
    }

    // RA1 AI_Raise_Money sell ladder: what a broke bot liquidates, in order.
    // Never production, refineries, power, or defenses — the ladder trades
    // luxury tech for survival cash.
    // NOTE: GAAIRC/AMRADR deliberately absent — they're the Allied AIRCRAFT
    // FACTORY (and the USA radar); selling them grounds the air force and
    // crashes any airborne Harriers.
    private static readonly SELL_LADDER = [
        "GAGAP", "GASPYSAT",
        "GADEPT", "NADEPT", "YADEPT", "YAGRND",
        "NARADR", "NAPSIS",
        "GAWEAT", "GACSPH", "NAMISL", "NAIRON", "YAPPET", "YAGNTC",
        "GATECH", "NATECH", "YATECH",
    ];

    /**
     * RA1-style desperation selling: broke AND no income (harvesters and
     * refineries gone) -> sell ONE ladder building per pass to fund the
     * rebuild. Visible drama: the battle lab comes down so the war factory
     * can keep running.
     */
    private maybeEmergencySell(context: SupabotContext): void {
        if (this.fireSaleDone) {
            return;
        }
        const { game } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < this.lastEmergencySellAt + 450) {
            return;
        }
        this.lastEmergencySellAt = currentTick;
        const myPlayer = game.getPlayerData(this.name);
        if (myPlayer.credits >= 100) {
            return;
        }
        const hasIncome =
            game.getVisibleUnits(this.name, "self", (r) => r.harvester).length > 0 ||
            game.getVisibleUnits(this.name, "self", (r) => (r as any).refinery).length > 0;
        if (hasIncome) {
            return;
        }
        for (const name of BuiltInBot.SELL_LADDER) {
            const owned = game.getVisibleUnits(this.name, "self", (r) => r.name === name);
            if (owned.length > 0) {
                this.logBotStatus(`Broke with no income — selling ${name} to refill the war chest.`);
                this.actionsApi.sellBuilding(owned[0]);
                return;
            }
        }
    }

    /**
     * The RA1 endgame: with no production left but buildings still standing,
     * sell EVERYTHING and send every unit on a final all-in — the iconic
     * "fire sale" banzai instead of a slow, passive death.
     */
    private maybeFireSale(context: SupabotContext): void {
        if (this.fireSaleDone) {
            return;
        }
        const { game } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < this.lastFireSaleCheckAt + 300) {
            return;
        }
        this.lastFireSaleCheckAt = currentTick;
        const production = game.getVisibleUnits(
            this.name,
            "self",
            (r) => r.constructionYard || (r.type === ObjectType.Building && r.factory !== FactoryType.None),
        );
        if (production.length > 0) {
            return;
        }
        const mcvs = game.getVisibleUnits(
            this.name,
            "self",
            (r) => !!r.deploysInto && game.getGeneralRules().baseUnit.includes(r.name),
        );
        if (mcvs.length > 0) {
            // Still holding an MCV — rebuilding beats going out in flames.
            return;
        }
        const buildings = game.getVisibleUnits(this.name, "self", (r) => r.type === ObjectType.Building);
        if (buildings.length === 0) {
            return;
        }
        this.fireSaleDone = true;
        this.logBotStatus(`No production left — FIRE SALE! Selling everything and attacking with all we have.`, true);
        buildings.forEach((id) => this.actionsApi.sellBuilding(id));
        const combatants = game.getVisibleUnits(this.name, "self", (r) => r.isSelectableCombatant);
        const myPlayer = game.getPlayerData(this.name);
        const enemies = game
            .getPlayers()
            .filter((name) => name !== this.name && !game.areAlliedPlayers(this.name, name))
            .map((name) => game.getPlayerData(name))
            .filter((p) => p.isCombatant);
        if (combatants.length > 0 && enemies.length > 0) {
            let nearest = enemies[0];
            let bestDistanceSq = Number.POSITIVE_INFINITY;
            for (const enemy of enemies) {
                const dx = enemy.startLocation.x - myPlayer.startLocation.x;
                const dy = enemy.startLocation.y - myPlayer.startLocation.y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq < bestDistanceSq) {
                    bestDistanceSq = distanceSq;
                    nearest = enemy;
                }
            }
            this.actionsApi.orderUnits(
                combatants.slice(0, 128),
                OrderType.AttackMove,
                nearest.startLocation.x,
                nearest.startLocation.y,
            );
        }
    }

    /**
     * Repair rotation: one badly damaged free vehicle at a time gets sent to
     * the repair depot (also evicts terror-drone parasites — healing kills
     * the drone). Sparse cadence, single dock.
     */
    private maybeSendToRepair(context: SupabotContext): void {
        const { game } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < this.lastRepairRotationAt + 300) {
            return;
        }
        this.lastRepairRotationAt = currentTick;
        const depots = game.getVisibleUnits(this.name, "self", (r) => (r as any).unitRepair);
        if (depots.length === 0) {
            return;
        }
        const myPlayer = game.getPlayerData(this.name);
        if (myPlayer.credits < 300) {
            return;
        }
        const candidates = game.getVisibleUnits(this.name, "self", (r) => r.isSelectableCombatant);
        for (const id of candidates) {
            const unit = game.getUnitData(id);
            if (!unit || !unit.maxHitPoints) {
                continue;
            }
            // NOTE: no clickRepairable gate — that flag defaults FALSE for
            // every vehicle (it's a building concept), and gating on it made
            // this whole rotation dead code.
            if (unit.hitPoints / unit.maxHitPoints < 0.4) {
                this.actionsApi.orderUnits([id], OrderType.Dock, depots[0]);
                break;
            }
        }
    }

    /**
     * When home defence is clearly outgunned, pull the weakest attacking
     * squad back (forced disband -> automatic retreat home, where the
     * defence mission's grab picks the survivors up). Runs sparsely.
     */
    private maybeRecallDefenders(context: SupabotContext): void {
        const { game, matchAwareness } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < this.lastRecallCheckAt + 300 || !this.missionController) {
            return;
        }
        this.lastRecallCheckAt = currentTick;

        const missions = this.missionController.getMissions();
        const activeDefences = missions.filter(
            (mission): mission is DefenceMission => mission instanceof DefenceMission && mission.getPriority() > 0,
        );
        if (activeDefences.length === 0) {
            return;
        }
        const defenderCount = activeDefences.reduce((sum, mission) => sum + mission.getUnitIds().length, 0);
        // Count hostiles around whichever defended point (main base OR
        // expansion) is under the heaviest pressure.
        let hostilesNearBase = 0;
        for (const defence of activeDefences) {
            const hostiles = matchAwareness.getHostilesNearPoint2d(defence.getDefendedPoint(), 25).length;
            hostilesNearBase = Math.max(hostilesNearBase, hostiles);
        }
        if (hostilesNearBase <= Math.max(3, defenderCount * 1.5)) {
            return;
        }

        const attacking = missions.filter(
            (mission): mission is AttackMission =>
                mission instanceof AttackMission && mission.getState() === AttackMissionState.Attacking,
        );
        if (attacking.length === 0) {
            return;
        }
        const weakest = attacking.reduce((a, b) => (a.getUnitIds().length <= b.getUnitIds().length ? a : b));
        this.logBotStatus(
            `Base under heavy attack (${hostilesNearBase} hostiles vs ${defenderCount} defenders) — recalling ${weakest.getUniqueName()}.`,
        );
        this.missionController.disbandMission(weakest.getUniqueName());
    }

    /**
     * Starting units (lobby Unit Count > 0) belong to no mission, and nothing
     * orders them until an attack composition happens to request their type —
     * so they stood idle even while the base was being razed. One Guard order
     * at game start makes the engine auto-engage anything in range; missions
     * freely re-task them later.
     */
    private initialGuardIssued = false;
    private tryInitialGuardOrders(game: GameApi): void {
        if (this.initialGuardIssued) {
            return;
        }
        this.initialGuardIssued = true;
        const starters = game.getVisibleUnits(
            this.name,
            "self",
            (r) => r.isSelectableCombatant && !r.deploysInto && !r.harvester && !r.engineer,
        );
        if (starters.length > 0) {
            this.actionsApi.orderUnits(starters, OrderType.Guard);
        }
    }

    private tryInitialMcvDeploy(game: GameApi): void {
        const hasConyard = game.getVisibleUnits(this.name, "self", (r) => r.constructionYard).length > 0;
        if (hasConyard) {
            this.deployAttemptCount = 0;
            return;
        }

        if (game.getCurrentTick() < this.lastDeployAttemptTick + 30) {
            return;
        }

        const mcvUnits = game.getVisibleUnits(
            this.name,
            "self",
            (r) => !!r.deploysInto && game.getGeneralRules().baseUnit.includes(r.name),
        );

        if (mcvUnits.length === 0) {
            return;
        }

        this.deployAttemptCount++;

        if (this.deployAttemptCount > 5) {
            // Deploy keeps failing — current position is blocked, find a clear spot
            const mcvData = game.getUnitData(mcvUnits[0]);
            if (mcvData?.tile && mcvData.rules?.deploysInto) {
                const cx = mcvData.tile.rx;
                const cy = mcvData.tile.ry;
                for (let radius = 2; radius <= 10; radius++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        for (let dy = -radius; dy <= radius; dy++) {
                            if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                            try {
                                if (game.canPlaceBuilding(this.name, mcvData.rules.deploysInto, { rx: cx + dx, ry: cy + dy })) {
                                    this.actionsApi.orderUnits([mcvUnits[0]], OrderType.Move, cx + dx, cy + dy);
                                    this.deployAttemptCount = 0;
                                    this.lastDeployAttemptTick = game.getCurrentTick();
                                    return;
                                }
                            } catch (_e) { /* skip */ }
                        }
                    }
                }
            }
            // Nothing found, scatter
            this.actionsApi.orderUnits([mcvUnits[0]], OrderType.Scatter);
            this.deployAttemptCount = 0;
        } else {
            this.actionsApi.orderUnits([mcvUnits[0]], OrderType.DeploySelected);
        }
        this.lastDeployAttemptTick = game.getCurrentTick();
    }

    private getHumanTimestamp(game: GameApi) {
        return formatTimeDuration(game.getCurrentTick() / NATURAL_TICK_RATE);
    }

    private logBotStatus(message: string, sayInGame: boolean = false) {
        if (!this.enableLogging) {
            return;
        }
        // Console output only in debug mode — bot chatter at INFO level was
        // measurable WKWebView overhead (string building + console + the
        // device log forwarder). The in-memory ring buffer always records.
        if (this.getDebugMode()) {
            this.logger.info(message);
        }
        const timestamp = this.getHumanTimestamp(this.gameApi);
        if (sayInGame) {
            this.actionsApi.sayAll(`${timestamp}: ${message}`);
        }
        this.pushDebugMessage(`${timestamp}: ${message}`);
    }

    private updateDebugState(game: GameApi) {
        if (!this.getDebugMode() || !this.missionController) {
            return;
        }
        // Update the global debug text.
        const myPlayer = game.getPlayerData(this.name);
        const harvesters = game.getVisibleUnits(this.name, "self", (r) => r.harvester).length;

        let globalDebugText = `Cash: ${myPlayer.credits} | Harvesters: ${harvesters}\n`;
        globalDebugText += this.queueController.getGlobalDebugText(this.gameApi, this.productionApi);
        globalDebugText += this.missionController.getGlobalDebugText(this.gameApi);
        globalDebugText += this.matchAwareness?.getGlobalDebugText();

        this.missionController.updateDebugText(this.actionsApi);

        // Tag enemy units with IDs
        game.getVisibleUnits(this.name, "enemy").forEach((unitId) => {
            this.actionsApi.setUnitDebugText(unitId, unitId.toString());
        });

        this.actionsApi.setGlobalDebugText(globalDebugText);
        this._globalDebugText = globalDebugText;
    }

    override onGameEvent(ev: ApiEvent) {
        switch (ev.type) {
            case ApiEventType.ObjectDestroy: {
                // Add to the stalemate detection.
                if (ev.attackerInfo?.playerName == this.name) {
                    this.tickOfLastAttackOrder += (this.gameApi.getCurrentTick() - this.tickOfLastAttackOrder) / 2;
                }
                break;
            }
            default:
                break;
        }
    }

    protected pushDebugMessage(message: string) {
        if (this._debugMessages.length + 1 > DEBUG_MESSAGES_BUFFER_LENGTH) {
            this._debugMessages.shift();
        }
        this._debugMessages.push(message);
    }
}
