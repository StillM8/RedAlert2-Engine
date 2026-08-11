import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { setAresBatteryActiveForWeapon } from "@/extensions/ares/AresBattery";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { PowerTrait } from "@/game/player/trait/PowerTrait";

function batteryDefinition(): any {
    const ini = new IniFile(`
[Battery]
Type=Battery
Battery.Power=120
Battery.KeepOnline=Radar,PowerPlant
Battery.Overpower=Prism,Prism
`);
    return parseAresSuperWeaponDefinition(ini.getSection("Battery")!);
}

describe("Ares Battery superweapon", () => {
    test("parses Antares Battery power and building-type lists", () => {
        const definition = batteryDefinition();
        expect(definition?.extensionType).toBe("Battery");
        expect(definition?.useChargeDrain).toBe(true);
        expect(definition?.batteryPower).toBe(120);
        expect(definition?.batteryKeepOnline).toEqual(["Radar", "PowerPlant"]);
        expect(definition?.batteryOverpower).toEqual(["Prism", "Prism"]);
    });

    test("adds auxiliary output and removes it exactly once per active Battery", () => {
        const owner: any = {};
        const power = new PowerTrait(owner);
        owner.powerTrait = power;
        const definition = batteryDefinition();

        power.activateAresBattery(definition);
        power.activateAresBattery(definition);
        expect(power.debugGetState()).toMatchObject({
            power: 240,
            auxiliaryPower: 240,
            activeAresBatteries: 2,
        });
        expect(power.isAresBatteryKeepingOnline({ rules: { name: "radar" } })).toBe(true);
        expect(power.isAresBatteryOverpowering({ rules: { name: "PRISM" } })).toBe(true);

        power.deactivateAresBattery(definition);
        expect(power.debugGetState()).toMatchObject({
            power: 120,
            auxiliaryPower: 120,
            activeAresBatteries: 1,
        });
        expect(power.isAresBatteryKeepingOnline({ rules: { name: "Radar" } })).toBe(true);
        power.deactivateAresBattery(definition);
        expect(power.debugGetState()).toMatchObject({
            power: 0,
            auxiliaryPower: 0,
            activeAresBatteries: 0,
        });
        expect(power.isAresBatteryKeepingOnline({ rules: { name: "Radar" } })).toBe(false);
    });

    test("negative Battery.Power contributes auxiliary drain", () => {
        const owner: any = {};
        const power = new PowerTrait(owner);
        const definition = { ...batteryDefinition(), batteryPower: -35 };

        power.activateAresBattery(definition);
        expect(power.debugGetState()).toMatchObject({
            power: 0,
            drain: 35,
            auxiliaryPower: -35,
        });
        expect(power.isLowPower()).toBe(true);
        power.deactivateAresBattery(definition);
        expect(power.isLowPower()).toBe(false);
    });

    test("charge-drain activation callback applies and removes house effects once", () => {
        const owner: any = { credits: 0 };
        owner.powerTrait = new PowerTrait(owner);
        const weapon: any = {
            owner,
            rules: { ares: batteryDefinition() },
            aresBatteryActive: false,
        };

        expect(setAresBatteryActiveForWeapon(weapon, true)).toBe(true);
        expect(owner.powerTrait.debugGetState()).toMatchObject({
            power: 120,
            activeAresBatteries: 1,
        });
        expect(setAresBatteryActiveForWeapon(weapon, true)).toBe(false);

        expect(setAresBatteryActiveForWeapon(weapon, false)).toBe(true);
        expect(owner.powerTrait.debugGetState()).toMatchObject({
            power: 0,
            activeAresBatteries: 0,
        });
        expect(setAresBatteryActiveForWeapon(weapon, false)).toBe(false);
    });

    test("scanner reports Battery separately from the generic custom-SW bucket", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: "[BatterySW]\nType=Battery\nBattery.Power=100\nBattery.KeepOnline=GAPOWR\nBattery.Overpower=ATESLA\n",
        }]);
        const usage = report.featureUsage.find(item => item.featureId === "ares.superweapon-battery");
        expect(usage?.occurrences).toBe(4);
        expect(usage?.definitionCount).toBe(1);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
        expect(report.unknownExtensionKeys).toBe(0);
    });

});
