import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import {
    isSonarPulseInRange,
    resolveSonarPulseRange,
    SonarPulseEffect,
} from "@/game/superweapon/SonarPulseEffect";
import { CloakableTrait } from "@/game/gameobject/trait/CloakableTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { RadarEventType } from "@/game/rules/general/RadarRules";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

function objectAt(
    owner: any,
    rx: number,
    ry: number,
    zone: ZoneType,
    existingSkip = 0,
) {
    const calls: number[] = [];
    return {
        owner,
        tile: { rx, ry, z: 0, zone },
        isTechno: () => true,
        cloakableTrait: {
            getCloakSkipTimeLeft: () => existingSkip,
            forceUncloak: (_context: any, duration: number) => calls.push(duration),
        },
        calls,
    };
}

function gameFor(objects: any[], owner: any, ally: any) {
    const events: any[] = [];
    return {
        alliances: {
            areAllied: (first: any, second: any) =>
                (first === owner && second === ally) || (first === ally && second === owner),
        },
        map: {
            tileOccupation: {},
            getTileZone: (tile: any) => tile.zone ?? ZoneType.Ground,
        },
        getWorld: () => ({ getAllObjects: () => objects }),
        events: { dispatch: (event: any) => events.push(event) },
        eventsSeen: events,
    };
}

describe("Ares SonarPulse", () => {
    test("parses the type, range, radar flag, and cloak duration", () => {
        const ini = new IniFile(`
[Pulse]
Type=SonarPulse
SW.Range=4,2
SW.AffectsHouse=Enemies
SW.AffectsTarget=Water
SW.CreateRadarEvent=yes
SonarPulse.Delay=72
`);
        const definition = parseAresSuperWeaponDefinition(ini.getSection("Pulse")!);

        expect(definition?.extensionType).toBe("SonarPulse");
        expect(definition?.swRange).toEqual([4, 2]);
        expect(definition?.swCreateRadarEvent).toBe(true);
        expect(definition?.sonarPulseDelay).toBe(72);
    });

    test("uses Antares defaults and supports full-map, circular, and rectangular ranges", () => {
        expect(resolveSonarPulseRange()).toEqual({ widthOrRange: 10, height: -1 });
        const center = { rx: 10, ry: 10, z: 0 };
        const near = { tile: { rx: 12, ry: 11, z: 0 } };
        const far = { tile: { rx: 14, ry: 10, z: 0 } };

        expect(isSonarPulseInRange(center, near, { widthOrRange: 3, height: -1 })).toBe(true);
        expect(isSonarPulseInRange(center, far, { widthOrRange: 3, height: -1 })).toBe(false);
        expect(isSonarPulseInRange(center, { tile: { rx: 8, ry: 9, z: 0 } }, { widthOrRange: 4, height: 2 })).toBe(true);
        expect(isSonarPulseInRange(center, { tile: { rx: 12, ry: 10, z: 0 } }, { widthOrRange: 4, height: 2 })).toBe(false);
        expect(isSonarPulseInRange(center, far, { widthOrRange: -1, height: -1 })).toBe(true);
    });

    test("decloaks only enemy water technos in range and preserves the longest skip duration", () => {
        const owner = { id: "owner" };
        const ally = { id: "ally" };
        const enemyWater = objectAt({ id: "enemy" }, 11, 10, ZoneType.Water, 90);
        const allyWater = objectAt(ally, 10, 10, ZoneType.Water);
        const enemyLand = objectAt({ id: "enemy-land" }, 10, 10, ZoneType.Ground);
        const enemyFar = objectAt({ id: "enemy-far" }, 20, 20, ZoneType.Water);
        const game = gameFor([enemyWater, allyWater, enemyLand, enemyFar], owner, ally);
        const effect = new SonarPulseEffect(
            "SonarPulse",
            owner as any,
            { rx: 10, ry: 10, z: 0 },
            [3],
            "Enemies",
            "Water",
            60,
        );

        effect.onStart(game as any);

        expect(enemyWater.calls).toEqual([90]);
        expect(allyWater.calls).toEqual([]);
        expect(enemyLand.calls).toEqual([]);
        expect(enemyFar.calls).toEqual([]);
    });

    test("decloaks the whole map but does not create a local radar event", () => {
        const owner = { id: "owner" };
        const ally = { id: "ally" };
        const farEnemy = objectAt({ id: "enemy" }, 200, 200, ZoneType.Water);
        const game = gameFor([farEnemy], owner, ally);
        const effect = new SonarPulseEffect(
            "SonarPulse",
            owner as any,
            undefined as any,
            [-1],
            "Enemies",
            "Water",
            60,
            true,
        );

        effect.onStart(game as any);

        expect(farEnemy.calls).toEqual([60]);
        expect(game.eventsSeen).toEqual([]);
    });

    test("uses the host radar event path for ranged sonar when requested", () => {
        const owner = { id: "owner" };
        const ally = { id: "ally" };
        const game = gameFor([], owner, ally);
        const effect = new SonarPulseEffect(
            "SonarPulse",
            owner as any,
            { rx: 10, ry: 10, z: 0 },
            [3],
            "Enemies",
            "Water",
            60,
            true,
        );

        effect.onStart(game as any);

        expect(game.eventsSeen).toHaveLength(1);
        expect(game.eventsSeen[0].radarEventType).toBe(RadarEventType.SuperweaponActivated);
    });

    test("keeps a separate cloak-skip timer and does not shorten it", () => {
        const events: any[] = [];
        const target = {
            isVehicle: () => false,
            temporalTrait: { getTarget: () => undefined },
        };
        const cloak = new CloakableTrait(target, 0);
        const context = { events: { dispatch: (event: any) => events.push(event) } };

        cloak[NotifyTick.onTick](target, context);
        expect(cloak.isCloaked()).toBe(true);

        cloak.forceUncloak(context, 5);
        cloak.forceUncloak(context, 2);
        expect(cloak.isCloaked()).toBe(false);
        expect(cloak.getCloakSkipTimeLeft()).toBe(5);

        for (let i = 0; i < 4; i++) {
            cloak[NotifyTick.onTick](target, context);
            expect(cloak.isCloaked()).toBe(false);
        }
        cloak[NotifyTick.onTick](target, context);
        expect(cloak.isCloaked()).toBe(true);
        expect(events.length).toBe(3);
    });
});
