import { describe, expect, test } from "bun:test";
import { applyAresChronoPrison } from "@/extensions/ares/AresChronoPrisonIntegration";
import { VeteranAbility } from "@/game/gameobject/unit/VeteranAbility";

function weapon() {
    return {
        aresChronoPrison: {
            abductor: true,
            temporal: false,
            changeOwner: true,
            abductBelowPercent: 1,
            maxHealth: 0,
        },
    };
}

function target(owner: any, psionicsImmune: boolean): any {
    return {
        owner,
        isSpawned: true,
        isDestroyed: false,
        isCrashing: false,
        limboData: undefined,
        tile: { rx: 4, ry: 5 },
        rules: {
            size: 1,
            immuneToPsionics: false,
            aresChronoPrison: { immuneToAbduction: false, passengerTurret: false },
        },
        healthTrait: {
            maxHitPoints: 100,
            getHitPoints: () => 100,
        },
        veteranTrait: {
            hasVeteranAbility: (ability: VeteranAbility) =>
                psionicsImmune && ability === VeteranAbility.PSIONICS_IMMUNE,
        },
        invulnerableTrait: { isActive: () => false },
        isUnit: () => true,
    };
}

function harness(psionicsImmune: boolean) {
    const attackerOwner = { id: "attacker" };
    const victimOwner = { id: "victim" };
    const victim = target(victimOwner, psionicsImmune);
    const attacker: any = {
        owner: attackerOwner,
        rules: { sizeLimit: 3 },
        transportTrait: {
            units: [] as any[],
            getMaxCapacity: () => 5,
            getOccupiedCapacity: () => 0,
        },
    };
    let ownerChanges = 0;
    const world: any = {
        events: { dispatch: () => undefined },
        limboObject: (object: any, limboData: any) => { object.limboData = limboData; object.isSpawned = false; },
        changeObjectOwner: (object: any, owner: any) => { ownerChanges++; object.owner = owner; },
        getUnitSelection: () => undefined,
    };
    return { attacker, victim, attackerOwner, victimOwner, world, ownerChanges: () => ownerChanges };
}

describe("Ares Chrono Prison psionics immunity", () => {
    test("PSIONICSIMMUNE veteran ability prevents ChangeOwner but not abduction", () => {
        const { attacker, victim, victimOwner, world, ownerChanges } = harness(true);
        const decision = applyAresChronoPrison(attacker, victim, weapon(), world);

        expect(decision.eligible).toBe(true);
        expect(decision.changeOwner).toBe(false);
        expect(attacker.transportTrait.units).toEqual([victim]);
        expect(victim.owner).toBe(victimOwner);
        expect(ownerChanges()).toBe(0);
    });

    test("non-immune target is transferred when Abductor.ChangeOwner=yes", () => {
        const { attacker, victim, attackerOwner, world, ownerChanges } = harness(false);
        const decision = applyAresChronoPrison(attacker, victim, weapon(), world);

        expect(decision.eligible).toBe(true);
        expect(decision.changeOwner).toBe(true);
        expect(victim.owner).toBe(attackerOwner);
        expect(ownerChanges()).toBe(1);
    });
});
