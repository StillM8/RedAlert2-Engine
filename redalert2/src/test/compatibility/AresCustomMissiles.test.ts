import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { parseAresCustomMissileRules, resolveAresCustomMissilePayload } from "@/extensions/ares/AresCustomMissiles";
import { AirSpawnTrait } from "@/game/gameobject/trait/AirSpawnTrait";

describe("Ares custom missiles", () => {
    test("uses documented zero RocketStruct defaults and presentation defaults", () => {
        const section = new IniSection("CUSTOMMISSILE");
        section.set("Missile.Custom", "yes");
        const rules = parseAresCustomMissileRules(section);
        expect(rules.custom).toBe(true);
        expect(rules.pauseFrames).toBe(0);
        expect(rules.tiltFrames).toBe(0);
        expect(rules.pitchInitial).toBe(0);
        expect(rules.pitchFinal).toBe(0);
        expect(rules.turnRate).toBe(0);
        expect(rules.raiseRate).toBe(0);
        expect(rules.acceleration).toBe(0);
        expect(rules.altitude).toBe(0);
        expect(rules.damage).toBe(0);
        expect(rules.eliteDamage).toBe(0);
        expect(rules.bodyLength).toBe(0);
        expect(rules.lazyCurve).toBe(false);
        expect(rules.takeOffAnim).toBe("V3TAKOFF");
        expect(rules.trailerAnim).toBe("V3TRAIL");
        expect(rules.trailerSeparation).toBe(3);
    });

    test("selects promoted weapon/warhead payload with Ares fallbacks", () => {
        const section = new IniSection("CUSTOMMISSILE");
        section.set("Missile.Custom", "yes");
        section.set("Missile.Damage", "100");
        section.set("Missile.EliteDamage", "250");
        section.set("Missile.Warhead", "WH1");
        section.set("Missile.Weapon", "W1");
        const rules = parseAresCustomMissileRules(section);
        expect(resolveAresCustomMissilePayload(rules, false)).toEqual({ damage: 100, warhead: "WH1", weapon: "W1" });
        expect(resolveAresCustomMissilePayload(rules, true)).toEqual({ damage: 250, warhead: "WH1", weapon: "W1" });
    });

    test("prepareLaunch accepts arbitrary custom missile and weapon payload", () => {
        const trait = new AirSpawnTrait();
        const custom = {
            custom: true, pauseFrames: 4, tiltFrames: 8, pitchInitial: 0.2, pitchFinal: 0.5,
            turnRate: 0.08, raiseRate: 1, acceleration: 0.4, altitude: 768, damage: 10,
            eliteDamage: 20, bodyLength: 128, lazyCurve: false, weapon: "PAYLOAD",
            takeOffAnim: "TAKEOFF", trailerAnim: "TRAIL", trailerSeparation: 2,
        };
        let configuredDamage = 0;
        let configuredWarhead: any;
        const spawn: any = {
            name: "MYMISSILE", ammo: 1, rules: { missileSpawn: true, aresCustomMissile: custom },
            missileSpawnTrait: {
                setDamage(value: number) { configuredDamage = value; return this; },
                setWarhead(value: any) { configuredWarhead = value; return this; },
                setLauncher() { return this; },
            },
        };
        trait.debugSetStorage(spawn, 1);
        const launcher: any = { rules: { spawns: "MYMISSILE" }, veteranTrait: { isElite: () => false } };
        const target: any = { tile: { rx: 1, ry: 2, z: 0 }, getBridge: () => undefined, getWorldCoords: () => ({ clone: () => ({}) }) };
        const world: any = {
            rules: {
                getWeapon: (name: string) => { expect(name).toBe("PAYLOAD"); return { damage: 321, warhead: "PAYLOADWH" }; },
                getWarhead: (name: string) => ({ name }),
                general: { getMissileRules: () => { throw new Error("custom missile must not use retail General missile rules"); } },
                combatDamage: {},
            },
        };
        expect(trait.prepareLaunch(launcher, target, world)).toBe(spawn);
        expect(configuredDamage).toBe(321);
        expect(configuredWarhead.rules?.name ?? configuredWarhead.rules?.id ?? configuredWarhead.rules).toBeDefined();
        expect(trait.isLaunchingMissiles()).toBe(true);
    });
});
