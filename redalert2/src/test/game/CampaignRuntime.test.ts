import { describe, expect, test } from "bun:test";
import { MapFile } from "@/data/MapFile";
import { Alliances } from "@/game/Alliances";
import { Game, GameStatus } from "@/game/Game";
import { PlayerFactory } from "@/game/player/PlayerFactory";
import { PlayerList } from "@/game/PlayerList";
import { Production } from "@/game/player/production/Production";
import { validateCampaignMapSupport } from "@/engine/MapSupport";
import { getCampaignSession } from "@/game/gameopts/GameOpts";

function country(id: string, name: string, neutral = false): any {
    return {
        id,
        name,
        sideId: neutral ? "civilian" : "gdi",
        side: neutral ? 3 : 0,
        isPlayable: () => !neutral,
    };
}

function player(name: string, houseName: string, countryId: string, startLocation: number, neutral = false): any {
    return {
        name,
        houseName,
        houseIndex: startLocation,
        mapHouse: { index: startLocation, name: houseName },
        startLocation,
        country: country(countryId, houseName, neutral),
        isNeutral: neutral,
        isObserver: false,
        defeated: false,
        isCombatant() {
            return !this.isNeutral && !this.defeated;
        },
        getOwnedObjects() {
            return [];
        },
    };
}

function runtime(players: any[], triggers: any[] = []): Game {
    const playerList = new PlayerList();
    players.forEach((entry) => playerList.addPlayer(entry));
    const alliances = new Alliances(playerList);
    const game = new Game(
        {},
        { getTriggers: () => triggers },
        {},
        {},
        {},
        1,
        2,
        { gameSpeed: 5, humanPlayers: [], aiPlayers: [], credits: 0 },
        0,
        playerList,
        {},
        alliances,
        { value: 1 },
        {},
        { update() { } },
    );
    game.campaignMode = true;
    game.status = GameStatus.Started;
    game.localPlayer = players[0];
    return game;
}

describe("campaign map parsing", () => {
    test("parses FAEARTH basic and house metadata including high waypoints", () => {
        const map = new MapFile({
            Basic: {
                Player: "Player",
                HomeCell: "99",
                AltHomeCell: "98",
                Theme: "Ambient",
                NextScenario: "M2",
                AltNextScenario: "M2A",
                EndOfGame: "no",
                SkipScore: "yes",
                OneTimeOnly: "1",
                IgnoreGlobalAITriggers: "yes",
                NewINIFormat: "4",
            },
            Houses: {
                "0": "Player",
                "1": "Enemy",
            },
            Player: {
                Country: "Americans",
                Credits: "1234",
                TechLevel: "5",
                PlayerControl: "1",
                Allies: "Enemy",
            },
            Enemy: {
                Country: "Russians",
                Credits: "50",
                TechLevel: "2",
                PercentBuilt: "50",
                NodeCount: "3",
            },
            SpecialFlags: {
                FixedAlliance: "1",
            },
            Waypoints: {
                "98": "100002",
                "99": "100003",
            },
        } as any);

        expect(map.player).toBe("Player");
        expect(map.homeCell).toBe(99);
        expect(map.altHomeCell).toBe(98);
        expect(map.theme).toBe("Ambient");
        expect(map.nextScenario).toBe("M2");
        expect(map.altNextScenario).toBe("M2A");
        expect(map.iniFormat).toBe(4);
        expect(map.endOfGame).toBe(false);
        expect(map.skipScore).toBe(true);
        expect(map.oneTimeOnly).toBe(true);
        expect(map.ignoreGlobalAITriggers).toBe(true);
        expect(map.specialFlags.fixedAlliance).toBe(true);
        expect(map.houses[0]).toMatchObject({
            name: "Player",
            country: "Americans",
            credits: 1234,
            techLevel: 5,
            playerControl: true,
            allies: ["Enemy"],
        });
        expect(map.houses[1]).toMatchObject({ percentBuilt: 50, nodeCount: 3 });
        expect(map.getHomeLocation()).toEqual({ x: 3, y: 100 });
        expect(map.getHomeLocation(true)).toEqual({ x: 2, y: 100 });
    });
});

describe("campaign player runtime", () => {
    test("applies house credits, tech level, start point, and production gate", () => {
        const rules: any = {
            general: { maximumQueuedObjects: 5 },
            mpDialogSettings: { techLevel: 9 },
            colors: new Map([["Blue", {}], ["LightGrey", {}]]),
            getNeutralCountry: () => country("civilian", "Civilian", true),
        };
        const factory = new PlayerFactory(rules, {}, [], undefined);
        const player = factory.createCombatant(
            "Hero",
            country("americans", "Americans"),
            99,
            {},
            false,
            undefined,
            undefined,
            {
                houseName: "Player",
                houseIndex: 0,
                mapHouse: { name: "Player", credits: 321, techLevel: 4 },
                credits: 321,
                techLevel: 4,
                productionEnabled: false,
                startLocation: { x: 3, y: 100 },
            },
        );

        expect(player.credits).toBe(321);
        expect(player.startLocation).toBe(99);
        expect(player.startLocationPoint).toEqual({ x: 3, y: 100 });
        expect(player.techLevel).toBe(4);
        expect(player.productionEnabled).toBe(false);
        expect(player.production?.isProductionEnabled()).toBe(false);
        player.productionEnabled = true;
        expect(player.production?.isProductionEnabled()).toBe(true);

        const campaignCountry = { ...country("americans", "Americans"), isPlayable: () => false };
        const campaignPlayer = factory.createCombatant(
            "Campaign",
            campaignCountry as any,
            0,
            {},
            false,
            undefined,
            undefined,
            { isCombatant: true },
        );
        expect(campaignPlayer.isNeutral).toBe(false);
    });

    test("keeps skirmish production enabled and applies authored alliances", () => {
        const rules: any = {
            general: { maximumQueuedObjects: 5 },
            mpDialogSettings: { techLevel: 9 },
            colors: new Map([["LightGrey", {}]]),
            getNeutralCountry: () => country("civilian", "Civilian", true),
        };
        const createdPlayer = new PlayerFactory(rules, {}, [], undefined).createCombatant(
            "Skirmish",
            country("americans", "Americans"),
            0,
            {},
            false,
            undefined,
        );
        expect(createdPlayer.production?.isProductionEnabled()).toBe(true);

        const players = [player("A", "A", "americans", 0), player("B", "B", "russians", 1)];
        const list = new PlayerList();
        players.forEach((entry) => list.addPlayer(entry));
        const alliances = new Alliances(list);
        alliances.setFixedAlliance(true);
        alliances.forceAlliance(players[0], players[1]);
        expect(alliances.isFixedAlliance()).toBe(true);
        expect(alliances.areAllied(players[0], players[1])).toBe(true);
        expect(() => alliances.breakAlliance(players[0], players[1])).toThrow();
    });
});

describe("campaign session contract", () => {
    test("does not treat a map marker as a session object", () => {
        const map = new MapFile({ Basic: { Player: "Player" } } as any);
        expect(getCampaignSession(map)).toBeUndefined();
        expect(getCampaignSession({ isCampaign: true })).toBeUndefined();
        expect(getCampaignSession({ campaign: { mapFile: "m1", scenario: "s1", battleId: "b1" } })?.mapName).toBe("m1");
    });
});

describe("campaign outcomes and ownership", () => {
    test("resolves house, country, numeric, and neutral owners in order", () => {
        const human = player("Player 1", "Player", "americans", 99);
        human.houseIndex = 0;
        human.mapHouse.index = 0;
        const enemy = player("Enemy", "Enemy", "russians", 98);
        const neutral = player("@@NEUTRAL@@", "Neutral", "civilian", 0, true);
        const game = runtime([human, enemy, neutral]);

        expect(game.resolveMapOwner("Enemy")).toBe(enemy);
        expect(game.resolveMapOwner("russians")).toBe(enemy);
        expect(game.resolveMapOwner("0")).toBe(human);
        expect(game.resolveMapOwner("Neutral")).toBe(neutral);
        expect(game.resolveMapOwner("unknown")).toBeUndefined();
    });

    test("keeps authored outcomes out of ordinary defeat and carries next mission state", () => {
        const human = player("Player 1", "Player", "americans", 99);
        const enemy = player("Enemy", "Enemy", "russians", 98);
        const game = runtime([human, enemy], [{ actions: [{ type: 1 }] }]);
        let assetsDeleted = false;
        human.getOwnedObjects = () => [{ isDestroyed: false }];
        game.removeAllPlayerAssets = () => {
            assetsDeleted = true;
        };
        game.configureCampaign({
            isCampaign: true,
            nextScenario: "M2",
            altNextScenario: "M2A",
            endOfGame: false,
            skipScore: true,
            specialFlags: { fixedAlliance: false },
        }, { globalVariables: { "1": true } }, true);
        game.checkGameEndConditions();
        expect(assetsDeleted).toBe(false);
        game.win("Enemy");
        expect(game.status).toBe(GameStatus.Ended);
        expect(game.campaignResult).toMatchObject({
            outcome: "win",
            victory: false,
            scripted: true,
            nextScenario: "M2A",
            altNextScenario: "M2A",
            skipScore: true,
        });
        expect(game.getCampaignState()).toMatchObject({ nextScenario: "M2", altNextScenario: "M2A" });
    });

    test("maps trigger Win/Lose/ForceEnd context outcomes", () => {
        const human = player("Player 1", "Player", "americans", 99);
        const enemy = player("Enemy", "Enemy", "russians", 98);
        const win = runtime([human, enemy]);
        win.triggerOutcome = { outcome: "lost", player: "Enemy" };
        win.end();
        expect(win.campaignResult).toMatchObject({ outcome: "lose", victory: true });

        const force = runtime([human, enemy], [{ actions: [{ type: 69 }] }]);
        force.end();
        expect(force.campaignResult).toMatchObject({ outcome: "force-end", scripted: true });
    });
});

describe("campaign map support", () => {
    test("accepts one-human high-home missions and rejects multiple humans", () => {
        const translator: any = { get: (key: string) => key };
        const map = new MapFile({
            Basic: { Player: "Player", HomeCell: "99", NewINIFormat: "4" },
            Houses: { "0": "Player" },
            Player: { Country: "Americans", PlayerControl: "1" },
            Waypoints: { "99": "100003" },
        } as any);
        expect(validateCampaignMapSupport(map, translator)).toBeUndefined();

        const invalid = new MapFile({
            Basic: { Player: "Player", HomeCell: "99", NewINIFormat: "4" },
            Houses: { "0": "Player", "1": "Other" },
            Player: { Country: "Americans", PlayerControl: "1" },
            Other: { Country: "Russians", PlayerControl: "1" },
            Waypoints: { "99": "100003" },
        } as any);
        expect(validateCampaignMapSupport(invalid, translator)).toBe("TS:MapCampaignRequiresOneHuman");
    });
});

test("production action flag is reflected by the production service", () => {
    const owner: any = { buildings: new Set(), country: country("americans", "Americans") };
    const production = new Production(owner, 9, {}, {
        general: { maximumQueuedObjects: 5 },
        mpDialogSettings: { techLevel: 9 },
    } as any, [], undefined, false);
    expect(production.isProductionEnabled()).toBe(false);
    owner.productionEnabled = true;
    expect(production.isProductionEnabled()).toBe(true);
});
