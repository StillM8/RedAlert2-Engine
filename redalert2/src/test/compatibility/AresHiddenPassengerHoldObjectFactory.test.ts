import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import { ObjectFactory } from "@/game/gameobject/ObjectFactory";
import { TransportTrait } from "@/game/gameobject/trait/TransportTrait";
import { applyAresChronoPrison } from "@/extensions/ares/AresChronoPrisonIntegration";

function infantryRules(overrides: Record<string, any> = {}): any {
    return {
        crashable: false,
        fearless: true,
        agent: false,
        harvester: false,
        storage: undefined,
        passengers: 0,
        sizeLimit: 1,
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
        trainable: false,
        selfHealing: false,
        sensors: false,
        bombable: false,
        primary: undefined,
        secondary: undefined,
        weaponCount: 0,
        deployer: false,
        canDisguise: false,
        cloakable: false,
        aresAttachEffect: undefined,
        operatorAny: false,
        operator: [],
        spawns: undefined,
        maxDebris: 0,
        airstrikeTeamType: undefined,
        ...overrides,
    };
}

function createInfantry(rules: any): any {
    const rulesIni: any = {
        general: {
            cloakDelay: 0,
            shipSinkingWeight: 100,
            treeStrength: 1,
        },
        audioVisual: { conditionYellow: 0.5, conditionRed: 0.25 },
        combatDamage: { bridgeStrength: 1 },
        getObject: () => rules,
        getOverlayId: () => 0,
    };
    const artIni: any = { getObject: () => ({}) };
    return new ObjectFactory({}, {}, {}, { value: 1 })
        .create(ObjectType.Infantry, "ABDUCTOR", rulesIni, artIni);
}

describe("Ares hidden Techno passenger holds", () => {
    test("ObjectFactory attaches a non-interactive hold to non-transport Technos with Passengers>0", () => {
        const unit = createInfantry(infantryRules({ passengers: 3, sizeLimit: 2 }));
        expect(unit.transportTrait).toBeInstanceOf(TransportTrait);
        expect(unit.transportTrait.getMaxCapacity()).toBe(3);
        expect(unit.transportTrait.allowsManualEntry()).toBe(false);
        expect(unit.transportTrait.allowsManualUnload()).toBe(false);
    });

    test("does not create hidden hold when Passengers=0", () => {
        const unit = createInfantry(infantryRules({ passengers: 0 }));
        expect(unit.transportTrait).toBeUndefined();
    });

    test("generic infantry Abductor can use the shared hidden hold", () => {
        const attacker = createInfantry(infantryRules({ passengers: 2, sizeLimit: 2 }));
        const attackerOwner = { id: "attacker" };
        const victimOwner = { id: "victim" };
        attacker.owner = attackerOwner;
        const victim: any = {
            owner: victimOwner,
            isSpawned: true,
            isDestroyed: false,
            isCrashing: false,
            tile: { rx: 1, ry: 1 },
            rules: {
                size: 1,
                immuneToPsionics: false,
                aresChronoPrison: { immuneToAbduction: false, passengerTurret: false },
            },
            healthTrait: { maxHitPoints: 100, getHitPoints: () => 100 },
            invulnerableTrait: { isActive: () => false },
            isUnit: () => true,
        };
        const world: any = {
            events: { dispatch: () => undefined },
            limboObject: (object: any, data: any) => {
                object.isSpawned = false;
                object.limboData = data;
            },
            changeObjectOwner: (object: any, owner: any) => { object.owner = owner; },
        };
        const decision = applyAresChronoPrison(attacker, victim, {
            aresChronoPrison: {
                abductor: true,
                temporal: false,
                changeOwner: false,
                abductBelowPercent: 1,
                maxHealth: 0,
            },
        }, world);

        expect(decision.eligible).toBe(true);
        expect(attacker.transportTrait.units).toEqual([victim]);
        expect(victim.limboData?.inTransport).toBe(true);
    });
});
