import { describe, expect, test } from "bun:test";
import { Game, GameStatus } from "@/game/Game";
import { Alliances } from "@/game/Alliances";
import { PlayerList } from "@/game/PlayerList";
import { TagRepeatType } from "@/data/map/tag/TagRepeatType";
import { TriggerActionType } from "@/data/map/trigger/TriggerActionType";
import { TriggerReader } from "@/data/map/trigger/TriggerReader";
import { IniSection } from "@/data/IniSection";
import { TriggerExecutorFactory } from "@/game/trigger/TriggerExecutorFactory";

function section(name: string, entries: Record<string, string> = {}): IniSection {
    const result = new IniSection(name);
    for (const [key, value] of Object.entries(entries)) {
        result.set(key, value);
    }
    return result;
}

function player(name: string, houseName: string): any {
    return {
        name,
        houseName,
        houseIndex: 0,
        mapHouse: { index: 0, name: houseName },
        startLocation: 0,
        country: {
            id: houseName,
            name: houseName,
            sideId: "gdi",
            isPlayable: () => true,
        },
        isNeutral: false,
        isObserver: false,
        isAi: false,
        defeated: false,
        isCombatant() {
            return !this.isNeutral && !this.isObserver && !this.defeated;
        },
        getOwnedObjects() {
            return [];
        },
        getOwnedObjectsByType() {
            return [];
        },
    };
}

function runtime(
    lifetime: TagRepeatType,
    campaignMode = true,
    options: { attached?: boolean; disabledSecond?: boolean } = {},
): { game: Game; player: any; tag: any; trigger: any; target: any } {
    const local = player("Player 1", "Player");
    const playerList = new PlayerList();
    playerList.addPlayer(local);
    const alliances = new Alliances(playerList);
    const tag: any = {
        id: "allow-tag",
        name: "Allow Tag",
        lifetime,
        repeatType: lifetime,
        triggerId: "T1",
    };
    const trigger: any = {
        id: "T1",
        name: "T1",
        houseName: "Player",
        disabled: false,
        difficulties: { easy: true, medium: true, hard: true },
        tag,
        events: [],
        actions: [{
            type: TriggerActionType.AllowWin,
            params: [0, 0, 0, 0, 0, 0, 0],
        }],
    };
    const second: any = options.attached ? {
        id: "T2",
        name: "T2",
        houseName: "Player",
        disabled: options.disabledSecond ?? true,
        difficulties: { easy: true, medium: true, hard: true },
        tag,
        attachedTrigger: undefined,
        events: [],
        actions: [],
    } : undefined;
    if (second) {
        trigger.attachedTrigger = second;
    }
    const target: any = {
        name: "Vehicle",
        type: 1,
        rx: 0,
        ry: 0,
        tag,
    };
    const map: any = {
        getInitialMapObjects: () => ({
            technos: [{ name: "Vehicle", type: 1, rx: 0, ry: 0, tag: tag.id }],
        }),
        getCellTags: () => [],
        getTags: () => [tag],
        getVariables: () => new Map(),
        getTriggers: () => second ? [trigger, second] : [trigger],
        tiles: { getByMapCoords: () => ({ rx: 0, ry: 0 }) },
        getObjectsOnTile: () => [target],
    };
    const game = new Game(
        {},
        map,
        {},
        {},
        {},
        1,
        2,
        {
            gameSpeed: 5,
            humanPlayers: [{ name: "Player 1" }],
            aiPlayers: [],
            credits: 0,
            shortGame: false,
        },
        0,
        playerList,
        {},
        alliances,
        { value: 1 },
        {},
        { update() { } },
    );
    game.campaignMode = campaignMode;
    game.status = GameStatus.Started;
    game.localPlayer = local;
    game.triggers.init(game);
    return { game, player: local, tag, trigger, target };
}

function triggerAction(actionType: TriggerActionType): any {
    return {
        type: actionType,
        triggerId: "T1",
        index: 0,
        params: [0, 0, 0, 0, 0, 0, 0],
    };
}

describe("stock Allow Win action", () => {
    test("parses action 15 without ending the mission when it runs", () => {
        const parsed = new TriggerReader().read(
            section("Triggers", { T1: "Player,,Test,0,1,1,1,0" }),
            section("Events"),
            section("Actions", { T1: "1,15,0,0,0,0,0,0,0" }),
            [{ id: "tag", name: "Test", triggerId: "T1", lifetime: TagRepeatType.Volatile }],
        );
        expect(parsed.unknownActionTypes.size).toBe(0);
        expect(parsed.triggers[0].actions[0].type).toBe(TriggerActionType.AllowWin);
        let ended = 0;
        new TriggerExecutorFactory().create(triggerAction(TriggerActionType.AllowWin), parsed.triggers[0])
            .execute({ end: () => ended++ } as any);
        expect(ended).toBe(0);
    });

    test("charges one hold during initialization and defers a campaign victory", () => {
        const { game, player: local } = runtime(TagRepeatType.Persistent);
        expect(game.triggers.getAllowWinHoldCount(local)).toBe(1);
        expect(game.triggers.captureState().allowWinHolds).toEqual([{ playerIndex: 0, count: 1 }]);
        game.win();
        expect(game.status).toBe(GameStatus.Started);
        expect(game.campaignResult).toBeUndefined();
        expect(game.pendingCampaignOutcome).toEqual({ kind: "win", house: local });
    });

    test("round-trips allow-win holds through the trigger snapshot and hash", () => {
        const source = runtime(TagRepeatType.Persistent);
        const snapshot = source.game.triggers.captureState();
        const target = runtime(TagRepeatType.Persistent);
        target.game.triggers.restoreState(snapshot, { strict: true });
        expect(target.game.triggers.captureState()).toEqual(snapshot);
        expect(target.game.triggers.getHash()).toBe(source.game.triggers.getHash());
    });

    test("Destroy Tag releases the hold while the trigger link is intact", () => {
        const { game, player: local, tag } = runtime(TagRepeatType.Persistent);
        game.win();
        game.triggers.destroyTag(tag.id);
        game.triggers.update(game);
        expect(game.triggers.getAllowWinHoldCount(local)).toBe(0);
        expect(game.status).toBe(GameStatus.Started);
        game.completePendingCampaignOutcome();
        expect(game.status).toBe(GameStatus.Ended);
        expect(game.campaignResult).toMatchObject({ outcome: "win", victory: true });
    });

    test("single-trigger volatile and semi-persistent firing retains the hold", () => {
        for (const lifetime of [TagRepeatType.Volatile, TagRepeatType.SemiPersistent]) {
            const { game, player: local, trigger } = runtime(lifetime);
            game.triggers.update(game);
            expect((game.triggers as any).triggerInstances.has(trigger.id)).toBe(false);
            expect(game.triggers.getAllowWinHoldCount(local)).toBe(1);
            game.win();
            expect(game.status).toBe(GameStatus.Started);
            expect(game.pendingCampaignOutcome?.kind).toBe("win");
        }
    });

    test("a chain releases when a linked trigger remains after the firing trigger", () => {
        const { game, player: local, trigger } = runtime(TagRepeatType.Volatile, true, {
            attached: true,
            disabledSecond: true,
        });
        game.triggers.update(game);
        expect(game.triggers.getAllowWinHoldCount(local)).toBe(0);
        expect((game.triggers as any).triggerInstances.has(trigger.id)).toBe(false);
    });

    test("persistent firing retains the hold and noncampaign victory ignores it", () => {
        const campaign = runtime(TagRepeatType.Persistent);
        campaign.game.triggers.update(campaign.game);
        expect(campaign.game.triggers.getAllowWinHoldCount(campaign.player)).toBe(1);
        campaign.game.win();
        expect(campaign.game.status).toBe(GameStatus.Started);

        const skirmish = runtime(TagRepeatType.Persistent, false);
        skirmish.game.triggers.update(skirmish.game);
        skirmish.game.win();
        expect(skirmish.game.status).toBe(GameStatus.Ended);
        expect(skirmish.game.campaignResult).toBeUndefined();
    });
});
