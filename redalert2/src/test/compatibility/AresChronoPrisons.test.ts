import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import {
    parseAresChronoPrisonTechno,
    parseAresChronoPrisonWeapon,
} from "@/extensions/ares/AresChronoPrisons";

describe("Ares Chrono Prison / Abductor normalization", () => {
    test("parses documented weapon and techno settings case-insensitively", () => {
        const weapon = new IniSection("AbductingWeapon");
        weapon.set("ABDUCTOR", "yes");
        weapon.set("abductor.temporal", "true");
        weapon.set("Abductor.Anim", "ContainmentAnim");
        weapon.set("Abductor.ChangeOwner", "1");
        weapon.set("Abductor.AbductBelowPercent", "75%");
        weapon.set("Abductor.MaxHealth", "1250");

        const techno = new IniSection("AbductableUnit");
        techno.set("PASSENGERTURRET", "on");
        techno.set("ImmuneToAbduction", "false");

        expect(parseAresChronoPrisonWeapon(weapon)).toEqual({
            abductor: true,
            temporal: true,
            animation: "ContainmentAnim",
            changeOwner: true,
            abductBelowPercent: 0.75,
            maxHealth: 1250,
        });
        expect(parseAresChronoPrisonTechno(techno)).toEqual({
            passengerTurret: true,
            immuneToAbduction: false,
        });
    });

    test("uses Ares documented defaults when settings are absent", () => {
        expect(parseAresChronoPrisonWeapon(new IniSection("PlainWeapon"))).toEqual({
            abductor: false,
            temporal: false,
            animation: undefined,
            changeOwner: false,
            abductBelowPercent: 1,
            maxHealth: 0,
        });
        expect(parseAresChronoPrisonTechno(new IniSection("PlainTechno"))).toEqual({
            passengerTurret: false,
            immuneToAbduction: false,
        });
    });

    test("falls back safely for malformed booleans, percentages, and health", () => {
        const section = new IniSection("Malformed");
        section.set("Abductor", "sometimes");
        section.set("Abductor.Temporal", "nope");
        section.set("Abductor.AbductBelowPercent", "125%");
        section.set("Abductor.MaxHealth", "12.5");
        section.set("PassengerTurret", "maybe");
        section.set("ImmuneToAbduction", "unknown");

        expect(parseAresChronoPrisonWeapon(section)).toEqual({
            abductor: false,
            temporal: false,
            animation: undefined,
            changeOwner: false,
            abductBelowPercent: 1,
            maxHealth: 0,
        });
        expect(parseAresChronoPrisonTechno(section)).toEqual({
            passengerTurret: false,
            immuneToAbduction: false,
        });
    });

    test("accepts normalized fractions but does not reinterpret bare percentages", () => {
        const section = new IniSection("Fractions");
        section.set("Abductor.AbductBelowPercent", "0.25");
        expect(parseAresChronoPrisonWeapon(section).abductBelowPercent).toBe(0.25);

        section.set("Abductor.AbductBelowPercent", "25");
        expect(parseAresChronoPrisonWeapon(section).abductBelowPercent).toBe(1);
    });
});
