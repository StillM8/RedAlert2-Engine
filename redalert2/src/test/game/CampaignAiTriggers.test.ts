import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { TriggerActionType } from "@/data/map/trigger/TriggerActionType";
import { GameApi } from "@/game/api/GameApi";
import { Prng } from "@/game/Prng";
import { SideType } from "@/game/SideType";
import { AttackMissionFactory } from "@/game/ai/thirdpartbot/builtIn/bot/logic/mission/missions/attackMission";
import { DefaultStrategy } from "@/game/ai/thirdpartbot/builtIn/bot/strategy/defaultStrategy";
import { PlayerFactory } from "@/game/player/PlayerFactory";
import { TriggerExecutorFactory } from "@/game/trigger/TriggerExecutorFactory";
import { NoActionExecutor } from "@/game/trigger/executor/NoActionExecutor";

function country(id: string, name: string, neutral = false): any {
    return {
        id,
        name,
        sideId: neutral ? "civilian" : "gdi",
        side: neutral ? SideType.Civilian : SideType.GDI,
        isPlayable: () => !neutral,
    };
}

function rules(): any {
    return {
        general: { maximumQueuedObjects: 5 },
        mpDialogSettings: { techLevel: 9 },
        colors: new Map([["Blue", {}], ["LightGrey", {}]]),
        getNeutralCountry: () => country("civilian", "Civilian", true),
    };
}

function createPlayer(factory: PlayerFactory, name: string, houseName: string, enabled?: boolean): any {
    return factory.createCombatant(
        name,
        country(houseName, houseName),
        0,
        {},
        true,
        1,
        undefined,
        {
            houseName,
            aiTriggersEnabled: enabled,
        },
    );
}

function action(type: TriggerActionType, houseName: string): any {
    return {
        type,
        triggerId: "T",
        index: 0,
        params: [0, houseName, 0, 0, 0, 0, 0],
    };
}

function execute(type: TriggerActionType, houseName: string, players: any[]): void {
    new TriggerExecutorFactory().create(action(type, houseName), {
        id: "T",
        name: "T",
        houseName,
    }).execute({ getAllPlayers: () => players });
}

describe("campaign AI trigger gates", () => {
    test("defaults campaign gates off, supports explicit enablement, and defaults skirmish on", () => {
        const campaignFactory = new PlayerFactory(rules(), {}, [], undefined, true);
        const skirmishFactory = new PlayerFactory(rules(), {}, [], undefined, false);
        const campaign = createPlayer(campaignFactory, "Campaign", "Alpha");
        const explicitCampaign = createPlayer(campaignFactory, "Explicit", "Beta", true);
        const skirmish = createPlayer(skirmishFactory, "Skirmish", "Gamma");
        expect(campaign.aiTriggersEnabled).toBe(false);
        expect(explicitCampaign.aiTriggersEnabled).toBe(true);
        expect(skirmish.aiTriggersEnabled).toBe(true);
    });

    test("actions 74 and 75 gate only the selected house and action 13 remains a no-op", () => {
        const factory = new PlayerFactory(rules(), {}, [], undefined, true);
        const alpha = createPlayer(factory, "Alpha AI", "Alpha");
        const beta = createPlayer(factory, "Beta AI", "Beta");
        const players = [alpha, beta];
        expect([alpha.aiTriggersEnabled, beta.aiTriggersEnabled]).toEqual([false, false]);
        execute(TriggerActionType.AITriggersBegin, "Alpha", players);
        expect([alpha.aiTriggersEnabled, beta.aiTriggersEnabled]).toEqual([true, false]);
        execute(TriggerActionType.AITriggersBegin, "Beta", players);
        execute(TriggerActionType.AITriggersStop, "Alpha", players);
        expect([alpha.aiTriggersEnabled, beta.aiTriggersEnabled]).toEqual([false, true]);
        execute(TriggerActionType.AITriggersStop, "Beta", players);
        const before = [alpha.aiTriggersEnabled, beta.aiTriggersEnabled];
        const executor = new TriggerExecutorFactory().create(
            action(TriggerActionType.AutocreateBegins, "Alpha"),
            { name: "T" },
        );
        expect(executor).toBeInstanceOf(NoActionExecutor);
        executor.execute({ getAllPlayers: () => players });
        expect([alpha.aiTriggersEnabled, beta.aiTriggersEnabled]).toEqual(before);
    });

    test("IgnoreGlobalAITriggers bypasses the global database but keeps the bounded fallback", () => {
        const metadataApi = new GameApi({
            ignoreGlobalAITriggers: false,
            map: { ignoreGlobalAITriggers: true },
            rules: {},
        } as any, true);
        expect(metadataApi.shouldIgnoreGlobalAITriggers()).toBe(true);
        const fallback = { composition: { E1: 1 }, minimumUnits: 1, maximumUnits: 1 };
        let eligibleCalls = 0;
        const triggerDb = {
            getEligibleAttackTriggers: () => {
                eligibleCalls++;
                return [];
            },
        };
        const context: any = {
            game: {
                getPlayerData: () => ({
                    name: "AI",
                    country: { side: SideType.GDI },
                    aiTriggersEnabled: true,
                }),
                shouldIgnoreGlobalAITriggers: () => true,
            },
            player: {
                name: "AI",
                production: { getAvailableObjects: () => [{ name: "E1" }] },
            },
        };
        const picked = (new AttackMissionFactory(undefined, triggerDb as any) as any)
            .pickComposition(context, fallback, () => {});
        expect(picked).toEqual({ composition: fallback, triggerEntry: null });
        expect(eligibleCalls).toBe(0);
    });

    test("the attack factory skips disabled campaign composition and launches the fallback once enabled", () => {
        const playerData: any = {
            name: "AI",
            country: { side: SideType.GDI },
            startLocation: { x: 1, y: 1 },
            isCombatant: true,
            credits: 0,
            power: { total: 0, drain: 0, isLowPower: false },
            aiTriggersEnabled: false,
        };
        const target: any = {
            id: 1,
            owner: "Enemy",
            type: ObjectType.Infantry,
            rules: { name: "E1" },
            tile: { rx: 4, ry: 4 },
            maxHitPoints: 100,
        };
        let randomCalls = 0;
        let missionAdds = 0;
        const game: any = {
            getPlayerData: (name: string) => name === "AI"
                ? playerData
                : {
                    name: "Enemy",
                    country: { side: SideType.Nod },
                    startLocation: { x: 4, y: 4 },
                    isCombatant: true,
                    credits: 0,
                    power: { total: 0, drain: 0, isLowPower: false },
                },
            getCurrentTick: () => 0,
            getPlayers: () => ["AI", "Enemy"],
            areAlliedPlayers: () => false,
            getVisibleUnits: (_name: string, type: string) => type === "enemy" ? [1] : [],
            getGameObjectData: () => target,
            generateRandomInt: (min: number) => {
                randomCalls++;
                return min;
            },
            shouldIgnoreGlobalAITriggers: () => false,
        };
        const context: any = {
            game,
            player: { name: "AI", actions: {}, production: {} },
            matchAwareness: {
                getMainRallyPoint: () => ({ x: 1, y: 1 }),
                getHostilesNearPoint2d: () => [],
            },
        };
        const missions: any = {
            getMissions: () => [],
            addMission: () => {
                missionAdds++;
                return true;
            },
        };
        const fallback = { composition: { E1: 1 }, minimumUnits: 1, maximumUnits: 1 };
        const factory = new AttackMissionFactory(undefined, null);
        factory.maybeCreateMissions(context, missions, () => {}, fallback);
        expect(missionAdds).toBe(0);
        expect(randomCalls).toBe(0);
        playerData.aiTriggersEnabled = true;
        factory.maybeCreateMissions(context, missions, () => {}, fallback);
        expect(missionAdds).toBe(1);
        expect(randomCalls).toBe(2);
    });

    test("a disabled campaign gate does not consume PRNG before its action 74 continuation", () => {
        const strategy = new DefaultStrategy();
        const campaignPrng = new Prng(0x12345678);
        const skirmishPrng = new Prng(0x12345678);
        const campaignState = { enabled: false };
        const makeContext = (prng: Prng, state: { enabled: boolean }): any => ({
            game: {
                getPlayerData: () => ({
                    name: "AI",
                    country: { side: SideType.GDI },
                    aiTriggersEnabled: state.enabled,
                }),
                generateRandomInt: (min: number, max: number) => prng.generateRandomInt(min, max),
            },
            player: {
                name: "AI",
                production: { getAvailableObjects: () => [{ name: "E1" }] },
            },
        });
        const initialCampaignState = campaignPrng.captureState();
        for (let index = 0; index < 5; index++) {
            expect((strategy as any).selectRandomAttackComposition(
                makeContext(campaignPrng, campaignState),
                () => {},
            )).toBeNull();
        }
        expect(campaignPrng.captureState()).toEqual(initialCampaignState);
        campaignState.enabled = true;
        const campaignSelection = (strategy as any).selectRandomAttackComposition(
            makeContext(campaignPrng, campaignState),
            () => {},
        );
        const skirmishSelection = (strategy as any).selectRandomAttackComposition(
            makeContext(skirmishPrng, { enabled: true }),
            () => {},
        );
        expect(campaignSelection).toEqual(skirmishSelection);
        expect(campaignPrng.generateRandom()).toBe(skirmishPrng.generateRandom());
    });
});
