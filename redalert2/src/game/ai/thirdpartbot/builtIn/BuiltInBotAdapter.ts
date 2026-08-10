import { Bot } from '../../../bot/Bot';
import { BuiltInBot } from './bot/bot';
import { BotProfile, NORMAL_BOT_PROFILE } from './botProfiles';
import { BotRegistry } from '../BotRegistry';
import { ObjectType } from '@/engine/type/ObjectType';
import { QueueType, QueueStatus } from '@/game/player/production/ProductionQueue';
import { OrderType } from '@/game/order/OrderType';

/**
 * BuiltInBotAdapter — wraps the real BuiltInBot.
 * Delegates all lifecycle methods to the underlying BuiltInBot instance.
 *
 * Source: https://github.com/Supalosa/supalosa-chronodivide-bot
 */
export class BuiltInBotAdapter extends Bot {
    private innerBot: BuiltInBot;
    private failSafePendingBuildingType: string | null = null;
    private lastFailSafeDeployTick: number = -9999;
    private failSafeDeployAttempts: number = 0;
    /** Last tick the real bot threw. The queueing failsafe only runs after one. */
    private lastInnerBotErrorTick: number = -Infinity;
    /** Ticks the real bot gets to act before the failsafe considers it stalled. */
    private static readonly FAIL_SAFE_GRACE_TICKS = 900;

    private static readonly ALLIED_COUNTRIES = [
        'Americans', 'British', 'French', 'Germans', 'Koreans', 'Alliance',
    ];

    private static readonly FAIL_SAFE_BUILD_ORDER_ALLIED = ['GAPOWR', 'GAREFN', 'GAPILE', 'GAWEAP'];
    private static readonly FAIL_SAFE_BUILD_ORDER_SOVIET = ['NAPOWR', 'NAREFN', 'NAHAND', 'NAWEAP'];
    private static readonly FAIL_SAFE_BUILD_ORDER_YURI = ['YAPOWR', 'YAREFN', 'YABRCK', 'YAWEAP'];

    constructor(name: string, country: string, profile: BotProfile = NORMAL_BOT_PROFILE) {
        super(name, country);
        // The ruleset owns the country namespace. The built-in bot keeps its
        // vanilla country heuristics, but must accept any data-defined MO ID
        // without a closed enum cast or a silent country remap.
        this.innerBot = new BuiltInBot(name, country, [], true, profile);
    }

    override setGameApi(api: any): void {
        super.setGameApi(api);
        this.innerBot.setGameApi(api);
    }

    override setActionsApi(api: any): void {
        super.setActionsApi(api);
        this.innerBot.setActionsApi(api);
    }

    override setProductionApi(api: any): void {
        super.setProductionApi(api);
        this.innerBot.setProductionApi(api);
    }

    override setLogger(logger: any): void {
        super.setLogger(logger);
        this.innerBot.setLogger(logger);
    }

    override setDebugMode(debug: boolean): Bot {
        super.setDebugMode(debug);
        this.innerBot.setDebugMode(debug);
        return this;
    }

    override onGameStart(event: any): void {
        console.log(`[BuiltInBotAdapter] onGameStart called for "${this.name}" country="${this.country}"`);
        try {
            this.innerBot.onGameStart(event);
            console.log(`[BuiltInBotAdapter] onGameStart completed for "${this.name}"`);
        } catch (e) {
            console.error(`[BuiltInBotAdapter] onGameStart FAILED for "${this.name}":`, e);
            throw e;
        }
    }

    override onGameTick(event: any): void {
        try {
            this.innerBot.onGameTick(event);
        } catch (e) {
            this.logger?.error?.('BuiltInBot tick error:', e);
            console.error(`[BuiltInBotAdapter] tick error for "${this.name}":`, e);
            this.lastInnerBotErrorTick = event?.getCurrentTick?.() ?? 0;
            // Keep the AI alive even if the imported bot throws.
            this.runFailSafeTick(event);
            return;
        }
        // Non-invasive safety net for "AI stands still" scenarios.
        this.runFailSafeTick(event);
    }

    override onGameEvent(event: any): void {
        try {
            this.innerBot.onGameEvent(event);
        } catch (e) {
            this.logger?.error?.('BuiltInBot event error:', e);
        }
    }

    private runFailSafeTick(gameApi: any): void {
        if (!this.productionApi || !this.actionsApi || !gameApi) {
            if (gameApi?.getCurrentTick?.() % 150 === 0) {
                console.warn(`[BuiltInBotAdapter] "${this.name}" failsafe skipped: productionApi=${!!this.productionApi} actionsApi=${!!this.actionsApi} gameApi=${!!gameApi}`);
            }
            return;
        }

        // Keep fallback low-frequency to reduce interference with normal logic.
        if (gameApi.getCurrentTick() % 15 !== 0) {
            return;
        }

        const conYards = gameApi.getVisibleUnits(this.name, 'self', (r: any) => r.constructionYard);
        if (conYards.length === 0) {
            if (gameApi.getCurrentTick() < this.lastFailSafeDeployTick + 30) {
                return;
            }
            const mcvs = gameApi.getVisibleUnits(
                this.name,
                'self',
                (r: any) => !!r.deploysInto && gameApi.getGeneralRules().baseUnit.includes(r.name),
            );
            if (mcvs.length > 0) {
                this.failSafeDeployAttempts++;
                if (this.failSafeDeployAttempts > 5) {
                    // Deploy keeps failing — find a clear spot nearby and move there
                    const mcvData = gameApi.getUnitData(mcvs[0]);
                    if (mcvData?.tile && mcvData.rules?.deploysInto) {
                        const cx = mcvData.tile.rx;
                        const cy = mcvData.tile.ry;
                        let found = false;
                        for (let radius = 2; radius <= 10 && !found; radius++) {
                            for (let dx = -radius; dx <= radius && !found; dx++) {
                                for (let dy = -radius; dy <= radius && !found; dy++) {
                                    if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                                    const tx = cx + dx;
                                    const ty = cy + dy;
                                    try {
                                        if (gameApi.canPlaceBuilding(this.name, mcvData.rules.deploysInto, { rx: tx, ry: ty })) {
                                            this.actionsApi.orderUnits([mcvs[0]], OrderType.Move, tx, ty);
                                            this.failSafeDeployAttempts = 0;
                                            found = true;
                                        }
                                    } catch (_e) { /* skip */ }
                                }
                            }
                        }
                        if (!found) {
                            // No valid spot, scatter and reset
                            this.actionsApi.orderUnits([mcvs[0]], OrderType.Scatter);
                            this.failSafeDeployAttempts = 0;
                        }
                    }
                } else {
                    this.actionsApi.orderUnits([mcvs[0]], OrderType.DeploySelected);
                }
                this.lastFailSafeDeployTick = gameApi.getCurrentTick();
            }
            return;
        }
        // Conyard exists, reset deploy attempts
        this.failSafeDeployAttempts = 0;

        const queueData = this.productionApi.getQueueData(QueueType.Structures);

        if (queueData.status === QueueStatus.OnHold) {
            this.actionsApi.resumeProduction(QueueType.Structures);
        }

        if (queueData.status === QueueStatus.Ready && queueData.items.length > 0) {
            const readyType = queueData.items[0]?.rules?.name || this.failSafePendingBuildingType;
            if (readyType) {
                this.tryPlaceBuildingNearConyard(gameApi, readyType);
            }
            return;
        }

        // "Income dead": no refinery, no harvester, and nothing left to pay
        // with. Nothing in this codebase recovers from that state — the sell
        // ladder spares the conyard and power plant, the fire sale requires
        // zero production buildings, and the queue controller only cancels
        // items that reach Ready, which a structure the bot cannot pay for
        // never does. Worth naming explicitly because the queue in that state
        // is *Active* (a refinery frozen part-built), so the early return below
        // used to skip the failsafe entirely on exactly the bots that needed it.
        const hasRefinery = gameApi.getVisibleUnits(this.name, 'self', (r: any) => r.refinery).length > 0;
        const hasHarvester = gameApi.getVisibleUnits(this.name, 'self', (r: any) => r.harvester).length > 0;
        const incomeDead =
            !hasRefinery &&
            !hasHarvester &&
            gameApi.getCurrentTick() > BuiltInBotAdapter.FAIL_SAFE_GRACE_TICKS;

        const queueHasItems = Array.isArray(queueData.items) && queueData.items.length > 0;
        if (
            !incomeDead &&
            queueHasItems &&
            queueData.status !== QueueStatus.Idle &&
            queueData.status !== QueueStatus.OnHold
        ) {
            return;
        }

        // Everything below QUEUES buildings directly, bypassing the real bot's
        // mission/request system. When the real bot is healthy that is actively
        // harmful: the queue controller cancels anything it did not request
        // ("Cancelling ready X because no one is requesting anymore"), so the
        // two fight in a queue/cancel loop that burns the whole economy — and
        // the old "extra power is always useful" filler below turned that loop
        // into the endless power-plant / bio-reactor farm. Only act as a true
        // failsafe: the real bot has thrown recently, or it has failed to
        // establish even a minimal base long past the point it should have.
        const tick = gameApi.getCurrentTick();
        const recentlyErrored = tick - this.lastInnerBotErrorTick < BuiltInBotAdapter.FAIL_SAFE_GRACE_TICKS;
        const ownedBuildingCount = gameApi.getVisibleUnits(
            this.name,
            'self',
            (r: any) => r.type === ObjectType.Building,
        ).length;
        // A raw building count is the wrong test for "stalled": the bot that
        // prompted this had exactly TWO buildings (conyard + power plant) and so
        // slipped through a <= 1 check while being completely dead. Income is
        // the honest signal — a base with no refinery and no miner is not
        // developing, whatever its structure count.
        const stalledEarly =
            (ownedBuildingCount <= 1 || incomeDead) && tick > BuiltInBotAdapter.FAIL_SAFE_GRACE_TICKS;
        if (!recentlyErrored && !stalledEarly) {
            return;
        }

        const available = this.productionApi
            .getAvailableObjects(QueueType.Structures)
            .map((o: any) => o.name);
        if (available.length === 0) {
            return;
        }

        const buildOrder = this.country === 'YuriCountry'
            ? BuiltInBotAdapter.FAIL_SAFE_BUILD_ORDER_YURI
            : this.isAlliedCountry(this.country)
                ? BuiltInBotAdapter.FAIL_SAFE_BUILD_ORDER_ALLIED
                : BuiltInBotAdapter.FAIL_SAFE_BUILD_ORDER_SOVIET;

        const ownedBuildingNames = new Set(
            gameApi
                .getVisibleUnits(this.name, 'self', (r: any) => r.type === ObjectType.Building)
                .map((id: any) => gameApi.getGameObjectData(id)?.name)
                .filter((n: any) => !!n),
        );

        // Only ever bootstrap the basic base. If the bot already owns the whole
        // starter list, the failsafe has nothing legitimate left to do — the
        // real bot decides what comes next. (The old code fell through to
        // "queue another power plant" here, forever.)
        let nextBuild = buildOrder.find((name) => available.includes(name) && !ownedBuildingNames.has(name));

        // Predefined order unavailable for this ruleset/mod: take one unowned
        // structure so a broken bot is not deadlocked, but never a duplicate.
        if (!nextBuild) {
            nextBuild = available.find((name: string) => !ownedBuildingNames.has(name));
        }
        if (!nextBuild) {
            return;
        }

        if (nextBuild) {
            try {
                this.actionsApi.queueForProduction(QueueType.Structures, ObjectType.Building, nextBuild, 1);
                this.failSafePendingBuildingType = nextBuild;
            } catch (err) {
                this.logger?.error?.('BuiltIn fail-safe queueForProduction failed', nextBuild, err);
            }
        }
    }

    private tryPlaceBuildingNearConyard(gameApi: any, buildingType: string): void {
        const conYards = gameApi.getVisibleUnits(this.name, 'self', (r: any) => r.constructionYard);
        if (conYards.length === 0) {
            return;
        }

        const conYardData = gameApi.getUnitData(conYards[0]);
        if (!conYardData?.tile) {
            return;
        }

        const cx = conYardData.tile.rx;
        const cy = conYardData.tile.ry;

        for (let radius = 3; radius <= 15; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
                        continue;
                    }
                    const tx = cx + dx;
                    const ty = cy + dy;
                    try {
                        if (gameApi.canPlaceBuilding(this.name, buildingType, { rx: tx, ry: ty })) {
                            this.actionsApi.placeBuilding(buildingType, tx, ty);
                            this.failSafePendingBuildingType = null;
                            return;
                        }
                    } catch (_e) {
                        // Keep scanning nearby tiles.
                    }
                }
            }
        }

        this.logger?.info?.(`BuiltIn fail-safe could not place ${buildingType} near conyard`);
    }

    private isAlliedCountry(countryName: string): boolean {
        const c = (countryName || '').toLowerCase();
        return BuiltInBotAdapter.ALLIED_COUNTRIES.some((name) => name.toLowerCase() === c);
    }
}

/**
 * Register BuiltInBot as a built-in third-party bot.
 */
export function registerBuiltInBot(): void {
    BotRegistry.getInstance().register({
        id: 'builtIn-bot',
        displayName: 'AI-Normal (BuiltIn)',
        version: '0.6.1',
        author: 'BuiltIn',
        description: 'Normal difficulty AI. Full strategy system with missions, threat analysis, and build prioritization.',
        factory: (name: string, country: string) => {
            const bot = new BuiltInBotAdapter(name, country);
            return {
                id: 'builtIn-bot',
                displayName: 'AI-Normal (BuiltIn)',
                version: '0.6.1',
                author: 'BuiltIn',
                description: 'Normal difficulty AI',
                onGameStart: (gameApi: any) => bot.onGameStart(gameApi),
                onGameTick: (gameApi: any) => bot.onGameTick(gameApi),
                onGameEvent: (event: any, _data: any) => bot.onGameEvent(event),
            };
        },
        builtIn: true,
    });
}
