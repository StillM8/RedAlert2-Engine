import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { ObjectType } from "@/engine/type/ObjectType";
import { parseAresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import { ObjectFactory } from "@/game/gameobject/ObjectFactory";

function createUnit(): any {
    const section = new IniSection("AttachEffectUnit");
    section.set("AttachEffect.Duration", "3");
    section.set("AttachEffect.SpeedMultiplier", "0.75");
    const unitRules: any = {
        underwater: false,
        weight: 1,
        naval: false,
        crashable: false,
        crewed: false,
        harvester: false,
        passengers: false,
        gunner: false,
        openTopped: false,
        turret: false,
        consideredAircraft: false,
        landable: true,
        parasiteable: false,
        locomotor: undefined,
        explodes: false,
        radarInvisible: false,
        c4: false,
        crusher: false,
        defaultToGuardArea: false,
        cost: 1,
        ammo: -1,
        strength: 100,
        immuneToPsionics: true,
        poweredUnit: false,
        aresAttachEffect: parseAresAttachEffectDefinition(section),
    };
    const rulesIni: any = {
        general: { shipSinkingWeight: 100 },
        audioVisual: { conditionYellow: 0.5, conditionRed: 0.25 },
        combatDamage: { bridgeStrength: 1 },
        getObject: () => unitRules,
        getOverlayId: () => 0,
    };
    const artIni: any = { getObject: () => ({ isVoxel: false }) };
    return new ObjectFactory({}, {}, {}, { value: 1 })
        .create(ObjectType.Vehicle, "AttachEffectUnit", rulesIni, artIni);
}

describe("Ares AttachEffect ObjectFactory registration", () => {
    test("registers a generic automatic TechnoType effect and applies it on spawn", () => {
        const unit = createUnit();

        expect(unit.aresAttachEffectTrait).toBeInstanceOf(AresAttachEffectTrait);
        expect(unit.traits.filter(AresAttachEffectTrait)).toHaveLength(1);
        expect(unit.aresAttachEffectTrait.getState()).toEqual([]);

        unit.onSpawn({});

        expect(unit.aresAttachEffectTrait.getState()).toMatchObject([
            { effectId: "AttachEffectUnit", remainingFrames: 3 },
        ]);
        expect(unit.aresAttachEffectTrait.getAggregateMultipliers().speed).toBe(0.75);
    });
});
