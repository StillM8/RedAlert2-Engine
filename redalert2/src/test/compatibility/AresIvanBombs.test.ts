import { describe, expect, test } from "bun:test";
import { IniFile, IniSection } from "@/data/IniFile";
import {
    parseAresIvanBombRules,
    resolveAresIvanBombFrame,
    resolveAresIvanBombRules,
} from "@/extensions/ares/AresIvanBombs";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { WeaponRules } from "@/game/rules/WeaponRules";
import { TntChargeTrait } from "@/game/gameobject/trait/TntChargeTrait";
import { NotifySell } from "@/game/gameobject/trait/interface/NotifySell";
import { TntFxPlugin } from "@/engine/renderable/entity/plugin/TntFxPlugin";

describe("Ares customizable Ivan Bombs", () => {
    test("parses weapon-local overrides while retaining documented defaults", () => {
        const section = new IniSection("MOIvanBomb");
        section.set("IvanBomb.Warhead", "VirusWH");
        section.set("IvanBomb.Damage", "420");
        section.set("IvanBomb.Detachable", "no");
        section.set("IvanBomb.DestroysBridges", "no");
        section.set("IvanBomb.Delay", "160");
        section.set("IvanBomb.AttachSound", "LilZapperAttackBridge");
        section.set("IvanBomb.TickingSound", "Dummy");
        section.set("IvanBomb.Image", "VIRSBOMB");
        section.set("IvanBomb.FlickerRate", "6");
        section.set("IvanBomb.CanDetonateTimeBomb", "no");
        section.set("IvanBomb.DetonateOnSell", "no");

        expect(parseAresIvanBombRules(section)).toEqual({
            deathBomb: false,
            deathBombOnAllies: false,
            destroysBridges: false,
            detachable: false,
            damage: 420,
            delay: 160,
            tickingSound: "Dummy",
            attachSound: "LilZapperAttackBridge",
            warhead: "VirusWH",
            image: "VIRSBOMB",
            flickerRate: 6,
            canDetonateTimeBomb: false,
            canDetonateDeathBomb: undefined,
            detonateOnSell: false,
        });

        const resolved = resolveAresIvanBombRules(
            parseAresIvanBombRules(section),
            {
                ivanDamage: 1000,
                ivanTimedDelay: 450,
                ivanIconFlickerRate: 8,
                ivanWarhead: "IvanWH",
                canDetonateTimeBomb: true,
                canDetonateDeathBomb: true,
            },
            false,
        );
        expect(resolved.damage).toBe(420);
        expect(resolved.delay).toBe(160);
        expect(resolved.warhead).toBe("VirusWH");
        expect(resolved.detachable).toBe(false);
        expect(resolved.detonateOnSell).toBe(false);
    });

    test("uses global combat-damage fallbacks when overrides are absent", () => {
        const resolved = resolveAresIvanBombRules(
            parseAresIvanBombRules(new IniSection("PlainWeapon")),
            {
                ivanDamage: 420,
                ivanTimedDelay: 450,
                ivanIconFlickerRate: 8,
                ivanWarhead: "IvanWH",
                canDetonateTimeBomb: false,
                canDetonateDeathBomb: false,
            },
            false,
        );

        expect(resolved).toMatchObject({
            damage: 420,
            delay: 450,
            flickerRate: 8,
            warhead: "IvanWH",
            canDetonateTimeBomb: false,
            canDetonateDeathBomb: false,
            destroysBridges: true,
            detachable: true,
            detonateOnSell: true,
        });
    });

    test("resolves the complete image frame and flicker schedule", () => {
        expect(resolveAresIvanBombFrame({
            currentFrame: 0,
            plantingFrame: 0,
            delay: 90,
            imageFrames: 10,
            flickerRate: 0,
        })).toBe(0);
        expect(resolveAresIvanBombFrame({
            currentFrame: 45,
            plantingFrame: 0,
            delay: 90,
            imageFrames: 10,
            flickerRate: 0,
        })).toBe(4);
        expect(resolveAresIvanBombFrame({
            currentFrame: 55,
            plantingFrame: 10,
            delay: 90,
            imageFrames: 10,
            flickerRate: 5,
        })).toBe(5);
        expect(resolveAresIvanBombFrame({
            currentFrame: 12,
            plantingFrame: 0,
            delay: 90,
            imageFrames: 10,
            flickerRate: 5,
            deathBomb: true,
        })).toBe(9);
    });

    test("handles zero delay, invalid images, and zero flicker safely", () => {
        expect(resolveAresIvanBombFrame({
            currentFrame: 100,
            plantingFrame: 100,
            delay: 0,
            imageFrames: 6,
            flickerRate: 3,
        })).toBe(0);
        expect(resolveAresIvanBombFrame({
            currentFrame: 100,
            plantingFrame: 0,
            delay: 10,
            imageFrames: 0,
            flickerRate: 3,
        })).toBe(0);
        expect(resolveAresIvanBombFrame({
            currentFrame: 100,
            plantingFrame: 0,
            delay: 10,
            imageFrames: 6,
            flickerRate: 0,
        })).toBe(5);
    });

    test("drives the bomb animation from the complete image frame set", () => {
        let active = true;
        let frame = 0;
        const requestedFrames: number[] = [];
        let requestedImageFrames = 0;
        const animObject = {};
        const anim = {
            setRenderOrder: () => undefined,
            create3DObject: () => undefined,
            get3DObject: () => animObject,
            setFrame: (value: number) => requestedFrames.push(value),
            dispose: () => undefined,
        };
        const renderableObject = {
            add: () => undefined,
            remove: () => undefined,
        };
        const trait = {
            hasCharge: () => active,
            getBombImageName: () => "CUSTOM",
            getBombFrame: (imageFrames: number) => {
                requestedImageFrames = imageFrames;
                return frame;
            },
            getChargeOwner: () => ({}),
            getTickingSound: () => "Tick",
        };
        const plugin = new TntFxPlugin(
            { isDestroyed: false, isCrashing: false, rules: { leaveRubble: false }, owner: {} },
            trait,
            4,
            { get3DObject: () => renderableObject },
            { findByObjectArt: () => ({ numImages: 6 }) },
            { hasObject: () => true, getObject: () => ({}) },
            { haveSharedIntel: () => true },
            { value: null },
            { playEffect: () => ({ stop: () => undefined }) },
            () => anim,
        );
        plugin.onCreate();
        plugin.update(0);
        frame = 5;
        plugin.update(16);
        active = false;
        plugin.update(32);
        expect(requestedImageFrames).toBe(6);
        expect(requestedFrames).toEqual([0, 5]);
    });

    test("routes weapon-local bomb fields through WeaponRules", () => {
        const section = new IniSection("MOWeapon");
        section.set("Damage", "1");
        section.set("Projectile", "Invisible");
        section.set("Warhead", "IvanWH");
        section.set("IvanBomb.Delay", "75");
        section.set("IvanBomb.DestroysBridges", "no");

        const rules = new WeaponRules(section);

        expect(rules.aresIvanBomb.delay).toBe(75);
        expect(rules.aresIvanBomb.destroysBridges).toBe(false);
    });

    test("stores the resolved charge contract and honors DetonateOnSell", () => {
        const trait = new TntChargeTrait();
        const charge = resolveAresIvanBombRules(
            parseAresIvanBombRules(new IniSection("MOWeapon")),
            { ivanDamage: 10, ivanTimedDelay: 20, ivanWarhead: "IvanWH" },
            false,
        );
        expect(trait.setCharge(20, 3, { player: "attacker" }, charge)).toBe(true);
        expect(trait.setCharge(40, 3, { player: "other" }, charge)).toBe(false);
        expect(trait.getTicksLeft()).toBe(20);
        expect(trait.canBeDisarmed()).toBe(true);

        let detonations = 0;
        (trait as any).detonateIvanWarhead = () => {
            detonations++;
            trait.removeCharge();
        };
        trait[NotifySell.onSell]({} as any, {} as any);
        expect(detonations).toBe(1);
        expect(trait.hasCharge()).toBe(false);
    });

    test("classifies authored custom bomb fields as one Ares capability", () => {
        const ini = new IniFile(`
[WeaponTypes]
0=MOIvan
[MOIvan]
IvanBomb.Warhead=VirusWH
IvanBomb.Damage=420
IvanBomb.Detachable=no
IvanBomb.DestroysBridges=no
IvanBomb.Delay=160
IvanBomb.AttachSound=Dummy
IvanBomb.TickingSound=Dummy
IvanBomb.Image=VIRSBOMB
IvanBomb.FlickerRate=6
IvanBomb.CanDetonateTimeBomb=no
IvanBomb.CanDetonateDeathBomb=no
IvanBomb.DetonateOnSell=no
`);
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: ini.toString(),
        }]);
        const usage = report.featureUsage.find((entry) => entry.featureId === "ares.custom-ivan-bombs");
        expect(usage?.occurrences).toBe(12);
        expect(usage?.definitionCount).toBe(1);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
