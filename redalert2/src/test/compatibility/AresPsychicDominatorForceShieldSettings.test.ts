import { describe, expect, spyOn, test } from "bun:test";
import { IniFile } from "@/data/IniFile";
import { ObjectType } from "@/engine/type/ObjectType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { Coords } from "@/game/Coords";
import { EventType } from "@/game/event/EventType";
import { parseAresSuperWeaponDefinition } from "@/extensions/ares/AresSuperWeapons";
import { ForceShieldEffect } from "@/game/superweapon/ForceShieldEffect";
import { PsychicDominatorEffect, resolvePsychicDominatorFireDelay } from "@/game/superweapon/PsychicDominatorEffect";
import { SuperWeaponRules } from "@/game/rules/SuperWeaponRules";
import { Warhead } from "@/game/Warhead";

function tile(rx: number, ry: number, z = 0) {
    return { rx, ry, z };
}

function objectAt(
    objectTile: ReturnType<typeof tile>,
    owner: any,
    type: ObjectType,
    options: {
        immuneToPsionics?: boolean;
        mind?: { active: boolean; permanent?: boolean };
    } = {},
) {
    const active = { value: options.mind?.active ?? false };
    const permanent = { value: options.mind?.permanent ?? false };
    const protection: Array<{ duration: number; source?: string }> = [];
    const permanentCalls: boolean[] = [];
    const rules = {
        type,
        immuneToPsionics: options.immuneToPsionics ?? false,
        slaved: false,
        missileSpawn: false,
    };
    const mindControllableTrait = {
        isActive: () => active.value || permanent.value,
        isPermanent: () => permanent.value,
        getController: () => undefined,
        makePermanent: (value: boolean) => {
            permanentCalls.push(value);
            active.value = false;
            permanent.value = value;
        },
    };
    return {
        tile: objectTile,
        owner,
        rules,
        isDestroyed: false,
        isTechno: () => true,
        isUnit: () => type !== ObjectType.Building,
        isBuilding: () => type === ObjectType.Building,
        isInfantry: () => type === ObjectType.Infantry,
        isVehicle: () => type === ObjectType.Vehicle,
        isAircraft: () => type === ObjectType.Aircraft,
        mindControllableTrait,
        invulnerableTrait: {
            setActiveFor: (duration: number, _tick: number, source?: string) => {
                protection.push({ duration, source });
            },
        },
        protection,
        permanentCalls,
    };
}

function gameFor(objects: any[], general: Record<string, any> = {}) {
    const events: any[] = [];
    const owner = { id: "owner" };
    const ally = { id: "ally" };
    const game: any = {
        currentTick: 7,
        events: { dispatch: (event: any) => events.push(event) },
        rules: {
            general,
            combatDamage: {},
            ini: { getSection: () => undefined },
        },
        alliances: {
            areAllied: (first: any, second: any) =>
                (first === owner && second === ally) || (first === ally && second === owner),
        },
        map: {
            getTileZone: () => ZoneType.Ground,
            tileOccupation: {
                getBridgeOnTile: () => undefined,
                calculateTilesForGameObject: (objectTile: any) => [objectTile],
            },
        },
        getWorld: () => ({ getAllObjects: () => objects }),
        changeObjectOwner: (object: any, newOwner: any) => {
            object.owner = newOwner;
        },
    };
    return { game, events, owner, ally };
}

describe("Ares Psychic Dominator and Force Shield settings", () => {
    test("parses every documented authored field and type defaults", () => {
        const ini = new IniFile(`
[Dom]
Type=PsychicDominator
SW.Damage=321
SW.Warhead=CustomWH
SW.Range=2.5
SW.AffectsHouse=owner
SW.AffectsTarget=units
Dominator.FirstAnim=FIRST
Dominator.FirstAnimHeight=800
Dominator.SecondAnim=SECOND
Dominator.SecondAnimHeight=25
Dominator.FireAtPercentage=40
Dominator.ControlAnim=RING
Dominator.Capture=no
Dominator.Ripple=no
Dominator.CaptureMindControlled=no
Dominator.CapturePermaMindControlled=no
Dominator.CaptureImmuneToPsionics=yes
Dominator.PermanentCapture=no
[Shield]
Type=ForceShield
SW.AffectsHouse=owner
SW.AffectsTarget=all
SW.RequiresHouse=owner
SW.RequiresTarget=buildings
Protect.Duration=17
Protect.PowerOutage=19
Protect.PlayFadeSoundTime=3
SpecialSound=FADE
`);
        const dominator = parseAresSuperWeaponDefinition(ini.getSection("Dom")!);
        const shield = parseAresSuperWeaponDefinition(ini.getSection("Shield")!);

        expect(dominator).toMatchObject({
            swDamage: 321,
            swWarhead: "CustomWH",
            swRange: [2.5],
            swAffectsHouse: "owner",
            swAffectsTarget: "units",
            dominatorFirstAnim: "FIRST",
            dominatorFirstAnimHeight: 800,
            dominatorSecondAnim: "SECOND",
            dominatorSecondAnimHeight: 25,
            dominatorFireAtPercentage: 40,
            dominatorControlAnim: "RING",
            dominatorCapture: false,
            dominatorRipple: false,
            dominatorCaptureMindControlled: false,
            dominatorCapturePermaMindControlled: false,
            dominatorCaptureImmuneToPsionics: true,
            dominatorPermanentCapture: false,
        });
        expect(shield).toMatchObject({
            swAffectsHouse: "owner",
            swAffectsTarget: "all",
            swRequiresHouse: "owner",
            swRequiresTarget: "buildings",
            swAnimationHeight: 5,
            protectDuration: 17,
            protectPowerOutage: 19,
            protectPlayFadeSoundTime: 3,
            specialSound: "FADE",
        });
        expect(parseAresSuperWeaponDefinition(new IniFile("[D]\nType=PsychicDominator\nSW.Damage=null").getSection("D")!)?.swDamage).toBe(0);
    });

    test("resolves global defaults while preserving authored zero values", () => {
        const ini = new IniFile(`
[Dom]
Type=PsychicDominator
SW.Damage=0
[Shield]
Type=ForceShield
`);
        const general = {
            dominatorCaptureRange: 3,
            dominatorDamage: 900,
            dominatorWarhead: "GlobalDomWH",
            dominatorFirstAnim: "GLOBAL_FIRST",
            dominatorSecondAnim: "GLOBAL_SECOND",
            dominatorFireAtPercentage: 30,
            forceShieldRadius: 6,
            forceShieldDuration: 450,
            forceShieldBlackoutDuration: 550,
            forceShieldPlayFadeSoundTime: 75,
            forceShieldInvokeAnim: "GLOBAL_SHIELD",
        };
        const combatDamage = { permaControlledAnimationType: "GLOBAL_RING" };
        const dominator = new SuperWeaponRules(0).readIni(
            ini.getSection("Dom")!,
            general,
            combatDamage,
        );
        const shield = new SuperWeaponRules(1).readIni(
            ini.getSection("Shield")!,
            general,
            combatDamage,
        );

        expect(dominator.ares).toMatchObject({
            swDamage: 0,
            swRange: [3],
            swWarhead: "GlobalDomWH",
            dominatorFirstAnim: "GLOBAL_FIRST",
            dominatorSecondAnim: "GLOBAL_SECOND",
            dominatorControlAnim: "GLOBAL_RING",
            dominatorFireAtPercentage: 30,
            dominatorCapture: true,
            dominatorRipple: true,
            dominatorCaptureMindControlled: true,
            dominatorCapturePermaMindControlled: true,
            dominatorCaptureImmuneToPsionics: false,
            dominatorPermanentCapture: true,
        });
        expect(shield.ares).toMatchObject({
            swAffectsHouse: "team",
            swAffectsTarget: "buildings",
            swRequiresHouse: "team",
            swRequiresTarget: "buildings",
            swRange: [6],
            swAnimation: "GLOBAL_SHIELD",
            protectDuration: 450,
            protectPowerOutage: 550,
            protectPlayFadeSoundTime: 75,
        });
    });

    test("uses a target-centered circular capture range and authored capture gates", () => {
        const owner = { id: "owner" };
        const enemy = { id: "enemy" };
        const cardinal = objectAt(tile(11, 10), enemy, ObjectType.Vehicle);
        const diagonal = objectAt(tile(11, 11), enemy, ObjectType.Vehicle);
        const distant = objectAt(tile(13, 10), enemy, ObjectType.Vehicle);
        const activeMind = objectAt(tile(10, 10), enemy, ObjectType.Vehicle, { mind: { active: true } });
        const permanentMind = objectAt(tile(10, 10), enemy, ObjectType.Vehicle, {
            mind: { active: true, permanent: true },
        });
        const immune = objectAt(tile(10, 10), enemy, ObjectType.Infantry, { immuneToPsionics: true });
        const { game } = gameFor(
            [cardinal, diagonal, distant, activeMind, permanentMind, immune],
            { dominatorCaptureRange: 1 },
        );
        const effect = new PsychicDominatorEffect(
            "PsychicDominator",
            owner,
            tile(10, 10),
            0,
            [1],
            {
                swAffectsHouse: "all",
                swAffectsTarget: "infantry,units",
                dominatorCaptureMindControlled: false,
                dominatorCapturePermaMindControlled: true,
                dominatorCaptureImmuneToPsionics: true,
                dominatorPermanentCapture: false,
                dominatorControlAnim: "RING",
            } as any,
        );
        (effect as any).configure(game);

        const captured = (effect as any).captureUnits(game) as any[];

        expect(captured).toEqual([cardinal, permanentMind, immune]);
        expect(cardinal.owner).toBe(owner);
        expect(diagonal.owner).toBe(enemy);
        expect(distant.owner).toBe(enemy);
        expect(activeMind.owner).toBe(enemy);
        expect(permanentMind.permanentCalls).toEqual([false]);
        expect(immune.permanentCalls).toEqual([false]);

        const permanentVictim = objectAt(tile(10, 10), enemy, ObjectType.Vehicle);
        game.getWorld = () => ({ getAllObjects: () => [permanentVictim] });
        const permanentEffect = new PsychicDominatorEffect(
            "PsychicDominator",
            owner,
            tile(10, 10),
            0,
            [0],
            {
                dominatorPermanentCapture: true,
                dominatorControlAnim: "RING",
            } as any,
        );
        (permanentEffect as any).configure(game);
        (permanentEffect as any).captureUnits(game);
        expect(permanentVictim.permanentCalls).toEqual([true]);
        expect(permanentVictim.dominatorControlAnimation).toBe("RING");
    });

    test("applies Dominator damage, animation, timing, ripple, and permanent-control settings", () => {
        const owner = { id: "owner" };
        const enemy = { id: "enemy" };
        const victim = objectAt(tile(10, 10), enemy, ObjectType.Vehicle);
        const { game, events } = gameFor([victim], { dominatorFireAtPercentage: 20 });
        const effect = new PsychicDominatorEffect(
            "PsychicDominator",
            owner,
            tile(10, 10),
            0,
            [0],
            {
                swDamage: 0,
                swWarhead: "CUSTOM",
                dominatorFirstAnim: "FIRST",
                dominatorFirstAnimHeight: 750,
                dominatorSecondAnim: "SECOND",
                dominatorSecondAnimHeight: 20,
                dominatorFireAtPercentage: 0,
                dominatorCapture: false,
                dominatorRipple: true,
            } as any,
        );

        effect.onStart(game);
        expect((effect as any).ticksLeft).toBe(0);
        expect(effect.onTick(game)).toBe(true);
        expect(events.map(event => event.name)).toEqual(["FIRST", "SECOND", "IONRING"]);
        expect(Coords.worldToTileHeight(events[0].position.y)).toBeCloseTo(750);
        expect(Coords.worldToTileHeight(events[1].position.y)).toBeCloseTo(20);
        expect(Coords.worldToTileHeight(events[2].position.y)).toBeCloseTo(0);
        expect(victim.owner).toBe(enemy);

        const positive = new PsychicDominatorEffect(
            "PsychicDominator",
            owner,
            tile(10, 10),
            0,
            [0],
            { swDamage: 321, swWarhead: "CUSTOM" } as any,
        );
        const requested: string[] = [];
        game.rules.getWarhead = (name: string) => {
            requested.push(name);
            return {};
        };
        game.createTarget = () => ({});
        const detonate = spyOn(Warhead.prototype, "detonate").mockImplementation(() => undefined);
        (positive as any).detonate(game);
        expect(requested).toEqual(["CUSTOM"]);
        expect(detonate).toHaveBeenCalledTimes(1);
        expect(detonate.mock.calls[0][1]).toBe(321);
        detonate.mockRestore();
    });

    test("uses authored Force Shield duration, blackout, target filters, radius, and fade timing", () => {
        const { game, events, owner, ally } = gameFor([], {
            forceShieldRadius: 9,
            forceShieldDuration: 900,
            forceShieldBlackoutDuration: 901,
            forceShieldPlayFadeSoundTime: 900,
        });
        const enemy = { id: "enemy" };
        const ownerBuilding = objectAt(tile(10, 10), owner, ObjectType.Building);
        const allyCardinal = objectAt(tile(11, 10), ally, ObjectType.Building);
        const allyDiagonal = objectAt(tile(11, 11), ally, ObjectType.Building);
        const enemyBuilding = objectAt(tile(10, 11), enemy, ObjectType.Building);
        const ownerUnit = objectAt(tile(9, 10), owner, ObjectType.Vehicle);
        game.getWorld = () => ({ getAllObjects: () => [
            ownerBuilding,
            allyCardinal,
            allyDiagonal,
            enemyBuilding,
            ownerUnit,
        ] });
        const blackouts: number[] = [];
        owner.powerTrait = { setBlackoutFor: (duration: number) => blackouts.push(duration) };
        const effect = new ForceShieldEffect(
            "ForceShield",
            owner,
            tile(10, 10),
            [1],
            {
                swAffectsHouse: "team",
                swAffectsTarget: "buildings",
                protectDuration: 7,
                protectPowerOutage: 9,
                protectPlayFadeSoundTime: 3,
                specialSound: "FADE",
            } as any,
        );

        effect.onStart(game);

        expect(ownerBuilding.protection).toEqual([{ duration: 7, source: "force-shield" }]);
        expect(allyCardinal.protection).toHaveLength(1);
        expect(allyDiagonal.protection).toHaveLength(0);
        expect(enemyBuilding.protection).toHaveLength(0);
        expect(ownerUnit.protection).toHaveLength(0);
        expect(blackouts).toEqual([9]);
        for (let tick = 1; tick < 7; tick++) {
            expect(effect.onTick(game)).toBe(false);
        }
        expect(effect.onTick(game)).toBe(true);
        const fadeEvents = events.filter(event => event.type === EventType.TriggerSoundFx);
        expect(fadeEvents).toHaveLength(1);
        expect(fadeEvents[0].soundId).toBe("FADE");
        expect(fadeEvents[0].tile).toMatchObject({ rx: 10, ry: 10 });
    });

    test("keeps direct-effect runtime fallbacks separate from authored zero values", () => {
        const { game, owner } = gameFor([], {
            forceShieldRadius: 1,
            forceShieldDuration: 6,
            forceShieldBlackoutDuration: 8,
            forceShieldPlayFadeSoundTime: 0,
        });
        const building = objectAt(tile(10, 10), owner, ObjectType.Building);
        game.getWorld = () => ({ getAllObjects: () => [building] });
        const blackouts: number[] = [];
        owner.powerTrait = { setBlackoutFor: (duration: number) => blackouts.push(duration) };
        const effect = new ForceShieldEffect(
            "ForceShield",
            owner,
            tile(10, 10),
            undefined,
            {} as any,
        );

        effect.onStart(game);

        expect(building.protection).toEqual([{ duration: 6, source: "force-shield" }]);
        expect(blackouts).toEqual([8]);
        expect(resolvePsychicDominatorFireDelay(game, {
            dominatorFireAtPercentage: 40,
        } as any)).toBe(90);
        expect(resolvePsychicDominatorFireDelay(game, {
            dominatorFireAtPercentage: 0,
        } as any)).toBe(0);
    });
});
