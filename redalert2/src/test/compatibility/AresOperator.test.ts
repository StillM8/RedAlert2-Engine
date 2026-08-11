import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { isAresOperatorSatisfied, AresOperatorTrait } from "@/game/gameobject/trait/AresOperatorTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { TechnoRules } from "@/game/rules/TechnoRules";

function infantry(name: string): any {
    return { name, isInfantry: () => true };
}

function disableable(initial = false): any {
    return {
        disabled: initial,
        isDisabled() { return this.disabled; },
        setDisabled(value: boolean) { this.disabled = value; },
    };
}

describe("Ares Operator", () => {
    test("parses specific operators and the _ANY_ sentinel", () => {
        const specificSection = new IniSection("OperatorVehicle");
        specificSection.set("Operator", "Driver,Commander");
        const specific = new TechnoRules(ObjectType.Vehicle, specificSection, 0, {}, new ArmorRegistry());
        expect(specific.operator).toEqual(["Driver", "Commander"]);
        expect(specific.operatorAny).toBe(false);

        const anySection = new IniSection("AnyOperatorVehicle");
        anySection.set("Operator", "_ANY_");
        const any = new TechnoRules(ObjectType.Vehicle, anySection, 0, {}, new ArmorRegistry());
        expect(any.operator).toEqual([]);
        expect(any.operatorAny).toBe(true);
    });

    test("evaluates specific and any operators from transport or garrison passengers", () => {
        const driver = infantry("Driver");
        const commander = infantry("Commander");
        expect(isAresOperatorSatisfied({
            operator: ["driver"],
            operatorAny: false,
            transportTrait: { units: [commander, driver] },
        })).toBe(true);
        expect(isAresOperatorSatisfied({
            operator: ["driver"],
            operatorAny: false,
            garrisonTrait: { units: [commander] },
        })).toBe(false);
        expect(isAresOperatorSatisfied({
            operator: [],
            operatorAny: true,
            garrisonTrait: { units: [commander] },
        })).toBe(true);
    });

    test("disables movement and weapons until the required operator boards", () => {
        const cancelled: number[] = [];
        const host: any = {
            isSpawned: true,
            isDestroyed: false,
            isCrashing: false,
            rules: { operator: ["Driver"], operatorAny: false },
            transportTrait: { units: [] },
            moveTrait: disableable(),
            attackTrait: disableable(),
            unitOrderTrait: { getTasks: () => [{ cancel: () => cancelled.push(1) }] },
        };
        const trait = new AresOperatorTrait();

        trait[NotifyTick.onTick](host);
        expect(trait.isOffline()).toBe(true);
        expect(host.moveTrait.isDisabled()).toBe(true);
        expect(host.attackTrait.isDisabled()).toBe(true);
        expect(cancelled).toHaveLength(1);

        host.transportTrait.units = [infantry("driver")];
        trait[NotifyTick.onTick](host);
        expect(trait.isOffline()).toBe(false);
        expect(host.moveTrait.isDisabled()).toBe(false);
        expect(host.attackTrait.isDisabled()).toBe(false);
    });

    test("does not wake an operator unit while another suppressor is active", () => {
        const host: any = {
            isSpawned: true,
            isDestroyed: false,
            isCrashing: false,
            rules: { operator: ["Driver"], operatorAny: false },
            transportTrait: { units: [] },
            moveTrait: disableable(),
            attackTrait: disableable(),
            unitOrderTrait: { getTasks: () => [] },
            empTrait: { isUnderEMP: () => true },
            robotControlTrait: { isOffline: () => false },
            magnetizedTrait: { isActive: () => false },
            parasiteableTrait: { isParalyzed: () => false },
        };
        const trait = new AresOperatorTrait();
        trait[NotifyTick.onTick](host);
        host.transportTrait.units = [infantry("Driver")];
        trait[NotifyTick.onTick](host);
        expect(trait.isOffline()).toBe(false);
        expect(host.moveTrait.isDisabled()).toBe(true);
        expect(host.attackTrait.isDisabled()).toBe(true);
    });

    test("scanner classifies Operator independently", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rules-extra.ini",
            contents: "[OperatorVehicle]\nOperator=Driver\n",
        }]);
        const usage = report.featureUsage.find(item => item.featureId === "ares.operator");
        expect(usage?.occurrences).toBe(1);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
