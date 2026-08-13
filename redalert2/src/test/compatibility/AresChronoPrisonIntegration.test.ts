import { describe, expect, test } from "bun:test";
import { EventType } from "@/game/event/EventType";
import { IniSection } from "@/data/IniSection";
import { WeaponRules } from "@/game/rules/WeaponRules";
import { applyAresChronoPrison } from "@/extensions/ares/AresChronoPrisonIntegration";
import { AresPassengerTurretTrait } from "@/game/gameobject/trait/AresPassengerTurretTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";

function makeWorld(events: any[]) {
    return {
        events: { dispatch: (event: any) => events.push(event) },
        limboObject: (object: any, limboData: any) => {
            object.limboData = limboData;
            object.isSpawned = false;
        },
        changeObjectOwner: (object: any, owner: any) => {
            object.owner = owner;
        },
        getUnitSelection: () => ({
            isSelected: () => true,
            getOrCreateSelectionModel: () => ({ getControlGroupNumber: () => 3 }),
        }),
    };
}

function makeWeapon(overrides: Record<string, string> = {}): WeaponRules {
    const section = new IniSection("AbductorWeapon");
    section.set("Abductor", "yes");
    section.set("Abductor.ChangeOwner", "yes");
    section.set("Abductor.Anim", "ContainmentAnim");
    for (const [key, value] of Object.entries(overrides)) section.set(key, value);
    return new WeaponRules(section);
}

function makeTarget(owner: any = { name: "victim" }) {
    return {
        isUnit: () => true,
        isSpawned: true,
        isDestroyed: false,
        isCrashing: false,
        limboData: undefined,
        tile: { rx: 4, ry: 7, z: 0 },
        owner,
        rules: {
            size: 1,
            immuneToPsionics: false,
            aresChronoPrison: { passengerTurret: false, immuneToAbduction: false },
        },
        healthTrait: { getHitPoints: () => 50, maxHitPoints: 100 },
    };
}

function makeAttacker(owner: any) {
    const transport = {
        units: [] as any[],
        getMaxCapacity: () => 5,
        getOccupiedCapacity() {
            return this.units.reduce((sum, unit) => sum + unit.rules.size, 0);
        },
    };
    return {
        owner,
        rules: { sizeLimit: 2 },
        transportTrait: transport,
    };
}

describe("Ares Chrono Prison live integration", () => {
    test("moves eligible units into the attacker hold and emits shared events", () => {
        const events: any[] = [];
        const owner = { name: "attacker" };
        const targetOwner = { name: "victim" };
        const attacker = makeAttacker(owner);
        const target = makeTarget(targetOwner);

        const decision = applyAresChronoPrison(attacker, target, makeWeapon(), makeWorld(events) as any);

        expect(decision).toMatchObject({ eligible: true, changeOwner: true });
        expect(attacker.transportTrait.units).toEqual([target]);
        expect(target.isSpawned).toBe(false);
        expect(target.limboData).toEqual({ selected: true, controlGroup: 3, inTransport: true });
        expect(target.owner).toBe(owner);
        expect(events.map((event) => event.type)).toEqual([
            EventType.EnterTransport,
            EventType.EnterObject,
            EventType.TriggerAnim,
        ]);
        expect(events[2].name).toBe("ContainmentAnim");
    });

    test("keeps the ordinary path available when the hold is full or the target is immune", () => {
        const events: any[] = [];
        const attacker = makeAttacker({ name: "attacker" });
        const target = makeTarget();
        attacker.transportTrait.units.push({ rules: { size: 5 } });

        expect(applyAresChronoPrison(attacker, target, makeWeapon(), makeWorld(events) as any).reason)
            .toBe("passenger-capacity");
        expect(target.isSpawned).toBe(true);
        expect(attacker.transportTrait.units).toHaveLength(1);

        attacker.transportTrait.units.length = 0;
        target.rules.aresChronoPrison.immuneToAbduction = true;
        expect(applyAresChronoPrison(attacker, target, makeWeapon(), makeWorld(events) as any).reason)
            .toBe("immune-to-abduction");
        expect(target.isSpawned).toBe(true);
    });

    test("defers temporal abduction until the temporal erase phase", () => {
        const events: any[] = [];
        const attacker = makeAttacker({ name: "attacker" });
        const target = makeTarget();
        const weapon = makeWeapon({ "Abductor.Temporal": "yes" });
        const world = makeWorld(events);

        expect(applyAresChronoPrison(attacker, target, weapon, world as any, {
            warheadIsTemporal: true,
        }).reason).toBe("awaiting-temporal-erasure");
        expect(target.isSpawned).toBe(true);

        expect(applyAresChronoPrison(attacker, target, weapon, world as any, {
            phase: "temporal-erasure",
            warheadIsTemporal: true,
        }).eligible).toBe(true);
        expect(target.isSpawned).toBe(false);
        expect(attacker.transportTrait.units).toEqual([target]);
    });

    test("switches a PassengerTurret transport to the passenger-count turret", () => {
        const trait = new AresPassengerTurretTrait();
        const vehicle: any = {
            turretNo: 0,
            rules: { turretCount: 4 },
            transportTrait: { units: [{}, {}] },
        };

        trait[NotifyTick.onTick](vehicle);

        expect(vehicle.turretNo).toBe(2);
    });
});
