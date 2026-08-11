import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { AresDriverTrait } from "@/extensions/ares/AresKillingDrivers";
import { Warhead } from "@/game/Warhead";
import { Vector3 } from "@/game/math/Vector3";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { WarheadRules } from "@/game/rules/WarheadRules";

function makeTarget(owner: any, overrides: Record<string, any> = {}): any {
    const center = new Vector3(1.5 * 256, 0, 1.5 * 256);
    return {
        tile: { rx: 1, ry: 1, z: 0 },
        position: { worldPosition: center, tileElevation: 0 },
        owner,
        rules: {
            armor: 5,
            wall: false,
            immune: false,
            immuneToEMP: false,
            typeImmune: false,
            ...overrides,
        },
        isSpawned: true,
        isDisposed: false,
        isDestroyed: false,
        isCrashing: false,
        healthTrait: {
            health: 100,
            getHitPoints: () => 100,
            inflictDamage(damage: number) { this.health = Math.max(0, this.health - damage); },
        },
        crateBonuses: { armor: 1 },
        invulnerableTrait: { isActive: () => false },
        warpedOutTrait: { isInvulnerable: () => false },
        moveTrait: { reservedPathNodes: [] },
        isTechno: () => true,
        isUnit: () => true,
        isInfantry: () => false,
        isAircraft: () => false,
        isVehicle: () => true,
        isOverlay: () => false,
        isTerrain: () => false,
        isBuilding: () => false,
        isBridge: () => false,
        onAttack: () => undefined,
        applyRocking: () => undefined,
        transportTrait: { units: [] },
        moveTrait: { reservedPathNodes: [], setDisabled: () => undefined },
        attackTrait: { setDisabled: () => undefined },
        aresDriverTrait: new AresDriverTrait(),
        ...overrides,
    };
}

function makeGame(target: any, sourceOwner: any, civilian: any): any {
    const centerTile = target.tile;
    return {
        map: {
            tiles: { getByMapCoords: () => centerTile },
            mapBounds: { isWithinBounds: () => true },
            tileOccupation: {},
            getObjectsOnTile: (tile: any) => tile === centerTile ? [target] : [],
        },
        alliances: { areAllied: () => false },
        rules: {
            audioVisual: { weaponNullifyAnim: "" },
            combatDamage: { splashList: [], c4Warhead: "" },
        },
        events: { dispatch: () => undefined },
        mapRadiationTrait: { createRadSite: () => undefined },
        gameOpts: { destroyableBridges: true },
        getCivilianPlayer: () => civilian,
        changeObjectOwner: (object: any, owner: any) => { object.owner = owner; },
        destroyObject: (object: any) => { object.isDestroyed = true; },
        generateRandom: () => 0,
        sourceOwner,
    };
}

function detonate(section: IniSection, target: any, sourceOwner: any, civilian: any, baseDamage: number): void {
    const warhead = new Warhead(new WarheadRules(section) as any);
    const game = makeGame(target, sourceOwner, civilian);
    const source = { owner: sourceOwner };
    const center = target.position.worldPosition;
    warhead.detonate(
        game,
        baseDamage,
        target.tile,
        0,
        center,
        ZoneType.Land,
        CollisionType.None,
        { obj: target },
        { obj: source, player: sourceOwner } as any,
        false,
        undefined,
    );
}

describe("Warhead Ares effect integration", () => {
    test("KillDriver honors EffectsRequireVerses and EffectsRequireDamage in detonation", () => {
        const sourceOwner = { name: "Attacker" };
        const victimOwner = { name: "Victim" };
        const civilian = { name: "Special", isNeutral: true };

        const zeroVerses = new IniSection("ZeroVerses");
        zeroVerses.set("KillDriver", "yes");
        zeroVerses.set("Verses", "1,1,1,1,1,0%");
        const blockedByVerses = makeTarget(victimOwner);
        detonate(zeroVerses, blockedByVerses, sourceOwner, civilian, 0);
        expect(blockedByVerses.owner).toBe(victimOwner);
        expect(blockedByVerses.aresDriverTrait.isDriverKilled()).toBe(false);

        const allowedZeroVerses = new IniSection("AllowZeroVerses");
        allowedZeroVerses.set("KillDriver", "yes");
        allowedZeroVerses.set("Verses", "1,1,1,1,1,0%");
        allowedZeroVerses.set("EffectsRequireVerses", "no");
        const zeroVersesTarget = makeTarget(victimOwner);
        detonate(allowedZeroVerses, zeroVersesTarget, sourceOwner, civilian, 0);
        expect(zeroVersesTarget.owner).toBe(civilian);

        const damageRequired = new IniSection("DamageRequired");
        damageRequired.set("KillDriver", "yes");
        damageRequired.set("Verses", "1,1,1,1,1,100%");
        damageRequired.set("EffectsRequireDamage", "yes");
        const noDamageTarget = makeTarget(victimOwner);
        detonate(damageRequired, noDamageTarget, sourceOwner, civilian, 0);
        expect(noDamageTarget.owner).toBe(victimOwner);
        const damagedTarget = makeTarget(victimOwner);
        detonate(damageRequired, damagedTarget, sourceOwner, civilian, 1);
        expect(damagedTarget.owner).toBe(civilian);
    });

    test("EMP TypeImmune is enforced on the real detonation path", () => {
        const owner = { name: "Owner" };
        const enemy = { name: "Enemy" };
        const civilian = { name: "Special", isNeutral: true };
        const section = new IniSection("EmpWarhead");
        section.set("EMP.Duration", "10");
        section.set("Verses", "1,1,1,1,1,100%");

        const sameOwnerTarget = makeTarget(owner, {
            rules: { armor: 5, wall: false, immune: false, immuneToEMP: false, typeImmune: true },
            empTrait: { apply: () => { throw new Error("same-owner TypeImmune target was EMP'd"); } },
            armedTrait: { getWeapons: () => [{ warhead: { rules: { empDuration: 10 } } }] },
        });
        detonate(section, sameOwnerTarget, owner, civilian, 0);
        expect(sameOwnerTarget.owner).toBe(owner);

        let applied = 0;
        const enemyTarget = makeTarget(enemy, {
            rules: { armor: 5, wall: false, immune: false, immuneToEMP: false, typeImmune: true },
            empTrait: { apply: () => { applied++; return true; } },
            armedTrait: { getWeapons: () => [{ warhead: { rules: { empDuration: 10 } } }] },
        });
        detonate(section, enemyTarget, owner, civilian, 0);
        expect(applied).toBe(1);
    });
});
