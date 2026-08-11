import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { GunnerTrait } from "@/game/gameobject/trait/GunnerTrait";
import { Vehicle } from "@/game/gameobject/Vehicle";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { TechnoRules } from "@/game/rules/TechnoRules";

function rules(source: string): TechnoRules {
    return new TechnoRules(
        ObjectType.Vehicle,
        new IniFile(source).getSection("IFV")!,
        0,
        {},
        new ArmorRegistry(),
    );
}

function unit(hostRules: TechnoRules, passengers: any[]): any {
    return {
        rules: hostRules,
        transportTrait: { units: passengers },
        turretNo: 0,
        veteranLevel: 0,
        armedTrait: {
            selected: [] as number[],
            selectSpecialWeapon(mode: number) { this.selected.push(mode); },
        },
    };
}

describe("Ares IFV runtime integration", () => {
    test("parses optional Ares data, re-applies mode changes, and uses WeaponUINameX", () => {
        const hostRules = rules(`
[IFV]
Gunner=yes
Turret=yes
TurretCount=3
WeaponTurretIndex2=1
WeaponTurretIndex5=2
WeaponUIName5=Name_AresIFVWeapon
`);
        expect(hostRules.ares?.ifv.weaponTurretIndexes.get(5)).toBe(2);

        const firstPassenger: any = { name: "PassengerOne", rules: { ifvMode: 4 } };
        const object = unit(hostRules, [firstPassenger]);
        const trait = new GunnerTrait();

        trait[NotifyTick.onTick](object);
        expect(object.turretNo).toBe(2);
        expect(object.armedTrait.selected).toEqual([4]);
        expect(Vehicle.prototype.getUiName.call({
            rules: hostRules,
            name: "IFVHost",
            gunnerTrait: trait,
            armedTrait: { getSpecialWeaponIndex: () => 4 },
            transportTrait: { units: [firstPassenger] },
        })).toBe("{Name_AresIFVWeapon} {name:IFVHost}");

        firstPassenger.rules.ifvMode = 1;
        trait[NotifyTick.onTick](object);
        expect(object.turretNo).toBe(1);
        expect(object.armedTrait.selected).toEqual([4, 1]);

        const replacementPassenger: any = { name: "PassengerTwo", rules: { ifvMode: 4 } };
        object.transportTrait.units = [replacementPassenger];
        trait[NotifyTick.onTick](object);
        expect(object.turretNo).toBe(2);
        expect(object.armedTrait.selected).toEqual([4, 1, 4]);
    });

    test("does not assign the Ares -1 turret sentinel and still selects the weapon", () => {
        const hostRules = rules(`
[IFV]
Gunner=yes
Turret=yes
TurretCount=2
WeaponUIName2=Name_NoTurretOverride
`);
        const object = unit(hostRules, [{ rules: { ifvMode: 1 } }]);
        object.turretNo = 1;

        new GunnerTrait()[NotifyTick.onTick](object);
        expect(object.turretNo).toBe(1);
        expect(object.armedTrait.selected).toEqual([1]);
    });

    test("keeps vanilla turretIndexesByIfvMode when Ares weapon fields are absent", () => {
        const hostRules = rules(`
[IFV]
Gunner=yes
Turret=yes
TurretCount=3
NormalTurretWeapon=0
NormalTurretIndex=2
PoweredBy=PowerPlant
`);
        expect(hostRules.ares?.ifv.weaponTurretIndexes.size).toBe(0);
        expect(hostRules.ares?.ifv.weaponUiNames.size).toBe(0);
        expect(hostRules.turretIndexesByIfvMode.get(0)).toBe(2);

        const object = unit(hostRules, [{ rules: { ifvMode: 0 } }]);
        new GunnerTrait()[NotifyTick.onTick](object);
        expect(object.turretNo).toBe(2);
        expect(object.armedTrait.selected).toEqual([0]);
    });
});
