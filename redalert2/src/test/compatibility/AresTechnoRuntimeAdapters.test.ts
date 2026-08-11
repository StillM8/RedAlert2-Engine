import { describe, expect, test } from "bun:test";
import { parseAresTechnoExtensions } from "@/extensions/ares/AresTechnoExtensions";
import {
    getAresPoweredByProviderId,
    isAresPoweredByProviderOnline,
    isAresPoweredBySatisfied,
    matchesAresPoweredByProvider,
    resolveAresIfvDecision,
    resolveAresPoweredByDecision,
} from "@/extensions/ares/AresTechnoRuntimeAdapters";
import { IniFile } from "@/data/IniFile";

function technoRules(source: string) {
    return parseAresTechnoExtensions(new IniFile(source).getSection("Techno")!);
}

describe("Ares Techno runtime decision adapters", () => {
    test("selects the first passenger mode and maps it to the 1-based weapon/turret", () => {
        const rules = technoRules(`
[Techno]
WeaponTurretIndex5=7
WeaponUIName5=Name_CustomIFVWeapon
`);

        const decision = resolveAresIfvDecision(rules.ifv, [
            { rules: { ifvMode: 4 } },
            { ifvMode: 1 },
        ]);

        expect(decision).toEqual({
            mode: 4,
            weaponNumber: 5,
            turretIndex: 7,
            uiName: "Name_CustomIFVWeapon",
        });
    });

    test("uses deterministic IFV fallbacks without inventing a passenger decision", () => {
        const rules = technoRules("[Techno]\nWeaponTurretIndex1=-1\n");

        expect(resolveAresIfvDecision(rules.ifv)).toBeUndefined();
        expect(resolveAresIfvDecision(rules.ifv, [{}])).toEqual({
            mode: 0,
            weaponNumber: 1,
            turretIndex: -1,
        });
    });

    test("matches PoweredBy IDs case-insensitively while preserving the provider ID", () => {
        const rules = technoRules("[Techno]\nPoweredBy=PowerCore,AuxGenerator\n").poweredBy;
        const provider = { rules: { name: "auxgenerator" } };

        expect(getAresPoweredByProviderId(provider)).toBe("auxgenerator");
        expect(matchesAresPoweredByProvider(rules, provider)).toBe(true);
        expect(matchesAresPoweredByProvider(rules, { name: "Unrelated" })).toBe(false);
    });

    test("requires one matching provider to be online using Antares gates", () => {
        const rules = technoRules("[Techno]\nPoweredBy=PowerCore,AuxGenerator\n").poweredBy;
        const warped = {
            rules: { name: "PowerCore" },
            warpedOutTrait: { isActive: () => true },
            poweredTrait: { isPoweredOn: () => true },
        };
        const online = {
            rules: { name: "AuxGenerator" },
            empTrait: { isUnderEMP: () => false },
            operatorTrait: { isOffline: () => false },
            poweredTrait: {
                online: true,
                isPoweredOn() {
                    return this.online;
                },
            },
        };

        expect(isAresPoweredByProviderOnline(warped)).toBe(false);
        expect(resolveAresPoweredByDecision(rules, [warped, online])).toMatchObject({
            powered: true,
            matchingProviderCount: 2,
            onlineProvider: online,
        });
        expect(isAresPoweredBySatisfied(rules, [warped, online])).toBe(true);
    });

    test("rejects matching providers that are EMP-disabled, unoperated, or offline", () => {
        const rules = technoRules("[Techno]\nPoweredBy=PowerCore\n").poweredBy;
        const base = {
            rules: { name: "PowerCore" },
            empTrait: { isUnderEMP: () => false },
            operatorTrait: { isOffline: () => false },
            poweredTrait: { isPoweredOn: () => true },
        };

        expect(isAresPoweredByProviderOnline({
            ...base,
            empTrait: { isUnderEMP: () => true },
        })).toBe(false);
        expect(isAresPoweredByProviderOnline({
            ...base,
            operatorTrait: { isOffline: () => true },
        })).toBe(false);
        expect(isAresPoweredByProviderOnline({
            ...base,
            poweredTrait: { isPoweredOn: () => false },
        })).toBe(false);
        expect(resolveAresPoweredByDecision(rules, [base]).powered).toBe(true);
    });
});
