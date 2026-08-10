import { describe, expect, test } from "bun:test";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { SuperWeapon, SuperWeaponStatus } from "@/game/SuperWeapon";

function makeRules(ares: any = {}): any {
    return {
        rechargeTime: 1,
        ares: {
            extensionEntries: new Map(),
            ...ares,
        },
    };
}

describe("Ares superweapon charge state", () => {
    test("SW.InitialReady starts a newly granted superweapon ready", () => {
        const weapon = new SuperWeapon("Initial", makeRules({ swInitialReady: true }), {});

        expect(weapon.status).toBe(SuperWeaponStatus.Ready);
        expect(weapon.chargeTicks).toBe(0);
    });

    test("ordinary superweapons still begin charging", () => {
        const weapon = new SuperWeapon("Normal", makeRules(), {});

        expect(weapon.status).toBe(SuperWeaponStatus.Charging);
        expect(weapon.chargeTicks).toBe(weapon.rechargeTicks);
    });

    test("SW.VirtualCharge consumes elapsed unavailable time on resume", () => {
        const weapon = new SuperWeapon("Virtual", makeRules({ swVirtualCharge: true }), {});
        const recharge = weapon.rechargeTicks;

        weapon.pauseTimer(100);
        expect(weapon.status).toBe(SuperWeaponStatus.Paused);
        weapon.resumeTimer(100 + Math.floor(recharge / 2));

        expect(weapon.status).toBe(SuperWeaponStatus.Charging);
        expect(weapon.chargeTicks).toBe(recharge - Math.floor(recharge / 2));

        weapon.pauseTimer(100 + recharge);
        weapon.resumeTimer(100 + recharge * 2);
        expect(weapon.status).toBe(SuperWeaponStatus.Ready);
        expect(weapon.chargeTicks).toBe(0);
    });

    test("ordinary paused timers do not charge while unavailable", () => {
        const weapon = new SuperWeapon("Normal", makeRules(), {});
        const recharge = weapon.rechargeTicks;

        weapon.pauseTimer(10);
        weapon.resumeTimer(10 + recharge);

        expect(weapon.status).toBe(SuperWeaponStatus.Charging);
        expect(weapon.chargeTicks).toBe(recharge);
    });

    test("resetTimer clears the virtual unavailable interval", () => {
        const weapon = new SuperWeapon("Virtual", makeRules({ swVirtualCharge: true }), {});

        weapon.pauseTimer(20);
        weapon.resetTimer();
        weapon.resumeTimer(20 + weapon.rechargeTicks);

        expect(weapon.status).toBe(SuperWeaponStatus.Charging);
        expect(weapon.chargeTicks).toBe(weapon.rechargeTicks);
    });

    test("scanner keeps charge-state keys separate from generic SW handlers", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: `[Initial]\nType=GenericWarhead\nSW.InitialReady=yes\nSW.VirtualCharge=yes\n`,
        }]);
        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-charge-state");

        expect(usage?.occurrences).toBe(2);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
