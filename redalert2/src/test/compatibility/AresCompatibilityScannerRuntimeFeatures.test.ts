import { describe, expect, test } from "bun:test";
import {
    formatMentalOmegaCompatibilityReport,
    scanMentalOmegaIniSources,
} from "@/extensions/ares/AresCompatibilityScanner";

describe("Ares compatibility scanner runtime feature classification", () => {
    test("classifies real passenger, survivor, radar jammer, and Gattling.Cycle keys", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: `
[VehicleTypes]
0=TRANSPORT

[TRANSPORT]
Passengers.Allowed=E1,E2
Passengers.Disallowed=SPY
Passengers.BySize=no
NoManualEnter=yes
NoManualUnload=yes
InitialPayload.Types=E1
InitialPayload.Nums=2
Promote.IncludePassengers=yes
Survivor.PilotCount=2
Survivor.VeteranPilotChance=50%
Survivor.ElitePassengerChance=75
RadarJamRadius=8
Gattling.Cycle=yes
`,
        }]);

        const byId = new Map(report.featureUsage.map(feature => [feature.featureId, feature]));
        expect(byId.get("ares.passenger-extensions")?.occurrences).toBe(8);
        expect(byId.get("ares.passenger-extensions")?.support?.runtimeImplemented).toBe(true);
        expect(byId.get("ares.survivors")?.occurrences).toBe(3);
        expect(byId.get("ares.survivors")?.support?.runtimeImplemented).toBe(true);
        expect(byId.get("ares.radar-jammers")?.occurrences).toBe(1);
        expect(byId.get("ares.staged-weapons")?.occurrences).toBe(1);
        expect(byId.get("ares.staged-weapons")?.support?.runtimeImplemented).toBe(true);

        const classified = report.references.filter(reference =>
            reference.key !== "0" && reference.section === "TRANSPORT");
        expect(classified.every(reference => reference.classification === "ares-known")).toBe(true);
    });

    test("report distinguishes runtime-partial from parser-only support", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: `
[VehicleTypes]
0=TRANSPORT
[TRANSPORT]
Survivor.PilotCount=1
`,
        }]);
        expect(formatMentalOmegaCompatibilityReport(report)).toContain(
            "ares.survivors: 1 occurrence(s), 1 definition(s), 1 source(s), runtime-partial",
        );
    });
});
