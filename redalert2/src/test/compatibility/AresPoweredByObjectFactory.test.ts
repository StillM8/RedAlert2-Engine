import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { ObjectFactory } from "@/game/gameobject/ObjectFactory";
import { AresPoweredByTrait } from "@/game/gameobject/trait/AresPoweredByTrait";
import { RobotControlTrait } from "@/game/gameobject/trait/RobotControlTrait";

function rules(overrides: Record<string, any> = {}): any {
    return {
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
        ...overrides,
    };
}

function createUnit(unitRules: any): any {
    const rulesIni: any = {
        general: { shipSinkingWeight: 100 },
        audioVisual: { conditionYellow: 0.5, conditionRed: 0.25 },
        combatDamage: { bridgeStrength: 1 },
        getObject: () => unitRules,
        getOverlayId: () => 0,
    };
    const artIni: any = { getObject: () => ({ isVoxel: false }) };
    const nextObjectId = { value: 1 };
    return new ObjectFactory({}, {}, {}, nextObjectId)
        .create(ObjectType.Vehicle, "TestUnit", rulesIni, artIni);
}

describe("Ares PoweredBy ObjectFactory registration", () => {
    test("registers AresPoweredByTrait for a unit with PoweredBy providers", () => {
        const unit = createUnit({
            ...rules(),
            ares: { poweredBy: { providers: ["PowerCore"], relation: "any" } },
        });

        expect(unit.aresPoweredByTrait).toBeInstanceOf(AresPoweredByTrait);
        expect(unit.robotControlTrait).toBeUndefined();
        expect(unit.traits.filter(AresPoweredByTrait)).toHaveLength(1);
        expect(unit.traits.filter(RobotControlTrait)).toHaveLength(0);
    });

    test("keeps RobotControlTrait for vanilla PoweredUnit rules", () => {
        const unit = createUnit(rules({ poweredUnit: true }));

        expect(unit.robotControlTrait).toBeInstanceOf(RobotControlTrait);
        expect(unit.aresPoweredByTrait).toBeUndefined();
        expect(unit.traits.filter(RobotControlTrait)).toHaveLength(1);
        expect(unit.traits.filter(AresPoweredByTrait)).toHaveLength(0);
    });
});
