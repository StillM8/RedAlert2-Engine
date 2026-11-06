import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { AllianceStatus, Alliances } from "@/game/Alliances";
import { Game } from "@/game/Game";
import { PlayerList } from "@/game/PlayerList";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import {
    AresSpyEffectTrait,
    calculateAresStolenMoney,
    parseAresSpyEffectRules,
    resetAresBuildingSuperWeapons,
    resolveAresRevealedProductionRules,
} from "@/extensions/ares/AresSpyBehavior";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { getAresCapability } from "@/extensions/ares/AresFeatureCatalog";
import { createDefaultAresFeatureRegistry } from "@/extensions/ares/AresFeatureRegistry";
import { AgentTrait } from "@/game/gameobject/trait/AgentTrait";
import { NotifyDestroy } from "@/game/gameobject/trait/interface/NotifyDestroy";
import { NotifyOwnerChange } from "@/game/gameobject/trait/interface/NotifyOwnerChange";
import { NotifySell } from "@/game/gameobject/trait/interface/NotifySell";
import { PowerTrait } from "@/game/player/trait/PowerTrait";
import { Player } from "@/game/Player";
import { Production } from "@/game/player/production/Production";
import {
    ProductionQueue,
    QueueType,
} from "@/game/player/production/ProductionQueue";
import { FactoryType, TechnoRules } from "@/game/rules/TechnoRules";

function buildingRules(section: IniSection): TechnoRules {
    return new TechnoRules(ObjectType.Building, section, 0, { prism: { type: "" } }, new ArmorRegistry());
}

function queue(type: QueueType, rules?: any): ProductionQueue {
    const result = new ProductionQueue(type, 10, 10);
    if (rules) result.push(rules, 1, rules.cost ?? 100);
    return result;
}

function productionWithQueue(type: QueueType, rules?: any): Production {
    const result = new Production({ buildings: new Set() }, 9, {}, {}, []);
    result.addQueue(type, queue(type, rules));
    return result;
}

function productionSpy(): any {
    const calls = {
        stolen: [] as number[],
        veteran: [] as FactoryType[],
        revealed: [] as number[],
        cleared: 0,
    };
    return {
        calls,
        addStolenTech(value: number) {
            calls.stolen.push(value);
        },
        addVeteranType(value: FactoryType) {
            calls.veteran.push(value);
        },
        addRevealedFactory(value: number) {
            calls.revealed.push(value);
        },
        clearReverseEngineeredPlans() {
            calls.cleared++;
        },
    };
}

function world(players: any[] = []) {
    return {
        getCombatants: () => players,
        playerList: { getAll: () => players },
    };
}

function combatant(name: string): Player {
    return new Player(name, { isPlayable: () => true } as any);
}

function productionSpyGame(players: Player[]) {
    const playerList = new PlayerList();
    for (const player of players) playerList.addPlayer(player);
    const alliances = new Alliances(playerList);
    const game = new Game(
        {},
        {},
        {},
        {},
        {},
        1,
        1,
        { gameSpeed: 5, humanPlayers: [], aiPlayers: [] },
        0,
        playerList,
        {},
        alliances,
        { value: 1 },
        {},
        { update() { } },
    );
    game.rules = { general: {}, ai: { buildTech: [] } };
    return game;
}

describe("Ares spy behavior parser", () => {
    test("uses documented defaults and parses every authored field", () => {
        const defaults = buildingRules(new IniSection("Defaults"));
        expect(defaults.spyEffect).toEqual({
            custom: false,
            resetRadar: false,
            revealRadar: false,
            powerOutageDuration: 0,
            stolenMoneyAmount: 0,
            stolenMoneyPercentage: 0,
            resetSuperweapons: false,
            stolenTechIndex: 0,
            stolenTechIndexSet: false,
            unitVeterancy: false,
            revealProduction: false,
            undoReverseEngineer: false,
        });
        expect(defaults.spyEffectStolenTechIndex).toBe(0);

        const section = new IniSection("CustomSpyBuilding");
        section.set("SpyEffect.Custom", "yes");
        section.set("SpyEffect.ResetRadar", "yes");
        section.set("SpyEffect.RevealRadar", "yes");
        section.set("SpyEffect.PowerOutageDuration", "37");
        section.set("SpyEffect.StolenMoneyAmount", "500");
        section.set("SpyEffect.StolenMoneyPercentage", "25%");
        section.set("SpyEffect.ResetSuperweapons", "yes");
        section.set("SpyEffect.StolenTechIndex", "0");
        section.set("SpyEffect.UnitVeterancy", "yes");
        section.set("SpyEffect.RevealProduction", "yes");
        section.set("SpyEffect.UndoReverseEngineer", "yes");
        const parsed = buildingRules(section);
        expect(parsed.spyEffect).toEqual({
            custom: true,
            resetRadar: true,
            revealRadar: true,
            powerOutageDuration: 37,
            stolenMoneyAmount: 500,
            stolenMoneyPercentage: 0.25,
            resetSuperweapons: true,
            stolenTechIndex: 0,
            stolenTechIndexSet: true,
            unitVeterancy: true,
            revealProduction: true,
            undoReverseEngineer: true,
        });
    });

    test("fails closed for malformed numeric and boolean values", () => {
        const section = new IniSection("InvalidSpyBuilding");
        section.set("SpyEffect.Custom", "sometimes");
        section.set("SpyEffect.ResetRadar", "sometimes");
        section.set("SpyEffect.RevealRadar", "sometimes");
        section.set("SpyEffect.PowerOutageDuration", "-1");
        section.set("SpyEffect.StolenMoneyAmount", "1.5");
        section.set("SpyEffect.StolenMoneyPercentage", "101%");
        section.set("SpyEffect.ResetSuperweapons", "sometimes");
        section.set("SpyEffect.StolenTechIndex", "32");
        section.set("SpyEffect.UnitVeterancy", "sometimes");
        section.set("SpyEffect.RevealProduction", "sometimes");
        expect(parseAresSpyEffectRules(section)).toEqual({
            custom: false,
            resetRadar: false,
            revealRadar: false,
            powerOutageDuration: 0,
            stolenMoneyAmount: 0,
            stolenMoneyPercentage: 0,
            resetSuperweapons: false,
            stolenTechIndex: 0,
            stolenTechIndexSet: false,
            unitVeterancy: false,
            revealProduction: false,
            undoReverseEngineer: false,
        });
    });
});

describe("Ares spy infiltration policy", () => {
    test("Custom=no retains retail first-match precedence", () => {
        const reset: number[] = [];
        const blackouts: number[] = [];
        const production = productionSpy();
        const targetOwner = {
            buildings: new Set<any>(),
            credits: 1000,
            production,
            powerTrait: { setBlackoutFor: (frames: number) => blackouts.push(frames) },
        };
        const superWeapon = { resetTimer: () => { throw new Error("must not reset"); } };
        const target = {
            id: 1,
            name: "RetailPriority",
            owner: targetOwner,
            factoryTrait: { type: FactoryType.UnitType },
            superWeaponTraits: [{ name: "SW", getSuperWeapon: () => superWeapon }],
            rules: {
                spyEffectCustom: false,
                radar: true,
                power: 100,
                storage: 100,
                aiBasePlanningSide: 0,
            },
        };
        const agent = { owner: { credits: 0, production } };
        new AgentTrait().infiltrate(agent, target, {
            areFriendly: () => false,
            mapShroudTrait: { resetShroud: () => reset.push(1) },
            rules: {
                general: { spyPowerBlackout: 999, spyMoneyStealPercent: 0.5 },
                ai: { buildTech: ["RetailPriority"] },
            },
        });
        expect(reset).toEqual([1]);
        expect(blackouts).toEqual([]);
        expect(production.calls.stolen).toEqual([]);
        expect(production.calls.veteran).toEqual([]);
        expect(agent.owner.credits).toBe(0);
    });

    test("Custom=no keeps retail percentage theft", () => {
        const production = productionSpy();
        const targetOwner = { buildings: new Set<any>(), credits: 101, production };
        const agent = { owner: { credits: 0, production } };
        new AgentTrait().infiltrate(agent, {
            name: "Refinery",
            owner: targetOwner,
            rules: { radar: false, power: 0, storage: 1000 },
        }, {
            areFriendly: () => false,
            rules: { general: { spyMoneyStealPercent: 0.335 }, ai: { buildTech: [] } },
        });
        expect(targetOwner.credits).toBe(68);
        expect(agent.owner.credits).toBe(33);
    });

    test("Custom=yes ignores legacy categories unless custom fields enable them", () => {
        const production = productionSpy();
        const calls: string[] = [];
        const targetOwner = {
            buildings: new Set<any>(),
            credits: 1000,
            production: {
                ...production,
                clearReverseEngineeredPlans: () => calls.push("undo"),
            },
            powerTrait: { setBlackoutFor: () => calls.push("power") },
        };
        const target = {
            id: 2,
            name: "LegacyOnly",
            owner: targetOwner,
            factoryTrait: { type: FactoryType.UnitType },
            superWeaponTraits: [{ name: "SW", getSuperWeapon: () => ({ resetTimer: () => calls.push("sw") }) }],
            rules: {
                spyEffect: {
                    custom: true,
                    resetRadar: false,
                    revealRadar: false,
                    powerOutageDuration: 0,
                    stolenMoneyAmount: 0,
                    stolenMoneyPercentage: 0,
                    resetSuperweapons: false,
                    stolenTechIndex: 0,
                    stolenTechIndexSet: false,
                    unitVeterancy: false,
                    revealProduction: false,
                    undoReverseEngineer: false,
                },
                radar: true,
                power: 100,
                storage: 100,
                aiBasePlanningSide: 0,
            },
        };
        const agent = { owner: { credits: 0, production } };
        new AgentTrait().infiltrate(agent, target, {
            areFriendly: () => false,
            mapShroudTrait: { resetShroud: () => calls.push("radar") },
            rules: {
                general: { spyPowerBlackout: 999, spyMoneyStealPercent: 0.5 },
                ai: { buildTech: ["LegacyOnly"] },
            },
        });
        expect(calls).toEqual([]);
        expect(agent.owner.credits).toBe(0);
    });

    test("keeps radar reset and radar reveal independent", () => {
        const calls: string[] = [];
        const targetOwner = { buildings: new Set<any>(), credits: 0, production: productionSpy() };
        const infiltratorOwner = { buildings: new Set<any>(), credits: 0, production: productionSpy() };
        const target = {
            id: 5,
            owner: targetOwner,
            factoryTrait: undefined,
            rules: { radar: true },
        };
        const game = {
            mapShroudTrait: {
                resetShroud: () => calls.push("reset"),
                getPlayerShroud: (player: any) => player === targetOwner
                    ? { merge: () => calls.push("merge") }
                    : { merge: () => calls.push("merge"), invalidateFull: () => calls.push("invalidate") },
            },
        };
        const resetOnly = {
            ...parseAresSpyEffectRules(new IniSection("ResetOnly")),
            custom: true,
            resetRadar: true,
        };
        const revealOnly = {
            ...parseAresSpyEffectRules(new IniSection("RevealOnly")),
            custom: true,
            revealRadar: true,
        };
        new AgentTrait().infiltrate({ owner: infiltratorOwner }, {
            ...target,
            rules: { ...target.rules, spyEffect: resetOnly },
        }, { ...game, areFriendly: () => false, rules: { general: {}, ai: { buildTech: [] } } });
        expect(calls).toEqual(["reset"]);
        calls.length = 0;
        new AgentTrait().infiltrate({ owner: infiltratorOwner }, {
            ...target,
            rules: { ...target.rules, spyEffect: revealOnly },
        }, { ...game, areFriendly: () => false, rules: { general: {}, ai: { buildTech: [] } } });
        expect(calls).toEqual(["merge", "invalidate"]);
    });

    test("composes all enabled custom effects in deterministic order", () => {
        const order: string[] = [];
        const sourceShroud = { merge: () => order.push("merge") };
        const infiltratorShroud = { merge: () => order.push("merge"), invalidateFull: () => order.push("invalidate") };
        const targetProduction = {
            clearReverseEngineeredPlans: () => order.push("undo"),
        };
        const agentProduction = productionSpy();
        const superWeapons = [
            { resetTimer: () => order.push("sw1") },
            { resetTimer: () => order.push("sw2") },
        ];
        const targetOwner = {
            buildings: new Set<any>(),
            credits: 200,
            production: targetProduction,
            powerTrait: { setBlackoutFor: (frames: number) => order.push(`power:${frames}`) },
        };
        const target = {
            id: 17,
            name: "MultiEffect",
            isDestroyed: false,
            owner: targetOwner,
            factoryTrait: { type: FactoryType.InfantryType },
            superWeaponTraits: [
                { name: "SW1", getSuperWeapon: () => superWeapons[0] },
                { name: "SW2", getSuperWeapon: () => superWeapons[1] },
            ],
            rules: {
                spyEffect: {
                    custom: true,
                    resetRadar: true,
                    revealRadar: true,
                    powerOutageDuration: 37,
                    stolenMoneyAmount: 500,
                    stolenMoneyPercentage: 0.5,
                    resetSuperweapons: true,
                    stolenTechIndex: 7,
                    stolenTechIndexSet: true,
                    unitVeterancy: true,
                    revealProduction: true,
                    undoReverseEngineer: true,
                },
                radar: true,
            },
        };
        const agent = { owner: { credits: 0, production: agentProduction } };
        new AgentTrait().infiltrate(agent, target, {
            areFriendly: () => false,
            mapShroudTrait: {
                resetShroud: () => order.push("reset"),
                getPlayerShroud: (player: any) => player === targetOwner ? sourceShroud : infiltratorShroud,
            },
            rules: { general: { spyPowerBlackout: 999, spyMoneyStealPercent: 0.9 }, ai: { buildTech: [] } },
        });
        expect(order).toEqual([
            "reset",
            "power:37",
            "undo",
            "sw1",
            "sw2",
            "merge",
            "invalidate",
        ]);
        expect(agentProduction.calls.stolen).toEqual([7]);
        expect(agentProduction.calls.veteran).toEqual([FactoryType.InfantryType]);
        expect(agentProduction.calls.revealed).toEqual([17]);
        expect(targetOwner.credits).toBe(0);
        expect(agent.owner.credits).toBe(200);
    });

    test("uses an authored outage and restores power after its final frame", () => {
        const production = productionSpy();
        const owner: any = { buildings: new Set<any>(), credits: 0, production };
        const power = new PowerTrait(owner);
        let requestedOutage = 0;
        owner.powerTrait = {
            setBlackoutFor: (frames: number, context: any) => {
                requestedOutage = frames;
                power.setBlackoutFor(frames, context);
            },
        };
        const target = {
            id: 3,
            name: "Power",
            owner,
            rules: {
                spyEffectCustom: true,
                spyEffectPowerOutageDuration: 3,
            },
        };
        const powerWorld = { traits: { filter: () => [] }, events: { dispatch: () => undefined } };
        new AgentTrait().infiltrate({ owner: { credits: 0, production } }, target, {
            ...powerWorld,
            areFriendly: () => false,
            rules: { general: { spyPowerBlackout: 1000 }, ai: { buildTech: [] } },
        });
        expect(requestedOutage).toBe(3);
        expect(power.isLowPower()).toBe(true);
        power.updateBlackout({ traits: { filter: () => [] }, events: { dispatch: () => undefined } });
        power.updateBlackout({ traits: { filter: () => [] }, events: { dispatch: () => undefined } });
        expect(power.isLowPower()).toBe(true);
        power.updateBlackout({ traits: { filter: () => [] }, events: { dispatch: () => undefined } });
        expect(power.isLowPower()).toBe(false);
    });

    test("UnitVeterancy grants only land and infantry production", () => {
        const production = new Production({}, 9, {}, {}, []);
        const player: any = { production, country: { hasVeteranUnit: () => false } };
        const targetOwner = { buildings: new Set<any>(), credits: 0, production: productionSpy() };
        new AgentTrait().infiltrate({ owner: player }, {
            owner: targetOwner,
            factoryTrait: { type: FactoryType.UnitType },
            rules: { spyEffectCustom: true, spyEffectUnitVeterancy: true },
        }, {
            areFriendly: () => false,
            rules: { general: {}, ai: { buildTech: [] } },
        });
        expect(production.hasVeteranType(FactoryType.UnitType)).toBe(true);
        expect(Player.prototype.canProduceVeteran.call(player, {
            name: "FutureTank",
            type: ObjectType.Vehicle,
            naval: false,
        })).toBe(true);

        const navalProduction = new Production({}, 9, {}, {}, []);
        const navalPlayer: any = { production: navalProduction, country: { hasVeteranUnit: () => false } };
        new AgentTrait().infiltrate({ owner: navalPlayer }, {
            owner: targetOwner,
            factoryTrait: { type: FactoryType.NavalUnitType },
            rules: { spyEffectCustom: true, spyEffectUnitVeterancy: true },
        }, {
            areFriendly: () => false,
            rules: { general: {}, ai: { buildTech: [] } },
        });
        expect(navalProduction.hasVeteranType(FactoryType.NavalUnitType)).toBe(false);
        expect(Player.prototype.canProduceVeteran.call(navalPlayer, {
            name: "FutureShip",
            type: ObjectType.Vehicle,
            naval: true,
        })).toBe(false);
    });

    test("retains custom-only reverse engineering reset behavior", () => {
        for (const custom of [false, true]) {
            const production = productionSpy();
            const target = {
                rules: { spyEffectCustom: custom, spyEffectUndoReverseEngineer: true },
                owner: { production },
            };
            new AgentTrait().infiltrate({ owner: { production } }, target, {
                areFriendly: () => false,
                rules: { general: {}, ai: { buildTech: [] } },
            });
            expect(production.calls.cleared).toBe(custom ? 1 : 0);
        }
    });

    test("applies custom and retail effects to enemy game objects", () => {
        const source = combatant("Source");
        const enemy = combatant("Enemy");
        const sourceProduction = productionSpy();
        const enemyProduction = productionSpy();
        source.production = sourceProduction as any;
        enemy.production = enemyProduction as any;
        const reset: number[] = [];
        const game: any = productionSpyGame([source, enemy]);
        game.mapShroudTrait = { resetShroud: () => reset.push(1) };

        new AgentTrait().infiltrate({ owner: source }, {
            owner: enemy,
            rules: { spyEffectCustom: true, spyEffectUndoReverseEngineer: true },
        }, game);
        new AgentTrait().infiltrate({ owner: source }, {
            owner: enemy,
            rules: { radar: true, power: 0, storage: 0 },
        }, game);

        expect(enemyProduction.calls.cleared).toBe(1);
        expect(reset).toEqual([1]);
        expect(source.credits).toBe(0);
    });

    test("rejects allied and same-owner infiltration before applying policy", () => {
        const source = combatant("Source");
        const ally = combatant("Ally");
        const enemy = combatant("Enemy");
        const sourceProduction = productionSpy();
        const allyProduction = productionSpy();
        source.production = sourceProduction as any;
        ally.production = allyProduction as any;
        source.credits = 100;
        ally.credits = 100;
        const target = {
            rules: { spyEffectCustom: true, spyEffectStolenMoneyAmount: 100, radar: true },
            owner: ally,
        };
        const reset: number[] = [];
        const game: any = productionSpyGame([source, ally, enemy]);
        game.alliances.setAlliance(source, ally, AllianceStatus.Formed);
        game.mapShroudTrait = { resetShroud: () => reset.push(1) };

        new AgentTrait().infiltrate({ owner: source }, target, game);
        new AgentTrait().infiltrate({ owner: source }, { ...target, owner: source }, game);

        expect(source.credits).toBe(100);
        expect(ally.credits).toBe(100);
        expect(allyProduction.calls.cleared).toBe(0);
        expect(reset).toEqual([]);
    });
});

describe("Ares spy money and superweapons", () => {
    test("prefers fixed money, caps it, and otherwise floors the authored percentage", () => {
        expect(calculateAresStolenMoney(200, 500, 0.5)).toBe(200);
        expect(calculateAresStolenMoney(101, 0, 0.335)).toBe(33);
        expect(calculateAresStolenMoney(101, 0, -1)).toBe(0);
    });

    test("resets every direct and upgraded provider exactly once", () => {
        const resets = new Map<string, number>();
        const weapon = (name: string) => ({
            name,
            resetTimer: (value: any) => resets.set(name, value),
        });
        const weapons = new Map([
            ["SW1", weapon("SW1")],
            ["SW2", weapon("SW2")],
            ["UP1", weapon("UP1")],
        ]);
        const owner = {
            buildings: new Set<any>(),
            superWeaponsTrait: { get: (name: string) => weapons.get(name) },
        };
        const building = {
            owner,
            superWeaponTraits: [
                { name: "SW1", getSuperWeapon: () => weapons.get("SW1") },
                { name: "SW1", getSuperWeapon: () => weapons.get("SW1") },
                { name: "SW2", getSuperWeapon: () => weapons.get("SW2") },
            ],
            upgrades: [{ owner, rules: { superWeapon: "UP1" } }],
        };
        const game = { tick: 5 };
        expect(resetAresBuildingSuperWeapons(building, game)).toBe(3);
        expect([...resets.entries()].sort()).toEqual([
            ["SW1", game],
            ["SW2", game],
            ["UP1", game],
        ]);
    });
});

describe("Ares production reveal", () => {
    test("reveals only to the infiltrator and follows capture and destruction lifecycle", () => {
        const infantry = { name: "E1", type: ObjectType.Infantry };
        const targetOwner: any = {
            buildings: new Set(),
            credits: 0,
            production: productionWithQueue(QueueType.Infantry, infantry),
        };
        const viewer: any = { credits: 0, production: new Production({}, 9, {}, {}, []) };
        const ally: any = { credits: 0, production: new Production({}, 9, {}, {}, []) };
        const other: any = { credits: 0, production: new Production({}, 9, {}, {}, []) };
        const target: any = {
            id: 41,
            isDestroyed: false,
            owner: targetOwner,
            factoryTrait: { type: FactoryType.InfantryType },
            rules: { spyEffectCustom: true, spyEffectRevealProduction: true },
        };
        new AgentTrait().infiltrate({ owner: viewer }, target, {
            areFriendly: () => false,
            rules: { general: {}, ai: { buildTech: [] } },
        });
        expect(resolveAresRevealedProductionRules(target, viewer)).toBe(infantry);
        expect(resolveAresRevealedProductionRules(target, ally)).toBeUndefined();
        expect(resolveAresRevealedProductionRules(target, targetOwner)).toBeUndefined();

        const lifecycle = new AresSpyEffectTrait();
        target.owner = other;
        lifecycle[NotifyOwnerChange.onChange](target, targetOwner, world([viewer, ally, other]));
        expect(viewer.production.hasRevealedFactory(41)).toBe(true);

        target.owner = viewer;
        lifecycle[NotifyOwnerChange.onChange](target, other, world([viewer, ally, other]));
        expect(viewer.production.hasRevealedFactory(41)).toBe(false);

        ally.production.addRevealedFactory(41);
        lifecycle[NotifyDestroy.onDestroy](target, world([viewer, ally, other]));
        expect(ally.production.hasRevealedFactory(41)).toBe(false);

        viewer.production.addRevealedFactory(41);
        lifecycle[NotifySell.onSell](target, world([viewer, ally, other]));
        expect(viewer.production.hasRevealedFactory(41)).toBe(false);
    });

    test("hashes, snapshots, and strictly restores reveal state independent of insertion order", () => {
        const targetA: any = { id: 10, isDestroyed: false, isBuilding: () => true, owner: {} };
        const targetB: any = { id: 30, isDestroyed: false, isBuilding: () => true, owner: {} };
        const source = new Production({}, 9, {}, {}, []);
        source.addRevealedFactory(30);
        source.addRevealedFactory(10);
        const reordered = new Production({}, 9, {}, {}, []);
        reordered.addRevealedFactory(10);
        reordered.addRevealedFactory(30);
        expect(source.getHash()).toBe(reordered.getHash());
        const state = JSON.parse(JSON.stringify(source.captureState()));
        expect(state.revealedFactoryObjectIds).toEqual([10, 30]);

        const destination = new Production({}, 9, {}, {}, []);
        const context = {
            strict: true,
            resolveObjectById: (id: number) => [targetA, targetB].find(target => target.id === id),
        };
        destination.restoreDeterministicState(state, context);
        expect(destination.captureState()).toEqual(state);
        expect(destination.getHash()).toBe(source.getHash());

        const before = destination.captureState();
        const invalid = structuredClone(state);
        invalid.revealedFactoryObjectIds = [999];
        expect(() => destination.restoreDeterministicState(invalid, {
            strict: true,
            resolveObjectById: () => undefined,
        })).toThrow(/unresolved/);
        expect(destination.captureState()).toEqual(before);
    });
});

describe("Ares spy compatibility mappings", () => {
    test("classifies every documented BuildingType key and registers the capability", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rules.ini",
            contents: `
[BuildingTypes]
0=SpyBuilding
[SpyBuilding]
SpyEffect.Custom=yes
SpyEffect.ResetRadar=yes
SpyEffect.RevealRadar=yes
SpyEffect.PowerOutageDuration=100
SpyEffect.StolenMoneyAmount=500
SpyEffect.StolenMoneyPercentage=25%
SpyEffect.ResetSuperweapons=yes
SpyEffect.StolenTechIndex=2
SpyEffect.UnitVeterancy=yes
SpyEffect.RevealProduction=yes
`,
        }]);
        expect(report.featureUsage.find(usage => usage.featureId === "ares.spy-behavior")?.occurrences).toBe(10);
        expect(report.unclassifiedKeys).toBe(0);
        expect(createDefaultAresFeatureRegistry().get("ares.spy-behavior")).toMatchObject({
            parserImplemented: true,
            runtimeImplemented: true,
        });
        expect(getAresCapability("ares.spy-behavior")).toMatchObject({
            parserStatus: "complete",
            runtimeStatus: "complete",
            deterministic: true,
        });
    });
});
