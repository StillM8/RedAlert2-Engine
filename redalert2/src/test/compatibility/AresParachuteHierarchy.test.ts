import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { AresCountryRegistry, AresSideRegistry } from "@/extensions/ares/AresSides";
import { parseAresTechnoExtensions, resolveAresParachuteAnim } from "@/extensions/ares/AresTechnoExtensions";
import { CountryRules } from "@/game/rules/CountryRules";
import { Country } from "@/game/Country";

describe("Ares parachute precedence", () => {
    test("resolves Techno then country then side then global", () => {
        const techno = new IniSection("E1");
        techno.set("Parachute.Anim", "TECHPARA");
        const technoRules = parseAresTechnoExtensions(techno);
        expect(resolveAresParachuteAnim(technoRules, "PARACH", "COUNTRYPARA", "SIDEPARA")).toBe("TECHPARA");
        expect(resolveAresParachuteAnim(undefined, "PARACH", "COUNTRYPARA", "SIDEPARA")).toBe("COUNTRYPARA");
        expect(resolveAresParachuteAnim(undefined, "PARACH", undefined, "SIDEPARA")).toBe("SIDEPARA");
        expect(resolveAresParachuteAnim(undefined, "PARACH")).toBe("PARACH");
    });

    test("persists side/country parachute defaults into runtime Country", () => {
        const sidesList = new IniSection("Sides");
        sidesList.set("0", "Foehn");
        const side = new IniSection("Foehn");
        side.set("Parachute.Anim", "FOEHNPARA");
        const countriesList = new IniSection("Countries");
        countriesList.set("0", "Guild");
        const country = new IniSection("Guild");
        country.set("Side", "Foehn");
        country.set("Multiplay", "yes");
        country.set("Parachute.Anim", "GUILDPARA");
        const sections = new Map([["Sides", sidesList], ["Foehn", side], ["Countries", countriesList], ["Guild", country]]);
        const reader = { getSection: (name: string) => sections.get(name) };
        const sides = AresSideRegistry.fromIni(reader);
        const countries = AresCountryRegistry.fromIni(reader, sides);
        expect(sides.resolve("Foehn")?.parachuteAnim).toBe("FOEHNPARA");
        expect(countries.resolve("Guild")?.parachuteAnim).toBe("GUILDPARA");
        const runtime = new Country(new CountryRules("Guild").readIni(country, sides));
        expect(runtime.parachuteAnim).toBe("GUILDPARA");
        expect(runtime.sideDefinition.parachuteAnim).toBe("FOEHNPARA");
    });
});
