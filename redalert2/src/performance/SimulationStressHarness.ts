import { Game, GameStatus } from "@/game/Game";
import { GameSpeed } from "@/game/GameSpeed";
import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";

export const DEFAULT_SIMULATION_STRESS_COUNTS = [25, 50, 100, 200, 300, 500] as const;
export const SIMULATION_STRESS_SCENARIOS = ["idle", "moving", "fighting", "ai", "mental-omega"] as const;

export type SimulationStressScenario = typeof SIMULATION_STRESS_SCENARIOS[number];

export interface SimulationStressOptions {
    counts?: readonly number[];
    scenarios?: readonly SimulationStressScenario[];
    warmupTicks?: number;
    sampleTicks?: number;
    seed?: number;
}

export interface SimulationStressMetric {
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    ticksPerSecond: number;
    samples: number;
}

export interface SimulationCatchUpMetric {
    frameCount: number;
    totalTicks: number;
    maxDebtMs: number;
    p95DebtMs: number;
    maxTurnsPerFrame: number;
    maxBurstMs: number;
    framesOverBudget: number;
}

export interface SimulationStressCounters {
    pathfinderCalls: number;
    targetAcquisitionCalls: number;
    spatialQueries: number;
    projectileCalls: number;
    aresTraitCalls: number;
    superweaponCalls: number;
    aiTargetScans: number;
}

export interface SimulationStressCase {
    scenario: SimulationStressScenario;
    unitCount: number;
    worldObjects: number;
    updatableObjects: number;
    infantry: number;
    vehicles: number;
    projectiles: number;
    attachEffects: number;
    simulation: SimulationStressMetric;
    catchUp: SimulationCatchUpMetric;
    countersPerTick: SimulationStressCounters;
}

export interface SimulationStressReport {
    seed: number;
    gameSpeed: number;
    turnMillis: number;
    warmupTicks: number;
    sampleTicks: number;
    cases: SimulationStressCase[];
}

interface StressActor {
    isSpawned: boolean;
    state: number;
    x: number;
    y: number;
    targetIndex: number;
    aresTrait?: AresAttachEffectTrait;
    update(game: Game): void;
}

interface MutableStressCounters extends SimulationStressCounters {
    reset(): void;
}

interface CatchUpOptions {
    frameIntervalMs?: number;
    skipBudgetMs?: number;
    maxCatchUpMs?: number;
}

const DEFAULT_GAME_SPEED = 5;
const DEFAULT_WARMUP_TICKS = 60;
const DEFAULT_SAMPLE_TICKS = 180;

function createCounters(): MutableStressCounters {
    const counters: MutableStressCounters = {
        pathfinderCalls: 0,
        targetAcquisitionCalls: 0,
        spatialQueries: 0,
        projectileCalls: 0,
        aresTraitCalls: 0,
        superweaponCalls: 0,
        aiTargetScans: 0,
        reset(): void {
            counters.pathfinderCalls = 0;
            counters.targetAcquisitionCalls = 0;
            counters.spatialQueries = 0;
            counters.projectileCalls = 0;
            counters.aresTraitCalls = 0;
            counters.superweaponCalls = 0;
            counters.aiTargetScans = 0;
        },
    };
    return counters;
}

function createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function percentile(values: readonly number[], fraction: number): number {
    if (!values.length) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function rounded(value: number): number {
    return Number(value.toFixed(4));
}

function countersPerTick(counters: SimulationStressCounters, tickCount: number): SimulationStressCounters {
    const divisor = Math.max(1, tickCount);
    return {
        pathfinderCalls: rounded(counters.pathfinderCalls / divisor),
        targetAcquisitionCalls: rounded(counters.targetAcquisitionCalls / divisor),
        spatialQueries: rounded(counters.spatialQueries / divisor),
        projectileCalls: rounded(counters.projectileCalls / divisor),
        aresTraitCalls: rounded(counters.aresTraitCalls / divisor),
        superweaponCalls: rounded(counters.superweaponCalls / divisor),
        aiTargetScans: rounded(counters.aiTargetScans / divisor),
    };
}

/**
 * Replays measured simulation costs through the same bounded catch-up model
 * used by GameAnimationLoop.  It does not discard outstanding turns: debt is
 * retained until a later frame can execute it.
 */
export function simulateCatchUp(
    tickDurationsMs: readonly number[],
    turnMillis: number,
    options: CatchUpOptions = {},
): SimulationCatchUpMetric {
    const frameIntervalMs = options.frameIntervalMs ?? (1000 / 60);
    const skipBudgetMs = options.skipBudgetMs ?? 8;
    const maxCatchUpMs = options.maxCatchUpMs ?? 100;
    const debtSamples: number[] = [];
    let wallTime = 0;
    let lastFrameTime = 0;
    let nextFrameTime = 0;
    let durationIndex = 0;
    let debtMs = 0;
    let totalTicks = 0;
    let maxTurnsPerFrame = 0;
    let maxBurstMs = 0;
    let framesOverBudget = 0;
    const totalTickTimeMs = tickDurationsMs.reduce((sum, duration) => sum + duration, 0);
    const maxFrameCount = Math.max(
        1,
        Math.ceil((totalTickTimeMs + tickDurationsMs.length * turnMillis) / frameIntervalMs) + tickDurationsMs.length + 2,
    );
    let framesProcessed = 0;

    while (framesProcessed < maxFrameCount && durationIndex < tickDurationsMs.length) {
        wallTime = Math.max(wallTime, nextFrameTime);
        debtMs += Math.max(0, wallTime - lastFrameTime);
        lastFrameTime = wallTime;
        const dueTurns = Math.max(0, Math.floor(debtMs / turnMillis));
        let budgetMs = Math.max(skipBudgetMs, Math.min(maxCatchUpMs, dueTurns * turnMillis));
        let spentMs = 0;
        let turnsThisFrame = 0;
        while (durationIndex < tickDurationsMs.length && debtMs >= turnMillis) {
            const tickDuration = Math.max(0, tickDurationsMs[durationIndex++] ?? 0);
            debtMs -= turnMillis;
            spentMs += tickDuration;
            turnsThisFrame++;
            totalTicks++;
            budgetMs = Math.max(0, budgetMs - tickDuration);
            if (budgetMs <= 0) {
                break;
            }
        }
        maxTurnsPerFrame = Math.max(maxTurnsPerFrame, turnsThisFrame);
        maxBurstMs = Math.max(maxBurstMs, spentMs);
        if (spentMs > maxCatchUpMs) {
            framesOverBudget++;
        }
        debtSamples.push(debtMs);
        nextFrameTime = wallTime + Math.max(frameIntervalMs, spentMs);
        framesProcessed++;
    }

    return {
        frameCount: framesProcessed,
        totalTicks,
        maxDebtMs: rounded(Math.max(...debtSamples, 0)),
        p95DebtMs: rounded(percentile(debtSamples, 0.95)),
        maxTurnsPerFrame,
        maxBurstMs: rounded(maxBurstMs),
        framesOverBudget,
    };
}

function createFixture(unitCount: number, scenario: SimulationStressScenario, seed: number): {
    game: Game;
    actors: StressActor[];
    counters: MutableStressCounters;
    attachEffects: number;
    projectiles: number;
} {
    const counters = createCounters();
    const actors: StressActor[] = [];
    const aiScenario = scenario === "ai" || scenario === "mental-omega";
    const aiActors = aiScenario ? Math.max(1, Math.floor(unitCount / 2)) : 0;
    const botManager = {
        init(): void { },
        update(): void {
            if (!aiScenario) {
                return;
            }
            for (let index = 0; index < aiActors; index++) {
                const actor = actors[index];
                let bestTarget = -1;
                let bestScore = Number.POSITIVE_INFINITY;
                for (let candidateIndex = 0; candidateIndex < actors.length; candidateIndex++) {
                    if (candidateIndex === index) {
                        continue;
                    }
                    counters.aiTargetScans++;
                    const candidate = actors[candidateIndex];
                    const distance = Math.abs(candidate.x - actor.x) + Math.abs(candidate.y - actor.y);
                    if (distance < bestScore || (distance === bestScore && candidateIndex < bestTarget)) {
                        bestScore = distance;
                        bestTarget = candidateIndex;
                    }
                }
                actor.targetIndex = bestTarget;
            }
        },
    };
    const gameOpts = {
        gameSpeed: DEFAULT_GAME_SPEED,
        humanPlayers: [],
        aiPlayers: aiScenario ? [{}] : [],
    };
    const game = new Game(
        {},
        {},
        {},
        {},
        {},
        seed,
        seed,
        gameOpts,
        0,
        { getCombatants: () => [] },
        {},
        {},
        { value: 1 },
        {},
        botManager,
    );
    game.status = GameStatus.Started;
    game.lastGameEndCheck = Number.MAX_SAFE_INTEGER;
    const random = createRandom(seed);
    const effectCount = scenario === "mental-omega" ? 4 : 0;
    const projectileCount = scenario === "fighting" || scenario === "ai" || scenario === "mental-omega" ? Math.max(1, Math.floor(unitCount / 8)) : 0;
    const effectDefinition: AresAttachEffectDefinition = {
        duration: -1,
        speedMultiplier: 1,
        armorMultiplier: 1,
        firepowerMultiplier: 1,
        rofMultiplier: 1,
        cloakable: false,
        forceDecloak: false,
        discardOnEntry: false,
        penetratesIronCurtain: false,
        delay: 0,
        initialDelay: 0,
        cumulative: false,
        animResetOnReapply: false,
        temporalHidesAnim: false,
        extensionEntries: new Map(),
    };
    const effectDefinitions = new Map(
        Array.from({ length: effectCount }, (_, effectIndex) => [`stress-effect-${effectIndex}`, effectDefinition] as const),
    );
    for (let index = 0; index < unitCount; index++) {
        const aresTrait = effectCount > 0
            ? new AresAttachEffectTrait({
                definitions: effectDefinitions,
                instances: Array.from({ length: effectCount }, (_, effectIndex) => ({
                    effectId: `stress-effect-${effectIndex}`,
                    remainingFrames: -1,
                    discardOnEntry: false,
                })),
            })
            : undefined;
        const actor: StressActor = {
            isSpawned: true,
            state: (seed + index) >>> 0,
            x: Math.floor(random() * 1024),
            y: Math.floor(random() * 1024),
            targetIndex: (index + 1) % Math.max(1, unitCount),
            aresTrait,
            update(currentGame): void {
                this.state = (this.state * 1664525 + 1013904223) >>> 0;
                if (scenario === "idle") {
                    return;
                }
                counters.pathfinderCalls++;
                if (scenario === "moving" || scenario === "fighting" || scenario === "ai" || scenario === "mental-omega") {
                    for (let direction = 0; direction < 8; direction++) {
                        this.state = (this.state + ((this.state >>> direction) & 7)) >>> 0;
                    }
                    this.x = (this.x + ((this.state & 3) - 1) + 1024) % 1024;
                    this.y = (this.y + (((this.state >>> 2) & 3) - 1) + 1024) % 1024;
                }
                if (scenario === "fighting" || scenario === "ai" || scenario === "mental-omega") {
                    counters.targetAcquisitionCalls++;
                    counters.spatialQueries++;
                    const target = actors[this.targetIndex];
                    this.state = (this.state ^ (target?.state ?? 0)) >>> 0;
                    counters.projectileCalls += projectileCount / Math.max(1, unitCount);
                    for (let burst = 0; burst < 4; burst++) {
                        this.state = (this.state * 33 + burst) >>> 0;
                    }
                }
                if (scenario === "mental-omega") {
                    this.aresTrait?.advanceTick();
                    counters.aresTraitCalls += effectCount;
                    if (currentGame.currentTick % 45 === 0) {
                        counters.superweaponCalls++;
                    }
                }
            },
        };
        actors.push(actor);
        game.updatableObjects.add(actor);
    }
    return { game, actors, counters, attachEffects: unitCount * effectCount, projectiles: projectileCount };
}

export function runSimulationStressBenchmarks(options: SimulationStressOptions = {}): SimulationStressReport {
    const seed = options.seed ?? 1337;
    const counts = options.counts?.length ? options.counts : DEFAULT_SIMULATION_STRESS_COUNTS;
    const scenarios = options.scenarios?.length ? options.scenarios : SIMULATION_STRESS_SCENARIOS;
    const warmupTicks = Math.max(0, Math.floor(options.warmupTicks ?? DEFAULT_WARMUP_TICKS));
    const sampleTicks = Math.max(1, Math.floor(options.sampleTicks ?? DEFAULT_SAMPLE_TICKS));
    const turnMillis = 1000 / (GameSpeed.computeGameSpeed(DEFAULT_GAME_SPEED) * GameSpeed.BASE_TICKS_PER_SECOND);
    const cases: SimulationStressCase[] = [];

    for (const scenario of scenarios) {
        for (const unitCount of counts) {
            const fixture = createFixture(unitCount, scenario, seed + unitCount + scenario.length);
            for (let tick = 0; tick < warmupTicks; tick++) {
                fixture.game.update();
            }
            fixture.counters.reset();
            const durations: number[] = [];
            for (let tick = 0; tick < sampleTicks; tick++) {
                const start = performance.now();
                fixture.game.update();
                durations.push(performance.now() - start);
            }
            const totalMs = durations.reduce((sum, duration) => sum + duration, 0);
            cases.push({
                scenario,
                unitCount,
                worldObjects: unitCount,
                updatableObjects: unitCount,
                infantry: unitCount,
                vehicles: 0,
                projectiles: fixture.projectiles,
                attachEffects: fixture.attachEffects,
                simulation: {
                    p50Ms: rounded(percentile(durations, 0.5)),
                    p95Ms: rounded(percentile(durations, 0.95)),
                    maxMs: rounded(Math.max(...durations)),
                    ticksPerSecond: rounded(1000 / (totalMs / durations.length)),
                    samples: durations.length,
                },
                catchUp: simulateCatchUp(durations, turnMillis),
                countersPerTick: countersPerTick(fixture.counters, sampleTicks),
            });
        }
    }
    return {
        seed,
        gameSpeed: DEFAULT_GAME_SPEED,
        turnMillis: rounded(turnMillis),
        warmupTicks,
        sampleTicks,
        cases,
    };
}
