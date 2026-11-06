import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { createDefaultAresFeatureRegistry } from "@/extensions/ares/AresFeatureRegistry";
import { getAresCapability } from "@/extensions/ares/AresFeatureCatalog";
import { resolveAresIronCurtainDuration } from "@/extensions/ares/AresWarheadEffects";
import { WarheadDetonateFxHandler } from "@/engine/renderable/fx/handler/WarheadDetonateFxHandler";
import { EventType } from "@/game/event/EventType";
import { Warhead } from "@/game/Warhead";
import { StanceType } from "@/game/gameobject/infantry/StanceType";
import { ArmorType } from "@/game/type/ArmorType";
import { WarheadRules } from "@/game/rules/WarheadRules";
import * as THREE from "three";

function infantryTarget(stance: StanceType): any {
    return {
        stance,
        rules: { armor: ArmorType.Heavy, wall: false },
        invulnerableTrait: { isActive: () => false },
        warpedOutTrait: { isInvulnerable: () => false },
        crateBonuses: { armor: 1 },
        isTechno: () => true,
        isUnit: () => true,
        isInfantry: () => true,
        isAircraft: () => false,
        isVehicle: () => false,
        isOverlay: () => false,
        isTerrain: () => false,
        isBuilding: () => false,
        isBridge: () => false,
    };
}

describe("Ares warhead effects", () => {
    test("normalizes the measured warhead fields and NUKE pre-impact default", () => {
        const section = new IniSection("MeasuredWH");
        section.set("IronCurtain.Duration", "150");
        section.set("IronCurtain.Cap", "900");
        section.set("MindControl", "yes");
        section.set("MindControl.Permanent", "yes");
        section.set("Temporal.WarpAway", "CUSTOMWARP");
        section.set("Ripple.Radius", "35");
        section.set("Deployed.Damage", "0.8");
        section.set("InfDeathAnim", "MUTATE");
        const rules = new WarheadRules(section);
        expect(rules.ironCurtainDuration).toBe(150);
        expect(rules.ironCurtainCap).toBe(900);
        expect(rules.mindControlPermanent).toBe(true);
        expect(rules.temporalWarpAway).toBe("CUSTOMWARP");
        expect(rules.rippleRadius).toBe(35);
        expect(rules.deployedDamage).toBeCloseTo(0.8, 3);
        expect(rules.infDeathAnim).toBe("MUTATE");
        expect(rules.preImpactAnim).toBeUndefined();

        const nuke = new WarheadRules(new IniSection("NUKE"));
        expect(nuke.preImpactAnim).toBe("NUKEBALL");
        const explicitNone = new IniSection("NUKE");
        explicitNone.set("PreImpactAnim", "none");
        expect(new WarheadRules(explicitNone).preImpactAnim).toBeUndefined();
    });

    test("uses the exact Iron Curtain cap algebra", () => {
        expect(resolveAresIronCurtainDuration(0, 100, -1)).toBe(100);
        expect(resolveAresIronCurtainDuration(150, 100, -1)).toBe(150);
        expect(resolveAresIronCurtainDuration(100, 50, 120)).toBe(120);
        expect(resolveAresIronCurtainDuration(150, 50, 120)).toBe(150);
        expect(resolveAresIronCurtainDuration(50, 30, 0)).toBe(80);
        expect(resolveAresIronCurtainDuration(50, -20, 0)).toBe(0);
        expect(resolveAresIronCurtainDuration(50, -20, 40)).toBe(30);
        expect(resolveAresIronCurtainDuration(50, -20, -1)).toBe(30);
        expect(resolveAresIronCurtainDuration(50, 100, 120, 0.5)).toBe(100);
        expect(resolveAresIronCurtainDuration(50, -20, 40, 0.5)).toBe(30);
        expect(resolveAresIronCurtainDuration(100, 50, 40, 0)).toBe(40);
        expect(resolveAresIronCurtainDuration(100, 50, 0, 0)).toBe(0);
        expect(resolveAresIronCurtainDuration(100, 50, -1, 0)).toBe(100);
    });

    test("applies deployed damage independently from prone damage", () => {
        const section = new IniSection("DeployedWH");
        section.set("ProneDamage", "0.5");
        section.set("Deployed.Damage", "0.8");
        const warhead = new Warhead(new WarheadRules(section) as any);
        const game = { gameOpts: { destroyableBridges: true } } as any;
        expect(warhead.computeDamage(100, infantryTarget(StanceType.Prone), game)).toBe(50);
        expect(warhead.computeDamage(100, infantryTarget(StanceType.Deployed), game)).toBe(79);
        expect(warhead.computeDamage(100, infantryTarget(StanceType.Guard), game)).toBe(100);
    });

    test("classifies the requested scanner and catalog surface", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: `
[WarheadTypes]
0=MOIron
[MOIron]
IronCurtain.Duration=100
IronCurtain.Cap=0
MindControl.Permanent=yes
Temporal.WarpAway=MOERP
Ripple.Radius=20
Deployed.Damage=0.8
InfDeathAnim=MOMUT
PreImpactAnim=MOPRE
AffectsEnemies=no
Malicious=no
[TechnoTypes]
0=MOUnit
[MOUnit]
IronCurtain.Modifier=0%
`,
        }]);
        const usage = report.featureUsage.find((entry) => entry.featureId === "ares.warhead-effects");
        expect(usage?.occurrences).toBe(11);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(report.unclassifiedKeys).toBe(0);
        expect(createDefaultAresFeatureRegistry().has("ares.warhead-effects")).toBe(true);
        expect(getAresCapability("ares.warhead-effects")?.runtimeStatus).toBe("partial");
    });

    test("routes ripple radius through the existing detonation FX path", () => {
        let listener: (event: any) => void = () => undefined;
        const game = {
            events: {
                subscribe: (type: EventType, handler: (event: any) => void) => {
                    if (type === EventType.WarheadDetonate) listener = handler;
                    return { dispose: () => undefined };
                },
            },
            rules: { audioVisual: { weatherConBolts: [] } },
        };
        const created: string[] = [];
        const manager = {
            createTransientAnim: (name: string, callback: (anim: any) => void) => {
                created.push(name);
                callback({ setPosition: () => undefined });
            },
        };
        const handler = new WarheadDetonateFxHandler(game as any, manager as any);
        handler.init();
        listener({ explodeAnim: undefined, position: new THREE.Vector3(), target: { rules: {} }, rippleRadius: 20 });
        expect(created).toEqual(["IONRING"]);
        handler.dispose();
    });
});
