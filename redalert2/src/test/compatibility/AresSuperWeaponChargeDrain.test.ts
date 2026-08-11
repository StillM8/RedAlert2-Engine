import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import {
    getAresChargeDrainDuration,
    isAresChargeDrainMoneyDue,
    normalizeAresChargeToDrainRatio,
    startAresChargeDrain,
    stopAresChargeDrain,
} from "@/extensions/ares/AresSuperWeaponChargeDrain";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { SuperWeapon, SuperWeaponStatus } from "@/game/SuperWeapon";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";

function makeRules(ares: Record<string, unknown> = {}): any {
    return {
        name: "ChargeDrain",
        rechargeTime: 1,
        ares: {
            extensionEntries: new Map(),
            ...ares,
        },
    };
}

describe("Ares charge-drain superweapons", () => {
    test("parses handler defaults, raw flag, ratio, and unstoppable policy", () => {
        const ini = new IniFile(`
[Firewall]
Type=Firestorm
UseChargeDrain=no
SW.ChargeToDrainRatio=2.5
SW.Unstoppable=yes
Money.DrainAmount=-10
Money.DrainDelay=5

[Battery]
Type=Battery

[Unsupported]
Type=GenericWarhead
UseChargeDrain=yes
`);

        const firewall = parseAresSuperWeaponDefinition(ini.getSection("Firewall")!);
        const battery = parseAresSuperWeaponDefinition(ini.getSection("Battery")!);
        const unsupported = parseAresSuperWeaponDefinition(ini.getSection("Unsupported")!);

        // Antares registers charge-drain as part of the Firewall/Battery
        // handlers. The legacy field is still retained for diagnostics, but
        // must not turn an unrelated Type= into a runtime state machine.
        expect(firewall?.swUseChargeDrain).toBe(false);
        expect(firewall?.useChargeDrain).toBe(true);
        expect(firewall?.swChargeToDrainRatio).toBe(2.5);
        expect(firewall?.swUnstoppable).toBe(true);
        expect(firewall?.moneyDrainAmount).toBe(-10);
        expect(firewall?.moneyDrainDelay).toBe(5);
        expect(battery?.useChargeDrain).toBe(true);
        expect(unsupported?.swUseChargeDrain).toBe(true);
        expect(unsupported?.useChargeDrain).toBe(false);
    });

    test("normalizes ratios and converts charge into active drain time", () => {
        expect(normalizeAresChargeToDrainRatio(undefined)).toBe(1);
        expect(normalizeAresChargeToDrainRatio(0)).toBe(1);
        expect(normalizeAresChargeToDrainRatio(-2)).toBe(1);
        expect(getAresChargeDrainDuration(10, 2.5)).toBe(25);
        expect(startAresChargeDrain(10, 2)).toEqual({
            state: "draining",
            timerTicks: 20,
        });

        expect(stopAresChargeDrain(10, 15, 2)).toEqual({
            state: "charging",
            timerTicks: 2,
        });
        expect(stopAresChargeDrain(10, 0, 2)).toEqual({
            state: "charging",
            timerTicks: 10,
        });
        expect(isAresChargeDrainMoneyDue(15, 5)).toBe(true);
        expect(isAresChargeDrainMoneyDue(14, 5)).toBe(false);
        expect(isAresChargeDrainMoneyDue(15, 0)).toBe(false);
    });

    test("drains money on scheduled ticks and automatically recharges after expiry", () => {
        const owner = { credits: 100 };
        const weapon = new SuperWeapon("Firewall", makeRules({
            useChargeDrain: true,
            moneyDrainAmount: -10,
            moneyDrainDelay: 5,
        }), owner);
        weapon.rechargeTicks = 10;
        weapon.chargeTicks = 0;
        weapon.status = SuperWeaponStatus.Ready;

        expect(weapon.startChargeDrain(2)).toBe(true);
        expect(weapon.status).toBe(SuperWeaponStatus.Draining);
        expect(weapon.chargeTicks).toBe(20);

        const game = { events: { dispatch: () => undefined } };
        for (let tick = 0; tick < 20; tick++) weapon.update(game);

        expect(owner.credits).toBe(70);
        expect(weapon.status).toBe(SuperWeaponStatus.Charging);
        expect(weapon.chargeTicks).toBe(10);
    });

    test("stops when a scheduled money transaction cannot be paid", () => {
        const owner = { credits: 5 };
        const weapon = new SuperWeapon("Firewall", makeRules({
            useChargeDrain: true,
            moneyDrainAmount: -10,
            moneyDrainDelay: 5,
        }), owner);
        weapon.rechargeTicks = 10;
        weapon.chargeTicks = 0;
        weapon.status = SuperWeaponStatus.Ready;

        expect(weapon.startChargeDrain(2)).toBe(true);
        const game = { events: { dispatch: () => undefined } };
        for (let tick = 0; tick < 5; tick++) weapon.update(game);

        expect(owner.credits).toBe(5);
        expect(weapon.status).toBe(SuperWeaponStatus.Charging);
        expect(weapon.chargeTicks).toBe(2);
    });

    test("manual deactivation converts remaining active time back to charge", () => {
        const weapon = new SuperWeapon("Firewall", makeRules({ useChargeDrain: true }), { credits: 0 });
        weapon.rechargeTicks = 10;
        weapon.chargeTicks = 0;
        weapon.status = SuperWeaponStatus.Ready;

        expect(weapon.startChargeDrain(2)).toBe(true);
        weapon.update({ events: { dispatch: () => undefined } });
        weapon.update({ events: { dispatch: () => undefined } });
        weapon.update({ events: { dispatch: () => undefined } });
        weapon.update({ events: { dispatch: () => undefined } });
        weapon.update({ events: { dispatch: () => undefined } });
        expect(weapon.chargeTicks).toBe(15);
        expect(weapon.deactivateChargeDrain()).toBe(true);
        expect(weapon.status).toBe(SuperWeaponStatus.Charging);
        expect(weapon.chargeTicks).toBe(2);
    });

    test("SuperWeaponsTrait starts and stops the shared state machine", () => {
        const owner: any = { credits: 100, buildings: new Set() };
        const weapon = new SuperWeapon("Firewall", makeRules({
            extensionType: "Firestorm",
            useChargeDrain: true,
            swChargeToDrainRatio: undefined,
        }), owner);
        weapon.rules.index = 7;
        weapon.rechargeTicks = 10;
        weapon.chargeTicks = 0;
        weapon.status = SuperWeaponStatus.Ready;
        owner.superWeaponsTrait = { getAll: () => [weapon] };

        const game: any = {
            rules: { general: { chargeToDrainRatio: 2 } },
            traits: { filter: () => [] },
            events: { dispatch: () => undefined },
        };
        const trait = new SuperWeaponsTrait();

        expect((trait as any).activateSuperWeapon(7, owner, game, {}, {})).toBe(true);
        expect(weapon.status).toBe(SuperWeaponStatus.Draining);
        expect(weapon.chargeTicks).toBe(20);
        expect(weapon.shotsFired).toBe(0);
        expect((trait as any).deactivateSuperWeapon(7, owner)).toBe(true);
        expect(weapon.status).toBe(SuperWeaponStatus.Ready);
        expect(weapon.chargeTicks).toBe(0);
    });

    test("Battery charge-drain lifecycle applies and removes house effects", () => {
        const calls: string[] = [];
        const owner: any = {
            credits: 0,
            powerTrait: {
                activateAresBattery: () => calls.push("activate"),
                deactivateAresBattery: () => calls.push("deactivate"),
            },
        };
        const weapon = new SuperWeapon("Battery", makeRules({
            extensionType: "Battery",
            useChargeDrain: true,
            batteryPower: 100,
        }), owner);
        weapon.rechargeTicks = 5;
        weapon.chargeTicks = 0;
        weapon.status = SuperWeaponStatus.Ready;

        expect(weapon.startChargeDrain(1)).toBe(true);
        expect(calls).toEqual(["activate"]);
        expect(weapon.deactivateChargeDrain()).toBe(true);
        expect(calls).toEqual(["activate", "deactivate"]);
        expect(weapon.deactivateChargeDrain()).toBe(false);
        expect(calls).toEqual(["activate", "deactivate"]);
    });

    test("Unstoppable prevents manual deactivation", () => {
        const owner: any = { credits: 0, buildings: new Set() };
        const weapon = new SuperWeapon("Firewall", makeRules({
            useChargeDrain: true,
            swUnstoppable: true,
        }), owner);
        weapon.rules.index = 8;
        weapon.rechargeTicks = 10;
        weapon.chargeTicks = 0;
        weapon.status = SuperWeaponStatus.Ready;
        owner.superWeaponsTrait = { getAll: () => [weapon] };

        const trait = new SuperWeaponsTrait();
        expect(weapon.startChargeDrain(2)).toBe(true);
        expect((trait as any).deactivateSuperWeapon(8, owner)).toBe(false);
        expect(weapon.status).toBe(SuperWeaponStatus.Draining);
    });

    test("scanner tracks charge-drain keys and money scheduling separately", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: `
[General]
ChargeToDrainRatio=2

[Firewall]
Type=Firestorm
UseChargeDrain=yes
SW.ChargeToDrainRatio=2
SW.Unstoppable=yes
Money.DrainAmount=-5
Money.DrainDelay=30
`,
        }]);
        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-charge-drain");

        expect(usage?.occurrences).toBe(6);
        expect(usage?.definitionCount).toBe(2);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
        expect(report.unclassifiedKeys).toBe(0);
    });
});
