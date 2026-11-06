import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { AresPoweredByTrait } from "@/game/gameobject/trait/AresPoweredByTrait";
import { AresInitialPayloadTrait } from "@/game/gameobject/trait/AresInitialPayloadTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";

/**
 * Regression coverage for the documented Ares superweapon handler tag
 * families (Lightning.*, Nuke.*, Dominator.*, Chronosphere.*, Protect.*,
 * Mutate.*, ParaDrop.*, SpyPlane.*, Message.*, Light.*, and the DropPod
 * weapon/trailer sentinels). These families were previously dropped by the
 * rules parser and reported as "unclassified" by the compatibility scanner,
 * silently losing authored data and understating Ares coverage.
 */

const TAG_FAMILY_FIXTURE = `
[TagSW]
Type=LightningStorm
Nuke.SiloWood=NUKEWOOD
Dominator.Warhead=MOImpact
Protect.Duration=300
Mutate.Warhead=MOBigBlue
ParaDrop.Types=E1
SpyPlane.Sight=10
Message.Launch=MSG:MO_Launch
Light.Flash=2
Lightning.IgnoreLightningRod=yes
DropPodWeapon=NotAWeapon
DropPodTrailer=FALLGUY
`;

const TAG_FAMILY_KEYS = [
    "Nuke.SiloWood",
    "Dominator.Warhead",
    "Protect.Duration",
    "Mutate.Warhead",
    "ParaDrop.Types",
    "SpyPlane.Sight",
    "Message.Launch",
    "Light.Flash",
    "Lightning.IgnoreLightningRod",
    "DropPodWeapon",
    "DropPodTrailer",
];

describe("Ares superweapon handler tag families", () => {
    test("parser preserves documented handler tag families in extensionEntries", () => {
        const ini = new IniFile(TAG_FAMILY_FIXTURE);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("TagSW")!);
        for (const key of TAG_FAMILY_KEYS) {
            expect(definition?.extensionEntries.has(key)).toBe(true);
        }
    });

    test("scanner classifies documented handler tag families as ares-known", () => {
        const report = scanMentalOmegaIniSources([
            { name: "rulesmo.ini", contents: TAG_FAMILY_FIXTURE },
        ]);
        // Every handler tag is Ares-known; Type= remains vanilla; nothing is
        // left unclassified.
        expect(report.aresKnownKeys).toBe(TAG_FAMILY_KEYS.length);
        expect(report.unclassifiedKeys).toBe(0);
        expect(report.vanillaKeys).toBe(1);
        for (const key of TAG_FAMILY_KEYS) {
            expect(report.unclassifiedUsage.find(
                (item) => item.key.toLowerCase() === key.toLowerCase(),
            )).toBeUndefined();
        }
    });
});

describe("Ares runtime trait lockstep hashes", () => {
    test("AresPoweredByTrait hash tracks offline/powered/tick state", () => {
        const fresh = () => new AresPoweredByTrait({});
        expect(fresh().getHash()).toBe(fresh().getHash());

        const host = () => ({
            rules: { ares: { poweredBy: { providers: ["GAPWR"] } } },
            isUnit: () => true,
            owner: { buildings: [] as any[] },
            moveTrait: { disabled: undefined as boolean | undefined, setDisabled(v: boolean) { this.disabled = v; } },
            attackTrait: { disabled: undefined as boolean | undefined, setDisabled(v: boolean) { this.disabled = v; } },
            unitOrderTrait: { getTasks: () => [] as any[] },
        });

        const poweredDown = fresh();
        const poweredDownHost = host();
        poweredDown[NotifyTick.onTick](poweredDownHost);
        expect(poweredDown.isOffline()).toBe(true);
        expect(poweredDownHost.moveTrait.disabled).toBe(true);
        expect(poweredDownHost.attackTrait.disabled).toBe(true);
        // A diverged power-down latch must change the canonical object hash.
        expect(poweredDown.getHash()).not.toBe(fresh().getHash());
    });

    test("AresInitialPayloadTrait hash distinguishes the one-shot init latch", () => {
        const fresh = new AresInitialPayloadTrait();
        expect(fresh.getHash()).toBe(new AresInitialPayloadTrait().getHash());

        const used = new AresInitialPayloadTrait();
        used[NotifySpawn.onSpawn]({ rules: {} }, {});
        expect(used.getHash()).not.toBe(fresh.getHash());
    });
});
