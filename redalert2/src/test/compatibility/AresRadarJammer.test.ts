import { describe, expect, test } from "bun:test";
import {
    getAresRadarJamRadius,
    isAresRadarProviderJammed,
    isWithinAresRadarJamRadius,
} from "@/extensions/ares/AresRadarJammer";
import { RadarTrait } from "@/game/trait/RadarTrait";
import { NotifyTick } from "@/game/trait/interface/NotifyTick";
import { PowerLevel } from "@/game/player/trait/PowerTrait";

function tile(rx: number, ry: number): any {
    return { rx, ry };
}

function techno(owner: any, rx: number, ry: number, rules: any): any {
    return {
        owner,
        rules,
        tile: tile(rx, ry),
        isSpawned: true,
        isDestroyed: false,
        isCrashing: false,
        warpedOutTrait: { isActive: () => false },
    };
}

describe("Ares RadarJamRadius", () => {
    test("uses circular cell range and ignores zero/negative radii", () => {
        const jammer = techno({}, 0, 0, { radarJamRadius: 5 });
        expect(getAresRadarJamRadius(jammer)).toBe(5);
        expect(isWithinAresRadarJamRadius(jammer, techno({}, 3, 4, {}))).toBe(true);
        expect(isWithinAresRadarJamRadius(jammer, techno({}, 4, 4, {}))).toBe(false);
        expect(isWithinAresRadarJamRadius(techno({}, 0, 0, { radarJamRadius: -2 }), techno({}, 0, 0, {}))).toBe(false);
    });

    test("only hostile spawned jammers suppress a provider", () => {
        const radarOwner: any = {};
        const enemy: any = {};
        const ally: any = {};
        const radar = techno(radarOwner, 10, 10, { radar: true });
        const hostileJammer = techno(enemy, 12, 10, { radarJamRadius: 3 });
        const alliedJammer = techno(ally, 10, 10, { radarJamRadius: 99 });
        enemy.getOwnedObjects = () => new Set([hostileJammer]);
        ally.getOwnedObjects = () => new Set([alliedJammer]);
        radarOwner.getOwnedObjects = () => new Set([radar]);
        const game: any = {
            getCombatants: () => [radarOwner, enemy, ally],
            alliances: {
                areAllied: (left: any, right: any) =>
                    (left === ally && right === radarOwner) || (left === radarOwner && right === ally),
            },
        };

        expect(isAresRadarProviderJammed(radar, game)).toBe(true);
        hostileJammer.isSpawned = false;
        expect(isAresRadarProviderJammed(radar, game)).toBe(false);
    });

    test("one unjammed radar keeps the player's radar online", () => {
        const owner: any = {};
        const enemy: any = {};
        let disabled = false;
        owner.radarTrait = {
            isDisabled: () => disabled,
            setDisabled: (value: boolean) => { disabled = value; },
        };
        owner.powerTrait = { level: PowerLevel.Normal, isAresBatteryActive: () => false };
        const nearRadar = techno(owner, 0, 0, { radar: true });
        const farRadar = techno(owner, 20, 20, { radar: true });
        nearRadar.isBuilding = () => true;
        farRadar.isBuilding = () => true;
        owner.buildings = new Set([nearRadar]);
        owner.getOwnedObjects = () => new Set([nearRadar]);

        const jammer = techno(enemy, 2, 0, { radarJamRadius: 5 });
        enemy.getOwnedObjects = () => new Set([jammer]);
        enemy.buildings = new Set();
        enemy.radarTrait = undefined;

        const game: any = {
            currentTick: 0,
            getCombatants: () => [owner, enemy],
            alliances: { areAllied: () => false },
            events: { dispatch: () => undefined },
        };
        const trait = new RadarTrait();

        trait[NotifyTick.onTick](game);
        expect(disabled).toBe(true);

        owner.buildings.add(farRadar);
        owner.getOwnedObjects = () => new Set([nearRadar, farRadar]);
        game.currentTick = 5;
        trait[NotifyTick.onTick](game);
        expect(disabled).toBe(false);
    });
});
