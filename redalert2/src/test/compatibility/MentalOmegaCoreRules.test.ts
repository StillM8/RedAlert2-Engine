import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { InfDeathType } from "@/game/gameobject/infantry/InfDeathType";
import { getDeathAnim } from "@/game/gameobject/infantry/sequenceMap";
import { LocomotorFactory } from "@/game/gameobject/locomotor/LocomotorFactory";
import { TunnelLocomotor } from "@/game/gameobject/locomotor/TunnelLocomotor";
import { EventType } from "@/game/event/EventType";
import { Vector2 } from "@/game/math/Vector2";
import { Vector3 } from "@/game/math/Vector3";
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

    test("resolves the standard Ares Mech CLSID without coercing it to Chrono", () => {
        const section = new IniSection("MEGA");
        const clsid = "{55D141B8-DB94-11d1-AC98-006008055BB5}";
        section.set("Locomotor", clsid);

        const rules = vehicleRules(section);
        expect(rules.locomotor).toBe(LocomotorType.Mech);
        expect(rules.locomotor).not.toBe(LocomotorType.Chrono);
        expect(rules.locomotorClsId).toBe(clsid);
    });

    test("creates the standard Ares Tunnel locomotor from its CLSID", () => {
        const clsid = "{4A582743-9839-11d1-B709-00A024DDAFD1}";
        const object = {
            name: "SMIN",
            rules: { locomotor: LocomotorType.Tunnel, locomotorClsId: clsid },
        };

        expect(new LocomotorFactory({} as any).create(object as any).constructor.name).toBe("TunnelLocomotor");
    });

    test("resolves CLSIDs case-insensitively and preserves authored casing", () => {
        const clsid = "{55d141b8-db94-11d1-ac98-006008055bb5}";
        const section = new IniSection("MEGA");
        section.set("Locomotor", clsid);

        const rules = vehicleRules(section);
        expect(rules.locomotor).toBe(LocomotorType.Mech);
        expect(rules.locomotorClsId).toBe(clsid);
    });

    test("uses generic Ares dig presentation and TunnelSpeed for elevation transitions", () => {
        const dispatched: any[] = [];
        const game = {
            rules: {
                general: { tunnelSpeed: 1 },
                audioVisual: { dig: "DIG", digSound: "Dummy" },
            },
            events: { dispatch: (event: any) => dispatched.push(event) },
            map: { tileOccupation: { getBridgeOnTile: () => undefined } },
        };
        const unit: any = {
            tile: { rx: 0, ry: 0, z: 0 },
            owner: { id: 7 },
            direction: 0,
            onBridge: false,
            rules: {
                accelerates: false,
                rot: 0,
                digIn: "MO_DIG_IN",
                digOut: "MO_DIG_OUT",
                digInSound: "MO_DIG_IN_SOUND",
                digOutSound: "MO_DIG_OUT_SOUND",
            },
            position: {
                tileElevation: 0,
                worldPosition: new Vector3(),
                getMapPosition: () => new Vector2(),
            },
            moveTrait: { baseSpeed: 256, speedPenalty: 0, velocity: new Vector3() },
        };
        const locomotor = new TunnelLocomotor(game as any);
        locomotor.selectNextWaypoint(unit, [{ tile: { rx: 12, ry: 0 } }]);

        const digIn = locomotor.tick(unit, new Vector2(12 * 256, 0), new Vector2(12 * 256, 0));
        expect(digIn.done).toBe(false);
        expect(digIn.distance.y).toBeLessThan(0);
        expect(dispatched.map((event) => event.type)).toEqual([
            EventType.TriggerAnim,
            EventType.TriggerSoundFx,
        ]);
        expect(dispatched[0].name).toBe("MO_DIG_IN");
        expect(dispatched[1].soundId).toBe("MO_DIG_IN_SOUND");

        unit.position.tileElevation = -256;
        const digOut = locomotor.tick(unit, new Vector2(), new Vector2(), true);
        expect(digOut.done).toBe(false);
        expect(digOut.distance.y).toBeGreaterThan(0);
        expect(dispatched[2].name).toBe("MO_DIG_OUT");
        expect(dispatched[3].soundId).toBe("MO_DIG_OUT_SOUND");
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
