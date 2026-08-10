import { describe, expect, test } from "bun:test";
import {
    EMPulseEffect,
    isAresEmpulseLaunchSiteInRange,
    selectAresEmpulseLaunchSites,
} from "@/game/superweapon/EMPulseEffect";

function makeBuilding(overrides: any = {}): any {
    const name = overrides.name ?? "EMPCannon";
    return {
        id: overrides.id ?? 1,
        name,
        tile: overrides.tile ?? { rx: 0, ry: 0, z: 0 },
        centerTile: overrides.centerTile ?? overrides.tile ?? { rx: 0, ry: 0, z: 0 },
        isSpawned: true,
        healthTrait: { health: 100 },
        rules: {
            name,
            empulseCannon: true,
            powered: false,
            ...overrides.rules,
        },
        owner: {
            powerTrait: { isLowPower: () => false },
        },
        primaryWeapon: {
            rules: { range: 8, minimumRange: 0, damage: 0 },
            fire: overrides.fire ?? (() => undefined),
            warhead: overrides.warhead,
            expireCooldown: () => undefined,
            ...overrides.weapon,
        },
        ...overrides,
    };
}

describe("Ares EMPulse", () => {
    test("selects explicit cannons, respects range, and keeps linked ordering deterministic", () => {
        const near = makeBuilding({ id: 2, name: "PulseCannon", tile: { rx: 0, ry: 0, z: 0 } });
        const far = makeBuilding({ id: 1, name: "PulseCannon", tile: { rx: 11, ry: 0, z: 0 } });
        const ignored = makeBuilding({ id: 3, name: "OtherBuilding", tile: { rx: 1, ry: 0, z: 0 } });
        const baseRules: any = {
            empulseCannons: ["PulseCannon"],
            swMaxCount: -1,
            swRangeMinimum: 0,
            swRangeMaximum: undefined,
            empulseTargetSelf: false,
            empulseLinked: false,
        };

        expect(selectAresEmpulseLaunchSites([near, far, ignored], baseRules, { rx: 2, ry: 0, z: 0 }).map(b => b.id)).toEqual([2]);
        expect(selectAresEmpulseLaunchSites([near, far, ignored], { ...baseRules, empulseLinked: true }, { rx: 2, ry: 0, z: 0 }).map(b => b.id)).toEqual([1, 2]);
        expect(isAresEmpulseLaunchSiteInRange(near, { rx: 2, ry: 0, z: 0 }, baseRules)).toBe(true);
    });

    test("uses the default EMPulseCannon attachment path and bypasses range for TargetSelf", () => {
        const superWeapon = { name: "EMPulse" };
        const attached = makeBuilding({
            id: 1,
            name: "AttachedCannon",
            tile: { rx: 20, ry: 20, z: 0 },
            rules: { empulseCannon: true },
            superWeaponTrait: { getSuperWeapon: () => superWeapon },
        });
        const unrelated = makeBuilding({
            id: 2,
            name: "UnrelatedCannon",
            tile: { rx: 0, ry: 0, z: 0 },
            rules: { empulseCannon: true },
            superWeaponTrait: { getSuperWeapon: () => ({ name: "OtherSW" }) },
        });
        const rules: any = {
            swMaxCount: -1,
            swRangeMinimum: 0,
            swRangeMaximum: 1,
            empulseTargetSelf: true,
            empulseLinked: false,
        };

        expect(selectAresEmpulseLaunchSites([unrelated, attached], rules, { rx: 0, ry: 0, z: 0 }, { superWeapon }).map(b => b.id)).toEqual([1]);
    });

    test("uses EMPulse's default SW.MaxCount of one cannon", () => {
        const first = makeBuilding({ id: 1, name: "PulseCannon", tile: { rx: 0, ry: 0, z: 0 } });
        const second = makeBuilding({ id: 2, name: "PulseCannon", tile: { rx: 1, ry: 0, z: 0 } });
        const rules: any = {
            extensionType: "EMPulse",
            empulseCannons: ["PulseCannon"],
            swRangeMinimum: 0,
            swRangeMaximum: 8,
            empulseTargetSelf: false,
            empulseLinked: false,
        };

        expect(selectAresEmpulseLaunchSites([second, first], rules, { rx: 0, ry: 0, z: 0 }).map(b => b.id)).toEqual([1]);
    });

    test("fires selected cannons only after the Antares pulse delay", () => {
        const fired: any[][] = [];
        const cannon = makeBuilding({
            name: "PulseCannon",
            fire: (...args: any[]) => fired.push(args),
        });
        const game: any = {
            createTarget: (object: any, tile: any) => ({ object, tile }),
        };
        const rules: any = {
            extensionType: "EMPulse",
            empulseCannons: ["PulseCannon"],
            empulseTargetSelf: false,
            empulseLinked: false,
            empulsePulseDelay: 2,
            swMaxCount: 1,
            swRangeMinimum: 0,
            swRangeMaximum: 20,
        };
        const owner: any = { buildings: [cannon] };
        const effect = new EMPulseEffect("EMPulse", owner, { rx: 3, ry: 3, z: 0 }, rules);

        effect.onStart(game);
        expect(fired).toHaveLength(0);
        expect(effect.onTick(game)).toBe(false);
        expect(fired).toHaveLength(0);
        expect(effect.onTick(game)).toBe(true);
        expect(fired).toHaveLength(1);
        expect(fired[0][0].tile).toEqual({ rx: 3, ry: 3, z: 0 });
    });

    test("TargetSelf detonates each cannon weapon immediately at its own center", () => {
        const detonations: any[][] = [];
        const cannon = makeBuilding({
            name: "PulseCannon",
            tile: { rx: 4, ry: 5, z: 0 },
            weapon: {
                rules: { range: 1, minimumRange: 0, damage: 125 },
                warhead: { detonate: (...args: any[]) => detonations.push(args) },
            },
        });
        const game: any = {
            map: {
                tileOccupation: { getBridgeOnTile: () => undefined },
                getTileZone: () => 0,
            },
            createTarget: (object: any, tile: any) => ({ object, tile }),
        };
        const owner: any = { buildings: [cannon] };
        const rules: any = {
            extensionType: "EMPulse",
            empulseCannons: ["PulseCannon"],
            empulseTargetSelf: true,
            empulseLinked: false,
            swMaxCount: -1,
        };
        const effect = new EMPulseEffect("EMPulse", owner, { rx: 99, ry: 99, z: 0 }, rules);

        effect.onStart(game);

        expect(detonations).toHaveLength(1);
        expect(detonations[0][1]).toBe(125);
        expect(detonations[0][2]).toBe(cannon.tile);
        expect(detonations[0][8]).toMatchObject({ player: owner, obj: cannon });
    });
});
