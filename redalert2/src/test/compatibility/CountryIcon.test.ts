import { describe, expect, test } from "bun:test";
import { resolveCountryIconFilename } from "@/gui/component/CountryIcon";

describe("country presentation resources", () => {
    test("prefers a data-defined country flag over retail name fallbacks", () => {
        expect(resolveCountryIconFilename({
            id: "EpsilonCountry",
            name: "EpsilonCountry",
            flag: "epsilon_flag",
        })).toBe("epsilon_flag.pcx");
        expect(resolveCountryIconFilename({
            id: "EpsilonCountry",
            name: "EpsilonCountry",
            flag: "epsilon_flag.shp",
        })).toBe("epsilon_flag.shp");
    });

    test("keeps vanilla and lobby map fallback behavior case-insensitively", () => {
        expect(resolveCountryIconFilename("yuricountry")).toBe("yrii.pcx");
        expect(resolveCountryIconFilename("CustomCountry", new Map([
            ["customcountry", "custom_flag.pcx"],
        ]))).toBe("custom_flag.pcx");
    });
});
