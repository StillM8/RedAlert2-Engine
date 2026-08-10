import { describe, expect, test } from "bun:test";
import { ObjectType } from "@/engine/type/ObjectType";
import {
    aresEmpThresholdExceeded,
    defaultAresEmpImmunity,
    parseAresEmpThreshold,
    resolveAresEmpCounter,
} from "@/extensions/ares/AresEMP";
import { EmpTrait } from "@/game/gameobject/trait/EmpTrait";
import { VeteranAbility } from "@/game/gameobject/unit/VeteranAbility";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { IniSection } from "@/data/IniSection";
import { WarheadRules } from "@/game/rules/WarheadRules";
import { HarvesterStatus } from "@/game/gameobject/trait/HarvesterTrait";
import { Production } from "@/game/player/production/Production";
import { FactoryType } from "@/game/rules/TechnoRules";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";
import { FactoryTrait } from "@/game/gameobject/trait/FactoryTrait";
import { isAresEmpOperational } from "@/extensions/ares/AresEMP";
import { NotifyTick as TraitNotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { AirSpawnTrait } from "@/game/gameobject/trait/AirSpawnTrait";
import { PowerTrait as PlayerPowerTrait } from "@/game/player/trait/PowerTrait";

function disableable(initial = false) {
    let disabled = initial;
    return {
        isDisabled: () => disabled,
        setDisabled: (value: boolean) => {
            disabled = value;
        },
    };
}

describe("Ares EMP rules", () => {
    test("matches documented positive and negative counter semantics", () => {
        expect(resolveAresEmpCounter(0, 10, 20)).toBe(10);
        expect(resolveAresEmpCounter(15, 10, 20)).toBe(20);
        expect(resolveAresEmpCounter(60, 10, 20)).toBe(60);
        expect(resolveAresEmpCounter(25, 10, 0)).toBe(35);
        expect(resolveAresEmpCounter(5, 10, -1)).toBe(10);
        expect(resolveAresEmpCounter(20, 10, -1)).toBe(20);

        expect(resolveAresEmpCounter(50, -10, -1)).toBe(40);
        expect(resolveAresEmpCounter(7, -10, -1)).toBe(0);
        expect(resolveAresEmpCounter(50, -10, 20)).toBe(20);
        expect(resolveAresEmpCounter(7, -10, 20)).toBe(0);
        expect(resolveAresEmpCounter(50, -10, 0)).toBe(0);
        expect(resolveAresEmpCounter(20, 10, 20, 0.5)).toBe(20);
    });

    test("parses EMP threshold aliases without losing numeric values", () => {
        expect(parseAresEmpThreshold(undefined)).toBe(-1);
        expect(parseAresEmpThreshold("yes")).toBe(1);
        expect(parseAresEmpThreshold("NO")).toBe(0);
        expect(parseAresEmpThreshold("inair")).toBe(-1);
        expect(parseAresEmpThreshold("17")).toBe(17);
        expect(parseAresEmpThreshold("not-a-threshold")).toBe(-1);
    });

    test("applies positive and in-air EMP threshold semantics", () => {
        expect(aresEmpThresholdExceeded(0, 999, true)).toBe(false);
        expect(aresEmpThresholdExceeded(10, 10, false)).toBe(false);
        expect(aresEmpThresholdExceeded(10, 11, false)).toBe(true);
        expect(aresEmpThresholdExceeded(-1, 11, false)).toBe(false);
        expect(aresEmpThresholdExceeded(-1, 11, true)).toBe(true);
        expect(aresEmpThresholdExceeded(-1, 11, true, true)).toBe(false);
    });

    test("calculates Ares default immunity by Techno category and function", () => {
        expect(defaultAresEmpImmunity({
            type: ObjectType.Building,
            powered: false,
            power: 0,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: false,
            organic: false,
        })).toBe(true);
        expect(defaultAresEmpImmunity({
            type: ObjectType.Building,
            powered: true,
            power: -100,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: false,
            organic: false,
        })).toBe(false);
        expect(defaultAresEmpImmunity({
            type: ObjectType.Infantry,
            powered: false,
            power: 0,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: false,
            organic: true,
        })).toBe(true);
        expect(defaultAresEmpImmunity({
            type: ObjectType.Infantry,
            powered: false,
            power: 0,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: true,
            organic: true,
        })).toBe(false);
        expect(defaultAresEmpImmunity({
            type: ObjectType.Vehicle,
            powered: false,
            power: 0,
            radar: false,
            spySat: false,
            hasSuperWeapon: false,
            undeploysInto: false,
            powersUnit: false,
            gapGenerator: false,
            sensors: false,
            sensorArray: false,
            laserFencePost: false,
            cyborg: false,
            organic: true,
        })).toBe(true);
    });

    test("parses warhead EMP duration and cap independently of legacy EMEffect", () => {
        const section = new IniSection("EMPWH");
        section.set("EMEffect", "yes");
        section.set("EMP.Duration", "150");
        section.set("EMP.Cap", "300");
        section.set("AffectsEnemies", "no");
        const rules = new WarheadRules(section);
        expect(rules.emEffect).toBe(true);
        expect(rules.empDuration).toBe(150);
        expect(rules.empCap).toBe(300);
        expect(rules.affectsEnemies).toBe(false);
    });

    test("paralyzes movement and attack, counts down, and restores prior disable state", () => {
        const moveTrait = disableable(true);
        const attackTrait = disableable(false);
        const obj: any = {
            rules: { immuneToEMP: false },
            moveTrait,
            attackTrait,
            isAircraft: () => false,
        };
        const emp = new EmpTrait(obj);

        expect(emp.apply(3, -1)).toBe(true);
        expect(emp.isUnderEMP()).toBe(true);
        expect(emp.getRemainingFrames()).toBe(3);
        expect(moveTrait.isDisabled()).toBe(true);
        expect(attackTrait.isDisabled()).toBe(true);

        emp[NotifyTick.onTick](obj, undefined);
        emp[NotifyTick.onTick](obj, undefined);
        expect(emp.getRemainingFrames()).toBe(1);
        emp[NotifyTick.onTick](obj, undefined);

        expect(emp.isUnderEMP()).toBe(false);
        expect(moveTrait.isDisabled()).toBe(true);
        expect(attackTrait.isDisabled()).toBe(false);
        expect(emp.debugGetState()).toEqual({ remainingFrames: 0, underEMP: false });
    });

    test("respects explicit and veteran EMP immunity", () => {
        const explicit: any = {
            rules: { immuneToEMP: true },
            moveTrait: disableable(),
            attackTrait: disableable(),
            isAircraft: () => false,
        };
        expect(new EmpTrait(explicit).apply(10, -1)).toBe(false);

        const veteran: any = {
            rules: { immuneToEMP: false },
            veteranTrait: {
                hasVeteranAbility: (ability: VeteranAbility) => ability === VeteranAbility.EMPIMMUNE,
            },
            moveTrait: disableable(),
            attackTrait: disableable(),
            isAircraft: () => false,
        };
        expect(new EmpTrait(veteran).apply(10, -1)).toBe(false);
    });

    test("records EMP during unloading and deactivates after the unload boundary", () => {
        const moveTrait = disableable();
        const attackTrait = disableable();
        const harvesterTrait: any = { status: HarvesterStatus.Unloading };
        const obj: any = {
            rules: { immuneToEMP: false },
            moveTrait,
            attackTrait,
            harvesterTrait,
            unitOrderTrait: { getTasks: () => [] },
            isAircraft: () => false,
        };
        const emp = new EmpTrait(obj);

        expect(emp.apply(3, -1)).toBe(true);
        expect(emp.getRemainingFrames()).toBe(3);
        expect(emp.isUnderEMP()).toBe(true);
        expect(moveTrait.isDisabled()).toBe(false);

        emp[NotifyTick.onTick](obj, undefined);
        expect(emp.getRemainingFrames()).toBe(2);
        expect(moveTrait.isDisabled()).toBe(false);

        harvesterTrait.status = HarvesterStatus.Idle;
        emp[NotifyTick.onTick](obj, undefined);
        expect(moveTrait.isDisabled()).toBe(true);
        expect(emp.getRemainingFrames()).toBe(1);
        emp[NotifyTick.onTick](obj, undefined);
        expect(moveTrait.isDisabled()).toBe(false);
    });

    test("uses one operational predicate for manager consumers", () => {
        const building: any = {
            empTrait: { isUnderEMP: () => true },
            warpedOutTrait: { isActive: () => false },
        };
        expect(isAresEmpOperational(building)).toBe(false);
        building.empTrait.isUnderEMP = () => false;
        expect(isAresEmpOperational(building)).toBe(true);
        building.warpedOutTrait.isActive = () => true;
        expect(isAresEmpOperational(building)).toBe(false);
    });

    test("pauses production when every matching factory is EMP-disabled", () => {
        const player: any = { buildings: new Set<any>() };
        const production = new Production(player, 10, {}, {}, [], undefined);
        const factory: any = {
            factoryTrait: { type: FactoryType.InfantryType },
            empTrait: { isUnderEMP: () => true },
            warpedOutTrait: { isActive: () => false },
        };
        player.buildings.add(factory);
        expect(production.hasOperationalFactory(FactoryType.InfantryType)).toBe(false);
        factory.empTrait.isUnderEMP = () => false;
        expect(production.hasOperationalFactory(FactoryType.InfantryType)).toBe(true);
    });

    test("does not produce from an EMP-disabled factory", () => {
        const factoryTrait = new FactoryTrait(FactoryType.InfantryType);
        const building: any = {
            owner: { production: {} },
            empTrait: { isUnderEMP: () => true },
            warpedOutTrait: { isActive: () => false },
        };
        factoryTrait[TraitNotifyTick.onTick](building, {});
        expect(factoryTrait.status).toBe(0);
    });

    test("excludes EMP-disabled powered superweapon buildings", () => {
        const superWeaponsTrait = new SuperWeaponsTrait();
        const superWeapon: any = {
            rules: { isPowered: true },
            owner: { buildings: new Set<any>() },
        };
        const building: any = {
            superWeaponTrait: { getSuperWeapon: () => superWeapon },
            empTrait: { isUnderEMP: () => true },
            warpedOutTrait: { isActive: () => false },
        };
        superWeapon.owner.buildings.add(building);
        expect((superWeaponsTrait as any).superWeaponHasValidBuilding(superWeapon)).toBeUndefined();
        building.empTrait.isUnderEMP = () => false;
        expect((superWeaponsTrait as any).superWeaponHasValidBuilding(superWeapon)).toBe(building);
    });

    test("crashes visible spawned aircraft when a spawner enters EMP", () => {
        const spawner = {
            isSpawned: true,
            isDestroyed: false,
            rules: { missileSpawn: false },
        };
        let crashSource: any;
        const airSpawn = new AirSpawnTrait();
        (airSpawn as any).spawns = [{
            ...spawner,
            crashableTrait: { crash: (source: any) => { crashSource = source; } },
        }];
        const source = { id: "spawner" };
        airSpawn.onEmp(source);
        expect(crashSource).toBe(source);
    });

    test("removes EMP-disabled power output while retaining the producer ledger", () => {
        const player: any = {};
        const powerTrait = new PlayerPowerTrait(player);
        const events: any[] = [];
        const world: any = {
            traits: { filter: () => [] },
            events: { dispatch: (event: any) => events.push(event) },
        };
        let underEMP = false;
        const powerPlant: any = {
            rules: { power: 100, occupantsPowerBonus: 0 },
            healthTrait: { health: 100 },
            empTrait: { isUnderEMP: () => underEMP },
        };

        powerTrait.updateFrom(powerPlant, "add", world);
        expect(powerTrait.debugGetState().power).toBe(100);
        underEMP = true;
        powerTrait.refreshEmpState(world);
        expect(powerTrait.debugGetState().power).toBe(0);
        underEMP = false;
        powerTrait.refreshEmpState(world);
        expect(powerTrait.debugGetState().power).toBe(100);
        expect(events.length).toBe(3);
    });
});
