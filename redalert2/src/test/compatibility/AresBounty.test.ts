import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import {
    awardAresBounty,
    parseAresBountyGeneralRules,
    parseAresBountyTechnoRules,
    resolveAresBountyAward,
    selectAresBountyValue,
} from "@/extensions/ares/AresBounty";
import { Game } from "@/game/Game";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { EventType } from "@/game/event/EventType";
import { AudioVisualRules } from "@/game/rules/AudioVisualRules";
import { TechnoRules } from "@/game/rules/TechnoRules";

function player(name: string, givesBounty = true, credits = 0): any {
    return {
        name,
        credits,
        country: { givesBounty, id: name },
        isNeutral: false,
        isCombatant: () => true,
        addUnitsKilled() { },
        addUnitsLost() { },
        getOwnedObjectsByType() { return []; },
        removeOwnedObject() { },
    };
}

function techno(owner: any, rules: any, veteranLevel = VeteranLevel.None): any {
    return {
        owner,
        rules: { points: 0, dontScore: false, insignificant: false, ...rules },
        type: ObjectType.Vehicle,
        veteranLevel,
        isTechno: () => true,
        isBuilding: () => false,
        isSpawned: false,
        limboData: {},
        healthTrait: { health: 100 },
        traits: { filter: () => [] },
        onDestroy() { },
        dispose() { },
    };
}

function gameFor(hunter: any, victim: any): any {
    const game = Object.create(Game.prototype) as Game;
    game.rules = { general: { bountyEnablers: [] } };
    game.alliances = { areAllied: () => false };
    game.traits = { filter: () => [] };
    game.events = { dispatch: () => { } };
    game.areFriendly = (source: any, target: any) => source.owner === target.owner;
    hunter.player = hunter.owner;
    return game;
}

describe("Ares Bounty", () => {
    test("normalizes omitted values and preserves authored zero and negative tiers", () => {
        const omitted = parseAresBountyTechnoRules(new IniSection("Vanilla"));
        expect(omitted).toBeUndefined();

        const section = new IniSection("BountyVictim");
        section.set("Bounty.Value", "0");
        section.set("Bounty.RookieValue", "-25");
        section.set("Bounty.VeteranValue", "0");
        section.set("Bounty.EliteValue", "125");
        const rules = parseAresBountyTechnoRules(section)!;

        expect(rules.value).toBe(0);
        expect(selectAresBountyValue(rules, VeteranLevel.None)).toBe(-25);
        expect(selectAresBountyValue(rules, VeteranLevel.Veteran)).toBe(0);
        expect(selectAresBountyValue(rules, VeteranLevel.Elite)).toBe(125);
    });

    test("uses Bounty.Value as the default for all authored rank tiers", () => {
        const section = new IniSection("FlatBounty");
        section.set("Bounty", "yes");
        section.set("Bounty.Value", "40");
        const rules = parseAresBountyTechnoRules(section)!;
        expect(rules).toMatchObject({
            enabled: true,
            value: 40,
            rookieValue: 40,
            veteranValue: 40,
            eliteValue: 40,
        });
    });

    test("parses the global enabler list and AudioVisual default", () => {
        const general = new IniSection("General");
        general.set("BountyEnablers", "MOHQ, ACADEMY, none");
        expect(parseAresBountyGeneralRules(general)).toEqual({ enablers: ["MOHQ", "ACADEMY"] });

        const audiovisual = new IniSection("AudioVisual");
        audiovisual.set("BountyDisplay", "yes");
        expect(new AudioVisualRules().readIni(audiovisual).bountyDisplay).toBe(true);
    });

    test("exposes normalized TechnoRules bounty data without changing vanilla rules", () => {
        const section = new IniSection("BountyHunter");
        section.set("Bounty", "yes");
        section.set("Bounty.Display", "no");
        const rules = new TechnoRules(ObjectType.Vehicle, section, 0, {}, new ArmorRegistry());
        expect(rules.aresBounty).toMatchObject({ enabled: true, display: false, value: 0 });

        const vanilla = new TechnoRules(ObjectType.Vehicle, new IniSection("Vanilla"), 0, {}, new ArmorRegistry());
        expect(vanilla.aresBounty).toBeUndefined();
    });

    test("awards bounty through the actual Game destruction path for weapon kills", () => {
        const hunterOwner = player("Hunter", true, 100);
        const victimOwner = player("Victim");
        const hunter = techno(hunterOwner, {
            aresBounty: { enabled: true, value: 0, rookieValue: 0, veteranValue: 0, eliteValue: 0 },
        });
        const victim = techno(victimOwner, {
            aresBounty: { enabled: false, value: 75, rookieValue: 75, veteranValue: 150, eliteValue: 300 },
        }, VeteranLevel.Veteran);
        const game = gameFor(hunter, victim);

        game.destroyObject(victim, { player: hunterOwner, obj: hunter, weapon: {} });

        expect(hunterOwner.credits).toBe(250);
        expect(victim.isDestroyed).toBe(true);
    });

    test("awards bounty through the actual Game destruction path for crush kills", () => {
        const hunterOwner = player("Crusher", true, 100);
        const victimOwner = player("Victim");
        const hunter = techno(hunterOwner, {
            aresBounty: { enabled: true, value: 0, rookieValue: 0, veteranValue: 0, eliteValue: 0 },
        });
        const victim = techno(victimOwner, {
            aresBounty: { enabled: false, value: -50, rookieValue: -50, veteranValue: -50, eliteValue: -50 },
        });
        const game = gameFor(hunter, victim);

        game.destroyObject(victim, { player: hunterOwner, obj: hunter });

        expect(hunterOwner.credits).toBe(50);
    });

    test("honors enabler, country, and ally gates and clamps negative credits", () => {
        const hunterOwner = player("Hunter", true, 10);
        const victimOwner = player("Victim", true);
        const victim = techno(victimOwner, {
            aresBounty: { enabled: false, value: -50, rookieValue: -50, veteranValue: -50, eliteValue: -50 },
        });
        const hunter = techno(hunterOwner, {
            aresBounty: { enabled: true, value: 0, rookieValue: 0, veteranValue: 0, eliteValue: 0 },
        });
        const game = gameFor(hunter, victim);
        game.rules.general.bountyEnablers = ["BOUNTY_BUILDING"];
        expect(awardAresBounty(game, { player: hunterOwner, obj: hunter }, victim)).toBe(0);

        hunterOwner.getOwnedObjectsByType = () => [{ name: "BOUNTY_BUILDING" }];
        victimOwner.country.givesBounty = false;
        expect(awardAresBounty(game, { player: hunterOwner, obj: hunter }, victim)).toBe(0);

        victimOwner.country.givesBounty = true;
        game.areFriendly = () => true;
        expect(awardAresBounty(game, { player: hunterOwner, obj: hunter }, victim)).toBe(0);

        game.areFriendly = () => false;
        expect(awardAresBounty(game, { player: hunterOwner, obj: hunter }, victim)).toBe(-50);
        expect(hunterOwner.credits).toBe(0);
    });

    test("publishes a display event from the actual destruction path", () => {
        const hunterOwner = player("Hunter", true, 100);
        const victimOwner = player("Victim");
        const hunter = techno(hunterOwner, {
            aresBounty: { enabled: true, value: 0, rookieValue: 0, veteranValue: 0, eliteValue: 0 },
        });
        const victim = techno(victimOwner, {
            aresBounty: { enabled: false, value: 75, rookieValue: 75, veteranValue: 150, eliteValue: 300 },
        }, VeteranLevel.Veteran);
        victim.position = {
            worldPosition: {
                clone: () => ({ x: 12, y: 0, z: 34 }),
            },
        };
        const game = gameFor(hunter, victim);
        game.rules.audioVisual = { bountyDisplay: true };
        const events: any[] = [];
        game.events = { dispatch: (event: any) => events.push(event) };

        const resolved = resolveAresBountyAward(game, { player: hunterOwner, obj: hunter }, victim);
        expect(resolved).toMatchObject({ amount: 150, display: true });

        game.destroyObject(victim, { player: hunterOwner, obj: hunter });

        const event = events.find(candidate => candidate.type === EventType.AresBountyAward);
        expect(event).toMatchObject({
            player: hunterOwner,
            source: hunter,
            target: victim,
            amount: 150,
            position: { x: 12, y: 0, z: 34 },
        });
        expect(hunterOwner.credits).toBe(250);
    });
});
