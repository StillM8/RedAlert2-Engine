import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import {
    applyAresSuperWeaponMoney,
    canAresSuperWeaponTransactMoney,
    normalizeAresSuperWeaponMoney,
} from "@/extensions/ares/AresSuperWeaponMoney";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { SuperWeaponStatus } from "@/game/SuperWeapon";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";

describe("Ares superweapon Money.Amount", () => {
    test("parses launch and charge-drain money fields without losing provenance data", () => {
        const ini = new IniFile(`
[PaidSW]
Type=GenericWarhead
Money.Amount=-250
Money.DrainAmount=-5
Money.DrainDelay=30
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("PaidSW")!);

        expect(definition?.moneyAmount).toBe(-250);
        expect(definition?.moneyDrainAmount).toBe(-5);
        expect(definition?.moneyDrainDelay).toBe(30);
        expect(definition?.extensionEntries.get("Money.Amount")).toBe("-250");
    });

    test("requires enough credits for a negative launch amount", () => {
        expect(canAresSuperWeaponTransactMoney(250, -250)).toBe(true);
        expect(canAresSuperWeaponTransactMoney(249, -250)).toBe(false);
        expect(canAresSuperWeaponTransactMoney(0, 100)).toBe(true);

        const owner = { credits: 300 };
        expect(applyAresSuperWeaponMoney(owner, -250)).toBe(true);
        expect(owner.credits).toBe(50);
        expect(applyAresSuperWeaponMoney(owner, -100)).toBe(false);
        expect(owner.credits).toBe(50);
    });

    test("normalizes Ares integer values deterministically and applies grants", () => {
        expect(normalizeAresSuperWeaponMoney(-25.9)).toBe(-25);
        expect(normalizeAresSuperWeaponMoney(undefined)).toBe(0);

        const owner = { credits: 40 };
        expect(applyAresSuperWeaponMoney(owner, 125.9)).toBe(true);
        expect(owner.credits).toBe(165);
    });

    test("scanner keeps launch money separate from generic superweapon parsing", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: "[PaidSW]\nType=GenericWarhead\nMoney.Amount=-250\nMoney.DrainAmount=-5\nMoney.DrainDelay=30\n",
        }]);
        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-money");
        const drainUsage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-charge-drain");

        expect(usage?.occurrences).toBe(1);
        expect(usage?.definitionCount).toBe(1);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
        expect(drainUsage?.occurrences).toBe(2);
        expect(drainUsage?.definitionCount).toBe(1);
    });

    test("the activation path charges only after a valid ready launch", () => {
        const resetCalls: string[] = [];
        const superWeapon = {
            name: "PaidSW",
            rules: {
                index: 4,
                ares: { moneyAmount: -75 },
            },
            status: SuperWeaponStatus.Ready,
            oneTimeOnly: false,
            resetTimer: () => resetCalls.push("reset"),
        };
        const owner = {
            credits: 100,
            buildings: new Set(),
            superWeaponsTrait: {
                getAll: () => [superWeapon],
            },
        };
        const trait = new SuperWeaponsTrait();

        expect((trait as any).activateSuperWeapon(4, owner, {}, {}, {})).toBe(true);
        expect(owner.credits).toBe(25);
        expect(resetCalls).toEqual(["reset"]);

        owner.credits = 50;
        resetCalls.length = 0;
        expect((trait as any).activateSuperWeapon(4, owner, {}, {}, {})).toBe(false);
        expect(owner.credits).toBe(50);
        expect(resetCalls).toEqual([]);
    });
});
