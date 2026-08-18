import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import { registerAresPassengerRules } from "@/extensions/ares/AresPassengers";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { VeteranTrait } from "@/game/gameobject/trait/VeteranTrait";

function veteranRules() {
    return {
        veteranRatio: 1,
        veteranCap: VeteranLevel.Elite,
        veteranSpeed: 1,
        veteranArmor: 1,
        veteranCombat: 1,
        veteranROF: 1,
        veteranSight: 1,
    };
}

function techno(name: string, trainable = true, initialLevel = VeteranLevel.None): any {
    const object: any = {
        name,
        rules: {
            name,
            cost: 50,
            trainable,
            veteranAbilities: new Set(),
            eliteAbilities: new Set(),
        },
        traits: {
            find: () => undefined,
            add: () => undefined,
            getAll: () => [],
        },
        unitOrderTrait: { isIdle: () => false },
        isTechno: () => true,
        isInfantry: () => false,
        resetGuardModeToIdle: () => undefined,
    };
    const trait = new VeteranTrait(object, veteranRules());
    if (initialLevel !== VeteranLevel.None) {
        (trait as any).setVeteranLevel(initialLevel);
    }
    object.veteranTrait = trait;
    Object.defineProperty(object, "veteranLevel", {
        get: () => (trait as any).veteranLevel,
    });
    return object;
}

function gameManager(): any {
    return {
        rules: { general: { cloakDelay: 0 } },
        events: { dispatch: () => undefined },
        addObjectTrait: () => undefined,
        areFriendly: () => false,
    };
}

describe("Ares Promote.IncludePassengers", () => {
    test("mirrors transport rank to every trainable passenger and discards passenger XP", () => {
        const carrier = techno("Carrier");
        const veteranPassenger = techno("VeteranPassenger", true, VeteranLevel.Elite);
        const rookiePassenger = techno("RookiePassenger", true);
        const untrainablePassenger = techno("UntrainablePassenger", false, VeteranLevel.Elite);
        carrier.transportTrait = {
            units: [veteranPassenger, rookiePassenger, untrainablePassenger],
        };

        const ini = new IniSection("Carrier");
        ini.set("Promote.IncludePassengers", "yes");
        registerAresPassengerRules(carrier.rules, ini);

        // Give the elite passenger residual XP; Ares rank mirroring discards it.
        (veteranPassenger.veteranTrait as any).xp = 17;
        carrier.veteranTrait.promote(1, gameManager());

        expect(carrier.veteranLevel).toBe(VeteranLevel.Veteran);
        expect(veteranPassenger.veteranLevel).toBe(VeteranLevel.Veteran);
        expect((veteranPassenger.veteranTrait as any).xp).toBe(0);
        expect(rookiePassenger.veteranLevel).toBe(VeteranLevel.Veteran);
        expect(untrainablePassenger.veteranLevel).toBe(VeteranLevel.Elite);
    });

    test("does not mirror rank when the Ares flag is absent", () => {
        const carrier = techno("Carrier");
        const passenger = techno("Passenger");
        carrier.transportTrait = { units: [passenger] };

        carrier.veteranTrait.promote(1, gameManager());
        expect(carrier.veteranLevel).toBe(VeteranLevel.Veteran);
        expect(passenger.veteranLevel).toBe(VeteranLevel.None);
    });
});
