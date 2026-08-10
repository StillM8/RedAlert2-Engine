import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseAresSuperWeaponDefinition, resolveSuperWeaponActivationId } from "@/extensions/ares/AresSuperWeapons";
import { SuperWeaponRules } from "@/game/rules/SuperWeaponRules";
import { SuperWeaponType } from "@/game/type/SuperWeaponType";

describe("Ares superweapon definitions", () => {
    test("normalizes GenericWarhead fields without coercing its type", () => {
        const ini = new IniFile(`
[MOBlast]
Type=GenericWarhead
SW.Damage=500
SW.Warhead=MOBlastWH
SW.AffectsTarget=Land,Units
SW.AffectsHouse=Enemies
SW.RequiresTarget=Land
SW.AITargeting=Offensive
`);
        const section = ini.getSection("MOBlast")!;
        const definition = parseAresSuperWeaponDefinition(section);
        const rules = new SuperWeaponRules(12).readIni(section);

        expect(definition?.extensionType).toBe("GenericWarhead");
        expect(definition?.swDamage).toBe(500);
        expect(definition?.swWarhead).toBe("MOBlastWH");
        expect(definition?.swAffectsTarget).toBe("Land,Units");
        expect(definition?.extensionEntries.get("SW.Damage")).toBe("500");
        expect(rules.typeId).toBe("GenericWarhead");
        expect(rules.type).toBeUndefined();
        expect(rules.ares?.extensionType).toBe("GenericWarhead");
    });

    test("parses UnitDelivery, DropPod, and EMPulse fields", () => {
        const ini = new IniFile(`
[Delivery]
Type=UnitDelivery
SW.Deferment=20
SW.ActivationSound=MODeploy
Deliver.Types=E1,MOUnit
Deliver.Owner=invoker
Deliver.BaseNormal=no

[Pods]
Type=DropPod
DropPod.Types=E1,E2
DropPod.Veterancy=1.5
DropPod.Minimum=2
DropPod.Maximum=4

[Pulse]
Type=EMPulse
SW.RangeMinimum=3
SW.RangeMaximum=20
SW.MaxCount=-1
EMPulse.Cannons=EMPCannon
EMPulse.TargetSelf=yes
EMPulse.Linked=yes
EMPulse.PulseBall=none
EMPulse.PulseDelay=32
`);

        const delivery = parseAresSuperWeaponDefinition(ini.getSection("Delivery")!);
        const pods = parseAresSuperWeaponDefinition(ini.getSection("Pods")!);
        const pulse = parseAresSuperWeaponDefinition(ini.getSection("Pulse")!);

        expect(delivery?.deliverTypes).toEqual(["E1", "MOUnit"]);
        expect(delivery?.deliverBaseNormal).toBe(false);
        expect(pods?.dropPodVeterancy).toBe(1.5);
        expect(pods?.dropPodMinimum).toBe(2);
        expect(pods?.dropPodMaximum).toBe(4);
        expect(pulse?.swMaxCount).toBe(-1);
        expect(pulse?.empulseCannons).toEqual(["EMPCannon"]);
        expect(pulse?.empulseTargetSelf).toBe(true);
        expect(pulse?.empulsePulseBall).toBe("none");
    });

    test("keeps vanilla type parsing compatible and ignores ordinary sections", () => {
        const ini = new IniFile(`
[Nuke]
Type=MultiMissile
WeaponType=ICBM

[Vanilla]
RechargeTime=5
`);
        const vanilla = new SuperWeaponRules(0).readIni(ini.getSection("Nuke")!);
        const ordinary = parseAresSuperWeaponDefinition(ini.getSection("Vanilla")!);

        expect(vanilla.typeId).toBe("MultiMissile");
        expect(vanilla.type).toBe(SuperWeaponType.MultiMissile);
        expect(vanilla.ares).toBeUndefined();
        expect(ordinary).toBeUndefined();
    });

    test("resolves keys case-insensitively and preserves unmodeled extension fields", () => {
        const ini = new IniFile(`
[Custom]
type=genericwarhead
sw.damage=25%
GenericWarhead.CustomFutureFlag=yes
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("Custom")!);

        expect(definition?.extensionType).toBe("GenericWarhead");
        expect(definition?.swDamage).toBe(0.25);
        expect(definition?.extensionEntries.get("GenericWarhead.CustomFutureFlag")).toBe("yes");
    });

    test("uses authored indices for custom action identity without breaking vanilla enum callers", () => {
        const rules = [
            { index: 0, type: SuperWeaponType.MultiMissile, typeId: "MultiMissile", name: "Nuke" },
            { index: 12, typeId: "GenericWarhead", name: "MOBlast" },
        ];

        expect(resolveSuperWeaponActivationId(rules, SuperWeaponType.MultiMissile)).toBe(0);
        expect(resolveSuperWeaponActivationId(rules, "GenericWarhead")).toBe(12);
        expect(resolveSuperWeaponActivationId(rules, "MOBlast")).toBe(12);
        expect(resolveSuperWeaponActivationId(rules, 12)).toBe(12);
    });
});
