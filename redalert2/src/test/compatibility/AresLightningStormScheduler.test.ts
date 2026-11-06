import { describe, expect, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import {
    createAresLightningStormSettings,
    parseAresSuperWeaponDefinition,
} from "@/extensions/ares/AresSuperWeapons";
import { LightningStormCloudEvent } from "@/game/event/LightningStormCloudEvent";
import { LightningStormManifestEvent } from "@/game/event/LightningStormManifestEvent";
import { PowerLevel } from "@/game/player/trait/PowerTrait";
import { RadarTrait as PlayerRadarTrait } from "@/game/player/trait/RadarTrait";
import { SuperWeaponRules } from "@/game/rules/SuperWeaponRules";
import { LightningStormEffect } from "@/game/superweapon/LightningStormEffect";
import { RadarTrait } from "@/game/trait/RadarTrait";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";
import { NotifySuperWeaponActivate } from "@/game/trait/interface/NotifySuperWeaponActivate";
import { NotifySuperWeaponDeactivate } from "@/game/trait/interface/NotifySuperWeaponDeactivate";
import { NotifyTick } from "@/game/trait/interface/NotifyTick";
import { SuperWeaponType } from "@/game/type/SuperWeaponType";
import { Warhead } from "@/game/Warhead";

function tile(rx: number, ry: number): any {
    return { rx, ry, z: 0 };
}

function makeGame(randomValues: readonly number[] = [], cloudDurationTicks: number = 20) {
    let randomIndex = 0;
    const events: any[] = [];
    const game: any = {
        currentTick: 0,
        updatableObjects: new Set<any>(),
        rules: {
            general: {
                flightLevel: 0,
                lightningStorm: {
                    deferment: 0,
                    damage: 111,
                    duration: 10,
                    warhead: "GlobalWH",
                    hitDelay: 1,
                    scatterDelay: 0,
                    cellSpread: 8,
                    separation: 0,
                },
            },
            audioVisual: { weatherConClouds: ["CLOUD"] },
            getWarhead: (name: string) => ({ name }),
        },
        map: {
            tiles: {
                getByMapCoords: (rx: number, ry: number) =>
                    rx >= -20 && rx <= 20 && ry >= -20 && ry <= 20 ? tile(rx, ry) : undefined,
            },
            mapBounds: {
                isWithinBounds: (target: any) =>
                    target.rx >= -20 && target.rx <= 20 && target.ry >= -20 && target.ry <= 20,
            },
            tileOccupation: { getBridgeOnTile: () => undefined },
            getTileZone: () => "Ground",
        },
        art: {
            getAnimation: () => ({
                art: { getNumber: () => 54000 / cloudDurationTicks },
            }),
        },
        generateRandomInt: () => randomValues[randomIndex++] ?? 0,
        events: { dispatch: (event: any) => events.push(event) },
        createTarget: () => ({}),
        alliances: { areAllied: () => false },
    };
    return {
        game,
        events,
        randomCalls: () => randomIndex,
    };
}

function cloudEvents(events: readonly any[]): LightningStormCloudEvent[] {
    return events.filter(event => event instanceof LightningStormCloudEvent);
}

describe("Ares Lightning Storm scheduler", () => {
    test("parses immutable per-weapon settings with global fallbacks", () => {
        const ini = new IniFile(`
[Storm]
Type=LightningStorm
SW.Damage=0
SW.Warhead=ExplicitWH
Lightning.Duration=-1
Lightning.HitDelay=0
Lightning.ScatterDelay=-1
Lightning.ScatterCount=30
Lightning.Separation=6
Lightning.RadarOutage=450
Lightning.RadarOutageAffects=team
`);
        const section = ini.getSection("Storm")!;
        const definition = parseAresSuperWeaponDefinition(section)!;
        const settings = createAresLightningStormSettings(definition);
        const rules = new SuperWeaponRules(0).readIni(section);

        expect(definition).toMatchObject({
            swDamage: 0,
            swWarhead: "ExplicitWH",
            lightningDuration: -1,
            lightningHitDelay: 0,
            lightningScatterDelay: -1,
            lightningScatterCount: 30,
            lightningSeparation: 6,
            lightningRadarOutage: 450,
            lightningRadarOutageAffects: "team",
        });
        expect(settings).toEqual({
            duration: -1,
            hitDelay: 0,
            scatterDelay: -1,
            separation: 6,
            scatterCount: 30,
            damage: 0,
            warhead: "ExplicitWH",
            radarOutage: 450,
            radarOutageAffects: "team",
        });
        expect(Object.isFrozen(settings)).toBe(true);
        expect(rules.ares?.lightningDuration).toBe(-1);
        expect(rules.ares?.swDamage).toBe(0);

        const notifications: any[][] = [];
        const notifier = {
            [NotifySuperWeaponActivate.onActivate](...args: any[]) {
                notifications.push(args);
            },
        };
        const game: any = {
            currentTick: 4,
            rules: { general: { lightningStorm: { duration: 210, deferment: 9 } } },
            traits: { filter: () => [notifier] },
            events: { dispatch: () => undefined },
        };
        const trait = new SuperWeaponsTrait();
        (trait as any).activateEffect(rules, {}, game, tile(10, 10));
        const effect = (trait as any).effects[0];
        expect(Object.isFrozen(effect.settings)).toBe(true);
        expect(effect.settings).toMatchObject({
            duration: -1,
            hitDelay: 0,
            scatterDelay: -1,
            scatterCount: 30,
            separation: 6,
            damage: 0,
            warhead: "ExplicitWH",
        });
        expect(notifications[0][5]).toEqual({
            duration: 450,
            affects: "team",
            deferment: 9,
        });
        expect(notifications[0][6]).toBe(effect);
    });

    test("keeps duration minus one active indefinitely and ends zero immediately", () => {
        const indefiniteGame = makeGame();
        const indefinite = new LightningStormEffect(
            SuperWeaponType.LightningStorm,
            {},
            tile(10, 10),
            0,
            undefined,
            false,
            { duration: -1, hitDelay: 0, scatterDelay: 0, scatterCount: 0 },
        );
        indefinite.onStart(indefiniteGame.game);
        for (let tick = 0; tick < 20; tick++) {
            expect(indefinite.onTick(indefiniteGame.game)).toBe(false);
        }
        expect((indefinite as any).manifestEndTimer).toBe(-1);
        expect(indefiniteGame.events.filter(event => event instanceof LightningStormManifestEvent)).toHaveLength(1);

        const finiteGame = makeGame();
        const finite = new LightningStormEffect(
            SuperWeaponType.LightningStorm,
            {},
            tile(10, 10),
            0,
            undefined,
            false,
            { duration: 0, hitDelay: 0, scatterDelay: 0, scatterCount: 0 },
        );
        finite.onStart(finiteGame.game);
        expect(finite.onTick(finiteGame.game)).toBe(true);
    });

    test("disables nonpositive delay streams and honors positive intervals", () => {
        const disabledGame = makeGame();
        const disabled = new LightningStormEffect(
            SuperWeaponType.LightningStorm,
            {},
            tile(10, 10),
            0,
            undefined,
            false,
            { duration: 20, hitDelay: 0, scatterDelay: -2, scatterCount: 20 },
        );
        disabled.onStart(disabledGame.game);
        for (let tick = 0; tick < 5; tick++) disabled.onTick(disabledGame.game);
        expect(cloudEvents(disabledGame.events)).toHaveLength(0);

        const directGame = makeGame();
        const direct = new LightningStormEffect(
            SuperWeaponType.LightningStorm,
            {},
            tile(10, 10),
            0,
            undefined,
            false,
            { duration: 20, hitDelay: 2, scatterDelay: 0, scatterCount: 0 },
        );
        direct.onStart(directGame.game);
        for (let tick = 0; tick < 5; tick++) direct.onTick(directGame.game);
        expect(cloudEvents(directGame.events)).toHaveLength(3);

        const scatterGame = makeGame();
        const scatter = new LightningStormEffect(
            SuperWeaponType.LightningStorm,
            {},
            tile(10, 10),
            0,
            [4, 4],
            false,
            { duration: 20, hitDelay: 0, scatterDelay: 2, scatterCount: 1 },
        );
        scatter.onStart(scatterGame.game);
        for (let tick = 0; tick < 5; tick++) scatter.onTick(scatterGame.game);
        expect(cloudEvents(scatterGame.events)).toHaveLength(3);
    });

    test("uses bounded scatter attempts and creates at most one scatter cloud per interval", () => {
        const retryGame = makeGame([3, 0, 1, 0, 0]);
        const retry = new LightningStormEffect(
            SuperWeaponType.LightningStorm,
            {},
            tile(10, 10),
            0,
            [4, 4],
            false,
            { duration: 20, hitDelay: 0, scatterDelay: 1, scatterCount: 3 },
        );
        retry.onStart(retryGame.game);
        retry.onTick(retryGame.game);
        expect(cloudEvents(retryGame.events)).toHaveLength(1);
        expect((retry as any).clouds[0].tile).toMatchObject({ rx: 11, ry: 10 });
        expect(retryGame.randomCalls()).toBe(5);

        const boundedGame = makeGame([0, 0, 0]);
        const bounded = new LightningStormEffect(
            SuperWeaponType.LightningStorm,
            {},
            tile(10, 10),
            0,
            [4, 4],
            false,
            { duration: 20, hitDelay: 0, scatterDelay: 1, scatterCount: 30 },
        );
        bounded.onStart(boundedGame.game);
        bounded.onTick(boundedGame.game);
        expect(cloudEvents(boundedGame.events)).toHaveLength(1);
        expect(boundedGame.randomCalls()).toBe(3);
    });

    test("uses Manhattan separation and accepts a candidate at the exact minimum", () => {
        const host = makeGame([2, 4, 0]);
        const effect = new LightningStormEffect(
            SuperWeaponType.LightningStorm,
            {},
            tile(10, 10),
            0,
            [12, 12],
            false,
            { duration: 20, hitDelay: 0, scatterDelay: 1, scatterCount: 2, separation: 6 },
        );
        effect.onStart(host.game);
        (effect as any).clouds.push({ tile: tile(10, 10), durationTicks: 20, ticksLeft: 20 });
        effect.onTick(host.game);
        expect(cloudEvents(host.events)).toHaveLength(1);
        expect((effect as any).clouds.map((cloud: any) => [cloud.tile.rx, cloud.tile.ry]))
            .toContainEqual([12, 14]);
    });

    test("uses explicit damage and warhead before global values", () => {
        const originalDetonate = Warhead.prototype.detonate;
        const detonations: Array<{ damage: number; warhead: string }> = [];
        (Warhead.prototype as any).detonate = function (...args: any[]) {
            detonations.push({ damage: args[1], warhead: this.rules.name });
        };

        try {
            const explicitGame = makeGame([], 2);
            const explicit = new LightningStormEffect(
                SuperWeaponType.LightningStorm,
                {},
                tile(10, 10),
                0,
                undefined,
                false,
                { duration: 20, hitDelay: 1, scatterDelay: 0, scatterCount: 0, damage: 0, warhead: "ExplicitWH" },
            );
            explicit.onStart(explicitGame.game);
            explicit.onTick(explicitGame.game);

            const fallbackGame = makeGame([], 2);
            const fallback = new LightningStormEffect(
                SuperWeaponType.LightningStorm,
                {},
                tile(10, 10),
                0,
                undefined,
                false,
                { duration: 20, hitDelay: 1, scatterDelay: 0, scatterCount: 0 },
            );
            fallback.onStart(fallbackGame.game);
            fallback.onTick(fallbackGame.game);
        }
        finally {
            (Warhead.prototype as any).detonate = originalDetonate;
        }

        expect(detonations).toEqual([
            { damage: 0, warhead: "ExplicitWH" },
            { damage: 111, warhead: "GlobalWH" },
        ]);
    });

    test("applies radar outage duration and relation after deferment", () => {
        const owner: any = { name: "Owner" };
        const ally: any = { name: "Ally" };
        const enemy: any = { name: "Enemy" };
        const players = [owner, ally, enemy];
        for (const player of players) {
            player.radarTrait = new PlayerRadarTrait();
            player.powerTrait = {
                level: PowerLevel.Normal,
                isAresBatteryActive: () => false,
            };
            player.buildings = [{
                isSpawned: true,
                isDestroyed: false,
                rules: { radar: true },
                owner: player,
            }];
        }
        const game: any = {
            currentTick: 0,
            rules: { general: { lightningStorm: { duration: 10, deferment: 0 } } },
            getCombatants: () => players,
            alliances: {
                areAllied: (left: any, right: any) =>
                    (left === owner && right === ally) || (left === ally && right === owner),
            },
            events: { dispatch: () => undefined },
        };
        const radar = new RadarTrait();
        const effect = {};
        radar[NotifyTick.onTick](game);
        expect(players.map(player => player.radarTrait.isDisabled())).toEqual([false, false, false]);

        radar[NotifySuperWeaponActivate.onActivate](
            SuperWeaponType.LightningStorm,
            owner,
            game,
            undefined,
            undefined,
            { duration: 3, deferment: 2, affects: "team" },
            effect,
        );
        game.currentTick = 2;
        radar[NotifyTick.onTick](game);
        expect(owner.radarTrait.isDisabled()).toBe(true);
        expect(ally.radarTrait.isDisabled()).toBe(true);
        expect(enemy.radarTrait.isDisabled()).toBe(false);

        game.currentTick = 5;
        radar[NotifyTick.onTick](game);
        expect(players.map(player => player.radarTrait.isDisabled())).toEqual([false, false, false]);
        radar[NotifySuperWeaponDeactivate.onDeactivate](
            SuperWeaponType.LightningStorm,
            owner,
            game,
            effect,
        );
    });

    test("restores active radar outages bound to the reconstructed effect", () => {
        const owner: any = { name: "Owner", playerListIndex: 0 };
        const players = [owner];
        for (const player of players) {
            player.radarTrait = new PlayerRadarTrait();
            player.powerTrait = { level: PowerLevel.Normal, isAresBatteryActive: () => false };
            player.buildings = [{
                isSpawned: true,
                isDestroyed: false,
                rules: { radar: true },
                owner: player,
            }];
        }
        const game: any = {
            currentTick: 0,
            rules: { general: { lightningStorm: { duration: 10, deferment: 0 } } },
            getCombatants: () => players,
            alliances: { areAllied: () => false },
            events: { dispatch: () => undefined },
        };
        const radar = new RadarTrait();
        const effect: any = { kind: "lightning" };
        owner.superWeaponsTrait = {
            effects: [effect],
            getEffectIndex: (candidate: any) => [effect].indexOf(candidate),
            getEffectAt: (index: number) => [effect][index],
        };
        radar[NotifySuperWeaponActivate.onActivate](
            SuperWeaponType.LightningStorm,
            owner,
            game,
            undefined,
            undefined,
            { duration: 30, deferment: 5, affects: "enemies" },
            effect,
        );
        game.currentTick = 7;
        radar[NotifyTick.onTick](game);

        const state = JSON.parse(JSON.stringify(radar.captureState()));
        expect(state.outages).toEqual([{
            ownerIndex: 0,
            effectIndex: 0,
            startTick: 5,
            endTick: 35,
            affects: ["enemies"],
            active: true,
        }]);

        const restoredEffect: any = { kind: "lightning" };
        const restoredOwner: any = {
            ...owner,
            superWeaponsTrait: {
                effects: [restoredEffect],
                getEffectIndex: (candidate: any) => [restoredEffect].indexOf(candidate),
                getEffectAt: (index: number) => [restoredEffect][index],
            },
        };
        const target = new RadarTrait();
        target.restoreState(state, {
            strict: true,
            resolvePlayerByIndex: () => restoredOwner,
        });
        expect(target.getHash()).toBe(radar.getHash());
        target[NotifySuperWeaponDeactivate.onDeactivate](
            SuperWeaponType.LightningStorm,
            restoredOwner,
            game,
            restoredEffect,
        );
        expect(target.getHash()).not.toBe(radar.getHash());
        expect(() => target.restoreState(state, { strict: true, resolvePlayerByIndex: () => undefined }))
            .toThrow(/unresolved effect/i);
    });

    test("accepts MO's Seperation alias while canonical Separation wins", () => {
        const ini = new IniFile(`
[Alias]
Type=LightningStorm
Lightning.Seperation=7

[Canonical]
Type=LightningStorm
Lightning.Seperation=9
Lightning.Separation=4
`);
        const alias = parseAresSuperWeaponDefinition(ini.getSection("Alias")!)!;
        const canonical = parseAresSuperWeaponDefinition(ini.getSection("Canonical")!)!;

        expect(alias.lightningSeparation).toBe(7);
        expect(createAresLightningStormSettings(alias).separation).toBe(7);
        expect(alias.extensionEntries.has("Lightning.Seperation")).toBe(true);
        expect(canonical.lightningSeparation).toBe(4);
        expect(createAresLightningStormSettings(canonical).separation).toBe(4);
        expect(canonical.extensionEntries.has("Lightning.Seperation")).toBe(true);
        expect(canonical.extensionEntries.has("Lightning.Separation")).toBe(true);
    });
});
