import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { ArmorRegistry } from "@/extensions/ares/AresArmor";
import { AudioVisualRules } from "@/game/rules/AudioVisualRules";
import { TechnoRules } from "@/game/rules/TechnoRules";
import { UnitPromoteEvent } from "@/game/event/UnitPromoteEvent";
import { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";
import { SoundKey } from "@/engine/sound/SoundKey";
import { SoundHandler } from "@/gui/screen/game/SoundHandler";

/**
 * Ares promotion presentation settings (docs: new/promotion.html).
 *
 * Per-type Promote.VeteranSound/Promote.EliteSound override the global
 * [AudioVisual] UpgradeVeteranSound/UpgradeEliteSound, EVA.VeteranPromoted/
 * EVA.ElitePromoted override EVA_UnitPromoted, and Promote.VeteranFlash/
 * Promote.EliteFlash override [AudioVisual] VeteranFlashTimer/
 * EliteFlashTimer. Mental Omega authors these on 8+ sections (54 uses each
 * of the sound keys), so the per-type path must win over the globals.
 */

function techno(section: IniSection): TechnoRules {
    return new TechnoRules(ObjectType.Infantry, section, 0, {}, new ArmorRegistry());
}

describe("Ares promotion settings parsing", () => {
    test("parses per-type sounds, flashes, and EVA overrides", () => {
        const section = new IniSection("Promoted");
        section.set("Promote.VeteranSound", "UpgradeVeteranHero");
        section.set("Promote.EliteSound", "UpgradeEliteYunru");
        section.set("Promote.VeteranFlash", "20");
        section.set("Promote.EliteFlash", "30");
        section.set("EVA.VeteranPromoted", "EVA_VeteranUnitPromoted");
        section.set("EVA.ElitePromoted", "EVA_EliteUnitPromoted");

        const rules = techno(section);
        expect(rules.promoteVeteranSound).toBe("UpgradeVeteranHero");
        expect(rules.promoteEliteSound).toBe("UpgradeEliteYunru");
        expect(rules.promoteVeteranFlash).toBe(20);
        expect(rules.promoteEliteFlash).toBe(30);
        expect(rules.evaVeteranPromoted).toBe("EVA_VeteranUnitPromoted");
        expect(rules.evaElitePromoted).toBe("EVA_EliteUnitPromoted");
    });

    test("absent keys stay undefined so documented fallbacks apply", () => {
        const rules = techno(new IniSection("Plain"));
        expect(rules.promoteVeteranSound).toBeUndefined();
        expect(rules.promoteEliteSound).toBeUndefined();
        expect(rules.promoteVeteranFlash).toBeUndefined();
        expect(rules.promoteEliteFlash).toBeUndefined();
        expect(rules.evaVeteranPromoted).toBeUndefined();
        expect(rules.evaElitePromoted).toBeUndefined();
    });

    test("global flash timers default to zero and parse authored values", () => {
        const defaults = new AudioVisualRules().readIni(new IniSection("AudioVisual"));
        expect(defaults.veteranFlashTimer).toBe(0);
        expect(defaults.eliteFlashTimer).toBe(0);

        const section = new IniSection("AudioVisual");
        section.set("VeteranFlashTimer", "18");
        section.set("EliteFlashTimer", "45");
        const parsed = new AudioVisualRules().readIni(section);
        expect(parsed.veteranFlashTimer).toBe(18);
        expect(parsed.eliteFlashTimer).toBe(45);
    });
});

describe("promotion presentation consumption", () => {
    function makeHandler() {
        const played: any[] = [];
        const spoken: string[] = [];
        const handler: any = Object.create(SoundHandler.prototype);
        handler.player = { name: "Soviet" };
        handler.sound = { play: (...args: any[]) => played.push(args) };
        handler.eva = { play: (name: string) => spoken.push(name) };
        return { handler, played, spoken };
    }

    test("per-type sounds and EVA win over the global defaults", () => {
        const { handler, played, spoken } = makeHandler();
        const target = {
            owner: handler.player,
            rules: {
                promoteVeteranSound: "UpgradeVeteranHero",
                promoteEliteSound: "UpgradeEliteYunru",
                evaVeteranPromoted: "EVA_VeteranUnitPromoted",
                evaElitePromoted: "EVA_EliteUnitPromoted",
            },
            veteranLevel: VeteranLevel.Veteran,
        };

        handler.handleUnitPromoteSound(new UnitPromoteEvent(target, VeteranLevel.Veteran));
        expect(played[0][0]).toBe("UpgradeVeteranHero");
        expect(spoken[0]).toBe("EVA_VeteranUnitPromoted");

        target.veteranLevel = VeteranLevel.Elite;
        handler.handleUnitPromoteSound(new UnitPromoteEvent(target, VeteranLevel.Elite));
        expect(played[1][0]).toBe("UpgradeEliteYunru");
        expect(spoken[1]).toBe("EVA_EliteUnitPromoted");
    });

    test("falls back to the global sounds and EVA_UnitPromoted without overrides", () => {
        const { handler, played, spoken } = makeHandler();
        const target = { owner: handler.player, rules: {}, veteranLevel: VeteranLevel.Elite };

        handler.handleUnitPromoteSound(new UnitPromoteEvent(target, VeteranLevel.Elite));
        expect(played[0][0]).toBe(SoundKey.UpgradeEliteSound);
        expect(spoken[0]).toBe("EVA_UnitPromoted");

        target.veteranLevel = VeteranLevel.Veteran;
        handler.handleUnitPromoteSound(new UnitPromoteEvent(target, VeteranLevel.Veteran));
        expect(played[1][0]).toBe(SoundKey.UpgradeVeteranSound);
    });

    test("other players' promotions are silent", () => {
        const { handler, played, spoken } = makeHandler();
        const target = { owner: { name: "Allied" }, rules: {}, veteranLevel: VeteranLevel.Elite };
        handler.handleUnitPromoteSound(new UnitPromoteEvent(target, VeteranLevel.Elite));
        expect(played).toHaveLength(0);
        expect(spoken).toHaveLength(0);
    });
});
