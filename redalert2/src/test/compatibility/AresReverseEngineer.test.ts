import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { AgentTrait } from "@/game/gameobject/trait/AgentTrait";
import { EnterRecyclerTask } from "@/game/gameobject/task/EnterRecyclerTask";
import { Production } from "@/game/player/production/Production";
import { TechnoRules } from "@/game/rules/TechnoRules";

function rules(type: ObjectType, section: IniSection): TechnoRules {
    return new TechnoRules(type, section, 0, {}, new ArmorRegistry());
}

function production(): any {
    const result = Object.create(Production.prototype) as any;
    result.reverseEngineeredPlans = new Set<string>();
    result.stolenTech = new Set();
    result.permanentFactoryOwnerPlans = new Set();
    result.player = { buildings: new Set() };
    return result;
}

describe("Ares Reverse Engineer", () => {
    test("parses facility, victim defaults, overrides, and spy reset flags", () => {
        const facilitySection = new IniSection("ReverseFacility");
        facilitySection.set("Grinding", "yes");
        facilitySection.set("ReverseEngineersVictims", "yes");
        facilitySection.set("SpyEffect.Custom", "yes");
        facilitySection.set("SpyEffect.UndoReverseEngineer", "yes");
        const facility = rules(ObjectType.Building, facilitySection);

        expect(facility.grinding).toBe(true);
        expect(facility.reverseEngineersVictims).toBe(true);
        expect(facility.spyEffectCustom).toBe(true);
        expect(facility.spyEffectUndoReverseEngineer).toBe(true);

        const defaultVictim = rules(ObjectType.Infantry, new IniSection("DefaultVictim"));
        expect(defaultVictim.canBeReversed).toBe(true);
        expect(defaultVictim.reversedAs).toBeUndefined();

        const overrideSection = new IniSection("OverrideVictim");
        overrideSection.set("CanBeReversed", "no");
        overrideSection.set("ReversedAs", "ARCH");
        const override = rules(ObjectType.Vehicle, overrideSection);
        expect(override.canBeReversed).toBe(false);
        expect(override.reversedAs).toBe("ARCH");

        const resetSection = new IniSection("ResetVictim");
        resetSection.set("ReversedAs", "none");
        expect(rules(ObjectType.Infantry, resetSection).reversedAs).toBeUndefined();
    });

    test("records a reverse plan through the actual recycler entry path", () => {
        const owner = { production: production() };
        const facility = {
            owner,
            rules: { grinding: true, cloning: false, reverseEngineersVictims: true },
            isDestroyed: false,
            buildStatus: 1,
        };
        const victim = {
            owner,
            rules: {
                movementZone: 0,
                locomotor: 0,
                engineer: false,
                canBeReversed: true,
                reversedAs: "ARCH",
                name: "AICLEG",
            },
            isInfantry: () => true,
            isVehicle: () => false,
        };
        const sold: any[] = [];
        const game = {
            sellTrait: {
                computeRefundValue: () => 0,
                sell: (object: any) => sold.push(object),
            },
            events: { dispatch: () => undefined },
        };

        const task = new EnterRecyclerTask(game, facility);
        expect(task.isAllowed(victim)).toBe(true);
        task.onEnter(victim);

        expect(owner.production.hasReverseEngineeredPlan("arch")).toBe(true);
        expect(sold).toEqual([victim]);
    });

    test("keeps ordinary grinding behavior when reverse engineering is not configured", () => {
        const owner = { production: production() };
        const facility = {
            owner,
            rules: { grinding: true, cloning: false, reverseEngineersVictims: false },
            isDestroyed: false,
            buildStatus: 1,
        };
        const victim = {
            owner,
            rules: {
                movementZone: 0,
                locomotor: 0,
                engineer: false,
                canBeReversed: true,
                reversedAs: undefined,
                name: "AICLEG",
            },
            isInfantry: () => true,
            isVehicle: () => false,
        };
        const sold: any[] = [];
        const game = {
            sellTrait: {
                computeRefundValue: () => 100,
                sell: (object: any) => sold.push(object),
            },
            events: { dispatch: () => undefined },
        };

        const task = new EnterRecyclerTask(game, facility);
        expect(task.isAllowed(victim)).toBe(true);
        task.onEnter(victim);

        expect(owner.production.getReverseEngineeredPlans()).toEqual([]);
        expect(sold).toEqual([victim]);
    });

    test("reverse plans bypass ordinary gates but retain factory and extension gates", () => {
        const state = production();
        state.player = {
            country: { name: "Alpha" },
            buildings: new Set(),
            isAi: false,
        };
        state.maxTechLevel = 1;
        state.gameOpts = { superWeapons: true };
        state.rules = {
            general: { genericPrerequisites: new Map(), genericPrerequisiteAlternates: new Map() },
        };
        state.hasFactoryFor = () => true;
        state.meetsPrerequisites = () => false;
        state.meetsStolenTech = () => false;
        state.addReverseEngineeredPlan("ARCH");

        const object = {
            name: "ARCH",
            techLevel: -1,
            buildLimit: 1,
            negativePrerequisite: [],
            requiredTheaters: [],
            isAvailableTo: () => false,
        };
        expect(state.isAvailableForProduction(object)).toBe(true);

        object.negativePrerequisite = ["YACOMD"];
        state.meetsReverseEngineeredPrerequisites = () => false;
        expect(state.isAvailableForProduction(object)).toBe(false);
    });

    test("serializes and restores reverse plans deterministically", () => {
        const source = production();
        source.addReverseEngineeredPlan(" arch ");
        source.addReverseEngineeredPlan("ARCH");
        const serialized = source.serializeState();

        expect(serialized.reverseEngineeredPlans).toEqual(["arch"]);

        const restored = production();
        restored.restoreState(serialized);
        expect(restored.hasReverseEngineeredPlan("ARCH")).toBe(true);
        expect(restored.serializeState()).toEqual(serialized);

        restored.clearReverseEngineeredPlans();
        expect(restored.hasReverseEngineeredPlan("ARCH")).toBe(false);
    });

    test("custom spy infiltration clears the infiltrated player's reverse plans", () => {
        const productionState = production();
        productionState.addReverseEngineeredPlan("ARCH");
        const targetOwner = {
            production: productionState,
            buildings: new Set(),
            credits: 0,
        };
        const agentOwner = { credits: 0 };
        const target = {
            owner: targetOwner,
            name: "NAPRIS",
            rules: {
                spyEffectCustom: true,
                spyEffectUndoReverseEngineer: true,
                radar: false,
                power: 0,
                storage: 0,
            },
        };

        new AgentTrait().infiltrate({ owner: agentOwner }, target, {
            rules: { ai: { buildTech: [] }, general: { spyPowerBlackout: 0, spyMoneyStealPercent: 0 } },
        });

        expect(productionState.hasReverseEngineeredPlan("ARCH")).toBe(false);
    });
});
