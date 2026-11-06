import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmedTrait } from "@/game/gameobject/trait/ArmedTrait";
import { IdleActionTrait } from "@/game/gameobject/trait/IdleActionTrait";
import { ScatterTask } from "@/game/gameobject/task/ScatterTask";
import { TechnoRules } from "@/game/rules/TechnoRules";

function infantry(name: string, values: Record<string, string> = {}): TechnoRules {
    const section = new IniSection(name);
    for (const [key, value] of Object.entries(values)) {
        section.set(key, value);
    }
    return new TechnoRules(ObjectType.Infantry, section, 0, {}, new ArmorRegistry());
}

describe("Ares hard-coded unit properties", () => {
    test("defaults only COW and DESO and honors explicit opt-out", () => {
        expect([infantry("E1").isCow, infantry("E1").isDesolator]).toEqual([false, false]);
        expect([infantry("COW").isCow, infantry("COW").isDesolator]).toEqual([true, false]);
        expect([infantry("DESO").isCow, infantry("DESO").isDesolator]).toEqual([false, true]);
        expect(infantry("COW", { IsCow: "no" }).isCow).toBe(false);
        expect(infantry("DESO", { IsDesolator: "no" }).isDesolator).toBe(false);
        expect([infantry("MOCOW", { IsCow: "yes" }).isCow, infantry("SUNRAY", { IsDesolator: "yes" }).isDesolator]).toEqual([true, true]);

        const vehicle = new TechnoRules(ObjectType.Vehicle, new IniSection("COW"), 0, {}, new ArmorRegistry());
        expect([vehicle.isCow, vehicle.isDesolator]).toEqual([false, false]);
    });

    test("uses the secondary weapon for opted-in deployable infantry", () => {
        const secondaryWeapon = { name: "Secondary" };
        const armed = {
            gameObject: {
                rules: {
                    isDesolator: true,
                    deployFire: true,
                    deployFireWeapon: 0,
                },
            },
            secondaryWeapon,
        };

        expect(ArmedTrait.prototype.getDeployFireWeapon.call(armed)).toBe(secondaryWeapon);
    });

    test("gives opted-in cow infantry idle and random movement behavior", () => {
        const tasks: any[] = [];
        const infantryObject = {
            isInfantry: () => true,
            rules: { isCow: true, fraidycat: false },
            unitOrderTrait: { addTask: (task: any) => tasks.push(task) },
        };
        const world = { generateRandom: () => 0.9 };
        const trait = new IdleActionTrait();

        trait.doIdleAction(infantryObject as any, world as any);

        expect(trait.actionDueThisTick()).toBe(true);
        expect(tasks[0]).toBeInstanceOf(ScatterTask);
    });
});
