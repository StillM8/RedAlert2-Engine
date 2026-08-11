import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { InfDeathType } from "@/game/gameobject/infantry/InfDeathType";
import { getDeathAnim } from "@/game/gameobject/infantry/sequenceMap";
import { LocomotorFactory } from "@/game/gameobject/locomotor/LocomotorFactory";
import { LocomotorType } from "@/game/type/LocomotorType";
import { MovementZone } from "@/game/type/MovementZone";
import { AudioVisualRules } from "@/game/rules/AudioVisualRules";
import { TechnoRules } from "@/game/rules/TechnoRules";
import { WarheadRules } from "@/game/rules/WarheadRules";

function vehicleRules(section: IniSection): TechnoRules {
    return new TechnoRules(ObjectType.Vehicle, section, 0, {}, new ArmorRegistry());
}

describe("generic MO/Ares core rules compatibility", () => {
    test("canonicalizes MO's authored Subterannean spelling without changing the enum", () => {
        const section = new IniSection("SMIN");
        section.set("Locomotor", "{4A582741-9839-11d1-B709-00A024DDAFD1}");
        section.set("MovementZone", "Subterannean");

        expect(vehicleRules(section).movementZone).toBe(MovementZone.Subterranean);
    });

    test("keeps an unsupported locomotor explicit instead of coercing it to Chrono", () => {
        const section = new IniSection("MEGA");
        const clsid = "{55D141B8-DB94-11d1-AC98-006008055BB5}";
        section.set("Locomotor", clsid);

        const rules = vehicleRules(section);
        expect(rules.locomotor).toBe(LocomotorType.Unsupported);
        expect(rules.locomotor).not.toBe(LocomotorType.Chrono);
        expect(rules.locomotorClsId).toBe(clsid);
    });

    test("fails closed at the locomotor runtime boundary with the authored CLSID", () => {
        const clsid = "{4A582743-9839-11d1-B709-00A024DDAFD1}";
        const object = {
            name: "SMIN",
            rules: { locomotor: LocomotorType.Unsupported, locomotorClsId: clsid },
        };

        expect(() => new LocomotorFactory({} as any).create(object as any)).toThrow(
            `Unsupported locomotor CLSID "${clsid}" for "SMIN"`,
        );
    });

    test("accepts the vanilla YR InfDeath 8, 9, and 10 numeric values", () => {
        for (const value of [8, 9, 10]) {
            const section = new IniSection(`InfDeath${value}`);
            section.set("InfDeath", String(value));
            expect(new WarheadRules(section).infDeath).toBe(value);
        }
    });

    test("uses the configured YR/MO death animations for InfDeath 8, 9, and 10", () => {
        const section = new IniSection("AudioVisual");
        const general = new IniSection("General");
        general.set("InfantryVirus", "MO_VIRUS");
        general.set("InfantryMutate", "MO_MUTATE");
        general.set("InfantryBrute", "MO_BRUTE");
        const audioVisual = new AudioVisualRules().readIni(section, general);
        const unit = { audioVisual, animationNames: [] };

        expect(getDeathAnim(unit, InfDeathType.Virus)).toBe("MO_VIRUS");
        expect(getDeathAnim(unit, InfDeathType.Mutate)).toBe("MO_MUTATE");
        expect(getDeathAnim(unit, InfDeathType.Brute)).toBe("MO_BRUTE");
    });
});
