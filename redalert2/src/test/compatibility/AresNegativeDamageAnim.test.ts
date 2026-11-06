import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { Warhead } from "@/game/Warhead";

/**
 * Ares type2 bugfix "negatively damaging weapons with AnimList".
 *
 * A negative `Damage` is a repair/heal warhead. The warhead still has an
 * authored AnimList, but a repair must not detonate an explosion — and because
 * the same animation drives `AnimTerrainEffect`, it must not destroy ore
 * either. The original guard was a truthiness check, so a negative value passed
 * straight through and repair beams blew up the tile they healed.
 */
function makeGame() {
    const events: any[] = [];
    const tiles: any[] = [];
    for (let rx = 0; rx < 4; rx++) {
        for (let ry = 0; ry < 4; ry++) {
            tiles.push({ rx, ry, z: 0, rampType: 0, landType: 0 });
        }
    }
    return {
        events,
        game: {
            events: { dispatch: (event: any) => events.push(event) },
            generateRandomInt: () => 0,
            rules: {
                audioVisual: { weaponNullifyAnim: "NULLIFY", weatherConBoltExplosion: "CONB" },
                combatDamage: { c4Warhead: "C4", splashList: ["SPLASH"] },
                getLandRules: () => ({ getSpeedModifier: () => 1 }),
                radiation: { radApplicationDelay: 1, radLevelDelay: 1, radDurationMultiple: 1, radLevel: 0 },
            },
            mapShroudTrait: { getPlayerShroud: () => undefined },
            map: {
                tiles: { getByMapCoords: (rx: number, ry: number) => tiles.find(t => t.rx === rx && t.ry === ry) },
                mapBounds: { isWithinBounds: (t: any) => !!t },
                tileOccupation: { getBridgeOnTile: () => undefined },
                getObjectsOnTile: () => [],
                getGroundObjectsOnTile: () => [],
                getTileZone: () => 0,
            },
            createTarget: () => undefined,
        } as any,
    };
}

function makeWarhead(animList: string) {
    const ini = new IniFile(`
[RepairBeam]
Verses=...
Damage=-200
AnimList=${animList}
`);
    const section = ini.getSection("RepairBeam")!;
    return new Warhead({
        name: "RepairBeam",
        animList: animList ? animList.split(",") : [],
        damage: 0,
        area: 0,
        versus: {},
        wall: false,
        VERSES: section,
    } as any);
}

function detonate(warhead: Warhead, game: any, damage: number, isWeatherStorm = false) {
    const events: any[] = [];
    game.events = { dispatch: (event: any) => events.push(event) };
    warhead.detonate(
        game,
        damage,
        { rx: 1, ry: 1, z: 0 },
        0,
        { x: 0, y: 0, z: 0 },
        0,
        0,
        undefined as any,
        undefined,
        false,
        undefined,
        0,
        isWeatherStorm,
    );
    return events.filter(event => event?.constructor?.name === "WarheadDetonateEvent");
}

describe("negative damage warhead animation", () => {
    test("a negative-damage warhead plays no explosion animation", () => {
        const { game } = makeGame();
        const warhead = makeWarhead("EXPLO1,EXPLO2");
        expect(warhead.rules.animList).toEqual(["EXPLO1", "EXPLO2"]);

        const detonations = detonate(warhead, game, -200);

        expect(detonations.length).toBeGreaterThan(0);
        for (const event of detonations) {
            expect(event.explodeAnim).toBeUndefined();
        }
    });

    test("a positive-damage warhead still picks an AnimList entry", () => {
        const { game } = makeGame();
        const warhead = makeWarhead("EXPLO1,EXPLO2");
        const detonations = detonate(warhead, game, 10);

        expect(detonations.length).toBeGreaterThan(0);
        expect(detonations[0].explodeAnim).toBe("EXPLO1");
    });

    test("zero damage also plays no explosion", () => {
        const { game } = makeGame();
        const warhead = makeWarhead("EXPLO1");
        const detonations = detonate(warhead, game, 0);
        expect(detonations.length).toBeGreaterThan(0);
        for (const event of detonations) {
            expect(event.explodeAnim).toBeUndefined();
        }
    });

    test("a weather storm suppresses the animation for a negative-damage warhead too", () => {
        const { game } = makeGame();
        const warhead = makeWarhead("EXPLO1");
        const detonations = detonate(warhead, game, -200, true);
        expect(detonations.length).toBeGreaterThan(0);
        for (const event of detonations) {
            expect(event.explodeAnim).toBeUndefined();
        }
    });
});
