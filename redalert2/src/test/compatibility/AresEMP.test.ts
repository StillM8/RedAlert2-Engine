import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import {
    defaultAresEmpImmunity,
    parseAresEmpThreshold,
    resolveAresEmpCounter,
} from "@/extensions/ares/AresEMP";
import { EmpTrait } from "@/game/gameobject/trait/EmpTrait";
import { VeteranAbility } from "@/game/gameobject/unit/VeteranAbility";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { IniSection } from "@/data/IniSection";
import { WarheadRules } from "@/game/rules/WarheadRules";

function disableable(initial = false) {
    let disabled = initial;
    return {
        isDisabled: () => disabled,
        setDisabled: (value: boolean) => {
            disabled = value;
        },
    };
}

describe("Ares EMP rules", () => {
    test("matches documented positive and negative counter semantics", () => {
        expect(resolveAresEmpCounter(0, 10, 20)).toBe(10);
        expect(resolveAresEmpCounter(15, 10, 20)).toBe(20);
        expect(resolveAresEmpCounter(60, 10, 20)).toBe(60);
        expect(resolveAresEmpCounter(25, 10, 0)).toBe(35);
        expect(resolveAresEmpCounter(5, 10, -1)).toBe(10);
        expect(resolveAresEmpCounter(20, 10, -1)).toBe(20);

        expect(resolveAresEmpCounter(50, -10, -1)).toBe(40);
        expect(resolveAresEmpCounter(7, -10, -1)).toBe(0);
        expect(resolveAresEmpCounter(50, -10, 20)).toBe(20);
        expect(resolveAresEmpCounter(7, -10, 20)).toBe(0);
        expect(resolveAresEmpCounter(50, -10, 0)).toBe(0);
        expect(resolveAresEmpCounter(20, 10, 20, 0.5)).toBe(20);
    });

    test("parses EMP threshold aliases without losing numeric values", () => {
        expect(parseAresEmpThreshold(undefined)).toBe(-1);
        expect(parseAresEmpThreshold("yes")).toBe(1);
        expect(parseAresEmpThreshold("NO")).toBe(0);
        expect(parseAresEmpThreshold("inair")).toBe(-1);
        expect(parseAresEmpThreshold("17")).toBe(17);
        expect(parseAresEmpThreshold("not-a-threshold")).toBe(-1);
    });

    test("calculates Ares default immunity by Techno category and function", () => {
        expect(defaultAresEmpImmunity({
            type: ObjectType.Building,
            powered: false,
            power: 0,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: false,
            organic: false,
        })).toBe(true);
        expect(defaultAresEmpImmunity({
            type: ObjectType.Building,
            powered: true,
            power: -100,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: false,
            organic: false,
        })).toBe(false);
        expect(defaultAresEmpImmunity({
            type: ObjectType.Infantry,
            powered: false,
            power: 0,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: false,
            organic: true,
        })).toBe(true);
        expect(defaultAresEmpImmunity({
            type: ObjectType.Infantry,
            powered: false,
            power: 0,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: true,
            organic: true,
        })).toBe(false);
        expect(defaultAresEmpImmunity({
            type: ObjectType.Vehicle,
            powered: false,
            power: 0,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: false,
            organic: true,
        })).toBe(true);
    });

    test("parses warhead EMP duration and cap independently of legacy EMEffect", () => {
        const section = new IniSection("EMPWH");
        section.set("EMEffect", "yes");
        section.set("EMP.Duration", "150");
        section.set("EMP.Cap", "300");
        section.set("AffectsEnemies", "no");
        const rules = new WarheadRules(section);
        expect(rules.emEffect).toBe(true);
        expect(rules.empDuration).toBe(150);
        expect(rules.empCap).toBe(300);
        expect(rules.affectsEnemies).toBe(false);
    });

    test("paralyzes movement and attack, counts down, and restores prior disable state", () => {
        const moveTrait = disableable(true);
        const attackTrait = disableable(false);
        const obj: any = {
            rules: { immuneToEMP: false },
            moveTrait,
            attackTrait,
            isAircraft: () => false,
        };
        const emp = new EmpTrait(obj);

        expect(emp.apply(3, -1)).toBe(true);
        expect(emp.isUnderEMP()).toBe(true);
        expect(emp.getRemainingFrames()).toBe(3);
        expect(moveTrait.isDisabled()).toBe(true);
        expect(attackTrait.isDisabled()).toBe(true);

        emp[NotifyTick.onTick](obj, undefined);
        emp[NotifyTick.onTick](obj, undefined);
        expect(emp.getRemainingFrames()).toBe(1);
        emp[NotifyTick.onTick](obj, undefined);

        expect(emp.isUnderEMP()).toBe(false);
        expect(moveTrait.isDisabled()).toBe(true);
        expect(attackTrait.isDisabled()).toBe(false);
        expect(emp.debugGetState()).toEqual({ remainingFrames: 0, underEMP: false });
    });

    test("respects explicit and veteran EMP immunity", () => {
        const explicit: any = {
            rules: { immuneToEMP: true },
            moveTrait: disableable(),
            attackTrait: disableable(),
            isAircraft: () => false,
        };
        expect(new EmpTrait(explicit).apply(10, -1)).toBe(false);

        const veteran: any = {
            rules: { immuneToEMP: false },
            veteranTrait: {
                hasVeteranAbility: (ability: VeteranAbility) => ability === VeteranAbility.EMPIMMUNE,
            },
            moveTrait: disableable(),
            attackTrait: disableable(),
            isAircraft: () => false,
        };
        expect(new EmpTrait(veteran).apply(10, -1)).toBe(false);
    });
});

