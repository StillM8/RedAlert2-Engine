import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { scanMentalOmegaIniSources } from "@/extensions/ares/AresCompatibilityScanner";
import { createAresSuperWeaponRadarEvent } from "@/extensions/ares/AresSuperWeaponRadar";
import { RadarEventType } from "@/game/rules/general/RadarRules";

describe("Ares SW.CreateRadarEvent", () => {
    test("parses the explicit launch flag", () => {
        const ini = new IniFile(`
[Pulse]
Type=GenericWarhead
SW.CreateRadarEvent=yes
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("Pulse")!);

        expect(definition?.swCreateRadarEvent).toBe(true);
    });

    test("notifies every combatant through the shared RadarTrait path", () => {
        const calls: any[] = [];
        const players = [{ name: "A" }, { name: "B" }, { name: "C" }];
        const radarTrait = {
            addEventForPlayer: (...args: any[]) => calls.push(args),
        };
        const game = {
            getCombatants: () => players,
            traits: { find: () => radarTrait },
        };
        const tile = { rx: 12, ry: 8 };

        expect(createAresSuperWeaponRadarEvent(tile, game)).toBe(3);
        expect(calls.map(([type, player, target]) => [type, player, target])).toEqual([
            [RadarEventType.SuperweaponActivated, players[0], tile],
            [RadarEventType.SuperweaponActivated, players[1], tile],
            [RadarEventType.SuperweaponActivated, players[2], tile],
        ]);
    });

    test("reports a distinct scanner capability", () => {
        const report = scanMentalOmegaIniSources([{
            name: "rulesmo.ini",
            contents: "[MOBlast]\nType=GenericWarhead\nSW.CreateRadarEvent=yes\n",
        }]);
        const usage = report.featureUsage.find((item) => item.featureId === "ares.superweapon-radar-event");

        expect(usage?.occurrences).toBe(1);
        expect(usage?.support?.parserImplemented).toBe(true);
        expect(usage?.support?.runtimeImplemented).toBe(true);
    });
});
