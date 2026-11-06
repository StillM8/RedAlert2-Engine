import { Strategy } from "./strategy";
import { ExpansionMissionFactory } from "../logic/mission/missions/expansionMission";
import { ScoutingMissionFactory } from "../logic/mission/missions/scoutingMission";
import { AttackMissionFactory } from "../logic/mission/missions/attackMission";
import { DefenceMission, DefenceMissionFactory } from "../logic/mission/missions/defenceMission";
import { EngineerMissionFactory } from "../logic/mission/missions/engineerMission";
import { GarrisonMissionFactory } from "../logic/mission/missions/garrisonMission";
import { SpyMissionFactory } from "../logic/mission/missions/spyMission";
import { SupabotContext } from "../logic/common/context";
import { MissionController } from "../logic/mission/missionController";
import { DebugLogger } from "../logic/common/utils";
import { Compositions, getValidCompositions, SideComposition } from "./compositionUtils";
import { AiTriggerDatabase, BuildingFacts } from "../logic/ai-ini/aiTriggerDb";
import { EffectiveBotConfig, NORMAL_BOT_PROFILE, resolveBotConfig, BOT_PERSONALITIES } from "../../botProfiles";
import { FactoryType } from "../../game-api";
import { Engine } from "@/engine/Engine";

const DEFAULT_CONFIG: EffectiveBotConfig = resolveBotConfig(
    NORMAL_BOT_PROFILE,
    BOT_PERSONALITIES.find((p) => p.id === 'balanced')!,
);

// Fallback attack compositions, used only when ai(md).ini teams are
// unavailable (e.g. total conversion mods without an AI database).
const DEFAULT_COMPOSITIONS: Compositions = {
    conscripts: {
        composition: {
            E2: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    gis: {
        composition: {
            E1: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    sovietTanks: {
        composition: {
            HTNK: 5,
            HTK: 1,
        },
        minimumUnits: 2,
        maximumUnits: 20,
    },
    alliedTanks: {
        composition: {
            MTNK: 5,
            FV: 1,
        },
        minimumUnits: 2,
        maximumUnits: 20,
    },
    kirovs: {
        composition: {
            ZEP: 1,
        },
        minimumUnits: 1,
        maximumUnits: 3,
    },
    rocketeers: {
        composition: {
            JUMPJET: 1,
        },
        minimumUnits: 2,
        maximumUnits: 6,
    },
    heavySovietTanks: {
        composition: {
            APOC: 2,
            HTNK: 1,
        },
        minimumUnits: 2,
        maximumUnits: 10,
    },
    heavyAlliedTanks: {
        composition: {
            MTNK: 2,
            MGTK: 1,
        },
        minimumUnits: 2,
        maximumUnits: 10,
    },
    sovietArtillery: {
        composition: {
            V3: 2,
            HTNK: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    alliedArtillery: {
        composition: {
            SREF: 2,
            MTNK: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    initiates: {
        composition: {
            INIT: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    yuriTanks: {
        composition: {
            LTNK: 5,
            YTNK: 1,
        },
        minimumUnits: 2,
        maximumUnits: 20,
    },
    heavyYuriTanks: {
        composition: {
            LTNK: 3,
            MIND: 1,
        },
        minimumUnits: 2,
        maximumUnits: 10,
    },
    discs: {
        composition: {
            DISK: 1,
        },
        minimumUnits: 1,
        maximumUnits: 3,
    },
};

function collectCosts(costs: Map<string, number>, rulesMap: any): void {
    if (!rulesMap) {
        return;
    }
    const entries: Iterable<[string, any]> =
        rulesMap instanceof Map ? rulesMap.entries() : Object.entries(rulesMap);
    for (const [name, rules] of entries) {
        const cost = (rules as any)?.cost;
        if (typeof cost === "number") {
            costs.set(name, cost);
        }
    }
}

/**
 * Parse the retail AI database. Built PER BOT, PER GAME: trigger weights
 * mutate with team outcomes, so sharing a database between bots (or letting
 * one outlive a match) would leak state — and cross-client, that's a lockstep
 * divergence for anyone who played a previous match in the same session.
 */
export function buildAiTriggerDatabase(context: SupabotContext): AiTriggerDatabase | null {
    if (context.game.shouldIgnoreGlobalAITriggers?.()) {
        return null;
    }
    try {
        const aiIni = (Engine as any).ai;
        if (!aiIni) {
            return null;
        }
        const costs = new Map<string, number>();
        const rulesApi = (context.game as any).rulesApi;
        collectCosts(costs, rulesApi?.infantryRules);
        collectCosts(costs, rulesApi?.vehicleRules);
        collectCosts(costs, rulesApi?.aircraftRules);

        // Attack Enemy Structure script actions reference buildings by their
        // [BuildingTypes] list position (registration order, 0-based) — read
        // the list straight from the merged rules ini.
        const buildingNames: string[] = [];
        const btSection = (Engine as any).rules?.getSection?.("BuildingTypes");
        if (btSection) {
            for (const [, value] of btSection.entries) {
                const name = String(Array.isArray(value) ? value[0] : value).trim();
                if (name) {
                    buildingNames.push(name);
                }
            }
        }
        const buildingRulesMap = rulesApi?.buildingRules;
        const lookupBuilding = (name: string): any =>
            buildingRulesMap instanceof Map ? buildingRulesMap.get(name) : buildingRulesMap?.[name];
        const buildingByIndex = (index: number): BuildingFacts | null => {
            const name = buildingNames[index];
            if (!name) {
                return null;
            }
            const rules = lookupBuilding(name);
            if (!rules) {
                return null;
            }
            return {
                isFactory: rules.factory !== undefined && rules.factory !== FactoryType.None,
                isRefinery: !!rules.refinery,
                isBaseDefense: !!rules.isBaseDefense,
                power: rules.power ?? 0,
            };
        };

        const db = new AiTriggerDatabase(aiIni, (unitName) => costs.get(unitName) ?? 0, buildingByIndex);
        const roleCounts = db.entries.reduce(
            (acc, e) => ((acc[e.role] = (acc[e.role] ?? 0) + 1), acc),
            {} as Record<string, number>,
        );
        console.log(
            `[BuiltInBot] ai.ini trigger database: ${db.entries.length} teams (${JSON.stringify(roleCounts)})`,
        );
        return db;
    } catch (err) {
        console.warn("[BuiltInBot] failed to parse ai.ini triggers, falling back to static compositions", err);
        return null;
    }
}

export class DefaultStrategy implements Strategy {
    private expansionFactory = new ExpansionMissionFactory();
    private scoutingFactory = new ScoutingMissionFactory();
    private attackFactory: AttackMissionFactory | null = null;
    private defenceFactory = new DefenceMissionFactory();
    private engineerFactory = new EngineerMissionFactory();
    private garrisonFactory: GarrisonMissionFactory;
    private spyFactory: SpyMissionFactory;
    private hadActiveDefence = false;

    constructor(private config: EffectiveBotConfig = DEFAULT_CONFIG) {
        this.garrisonFactory = new GarrisonMissionFactory(config);
        this.spyFactory = new SpyMissionFactory(config);
    }

    onAiUpdate(context: SupabotContext, missionController: MissionController, logger: DebugLogger) {
        if (!this.attackFactory) {
            // Lazy: the trigger database needs a live game context to resolve
            // unit costs.
            this.attackFactory = new AttackMissionFactory(this.config, buildAiTriggerDatabase(context));
        }

        this.expansionFactory.maybeCreateMissions(context, missionController, logger);
        this.scoutingFactory.maybeCreateMissions(context, missionController, logger);

        const fallback = this.selectRandomAttackComposition(context, logger);
        this.attackFactory.maybeCreateMissions(context, missionController, logger, fallback);

        this.defenceFactory.maybeCreateMissions(context, missionController, logger);
        this.engineerFactory.maybeCreateMissions(context, missionController, logger);
        this.garrisonFactory.maybeCreateMissions(context, missionController, logger);
        this.spyFactory.maybeCreateMissions(context, missionController, logger);

        // Counterattack: the moment a defence stands down (attackers wiped or
        // driven off), punch back while the enemy army is spent. Opportunists
        // get a longer window.
        const defenceActive = missionController
            .getMissions()
            .some((mission) => mission instanceof DefenceMission && mission.getPriority() > 0);
        if (this.hadActiveDefence && !defenceActive) {
            const duration = this.config.personalityId === "opportunist" ? 1350 : 900;
            this.attackFactory.openCounterattackWindow(context.game.getCurrentTick(), duration);
            logger(`Defence stood down — counterattack window open (${duration} ticks).`);
        }
        this.hadActiveDefence = defenceActive;

        return this;
    }

    private selectRandomAttackComposition(context: SupabotContext, logger: DebugLogger): SideComposition | null {
        const playerData = context.game.getPlayerData(context.player.name);
        if (playerData.aiTriggersEnabled === false) {
            return null;
        }
        const side = playerData.country?.side;
        if (side === undefined) {
            return null;
        }

        const validCompositions = getValidCompositions(context, DEFAULT_COMPOSITIONS);

        if (validCompositions.length === 0) {
            return null;
        }

        const compositionId = this.pickWeightedComposition(context, validCompositions);
        return this.scaleComposition(DEFAULT_COMPOSITIONS[compositionId]);
    }

    /**
     * Personality-weighted pick (integer-scaled weights + game PRNG so the
     * choice stays deterministic across lockstep clients).
     */
    private pickWeightedComposition(context: SupabotContext, compositionIds: string[]): string {
        const weights = compositionIds.map((id) =>
            Math.max(1, Math.round((this.config.compositionWeights[id] ?? 1) * 10)),
        );
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let roll = context.game.generateRandomInt(0, totalWeight - 1);
        for (let i = 0; i < compositionIds.length; i++) {
            roll -= weights[i];
            if (roll < 0) {
                return compositionIds[i];
            }
        }
        return compositionIds[compositionIds.length - 1];
    }

    private scaleComposition(composition: SideComposition): SideComposition {
        const multiplier = this.config.armySizeMultiplier;
        if (multiplier === 1) {
            return composition;
        }
        const minimumUnits = Math.max(1, Math.round(composition.minimumUnits * multiplier));
        return {
            ...composition,
            minimumUnits,
            maximumUnits: Math.max(minimumUnits, Math.round(composition.maximumUnits * multiplier)),
        };
    }
}
