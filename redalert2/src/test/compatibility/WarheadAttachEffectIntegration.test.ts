import { describe, expect, test } from "bun:test";
import { IniSection } from "@/data/IniSection";
import { AresAttachEffectTrait } from "@/game/gameobject/trait/AresAttachEffectTrait";
import { Warhead } from "@/game/Warhead";
import { WarheadRules } from "@/game/rules/WarheadRules";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { Vector3 } from "@/game/math/Vector3";

function makeTarget() {
    const centerCoords = new Vector3(1.5 * 256, 0, 1.5 * 256);
    const target: any = {
        tile: { rx: 1, ry: 1, z: 0 },
        position: {
            worldPosition: centerCoords,
            tileElevation: 0,
        },
        rules: { armor: 5, wall: false },
        isSpawned: true,
        isDisposed: false,
        isDestroyed: false,
        isCrashing: false,
        healthTrait: {},
        invulnerableTrait: { isActive: () => false },
        warpedOutTrait: { isInvulnerable: () => false },
        moveTrait: { reservedPathNodes: [] },
        isTechno: () => true,
        isUnit: () => true,
        isInfantry: () => false,
        isAircraft: () => false,
        isVehicle: () => true,
        isOverlay: () => false,
        isTerrain: () => false,
        isBuilding: () => false,
        isBridge: () => false,
        onAttack: () => undefined,
        applyRocking: () => undefined,
        aresAttachEffectTrait: new AresAttachEffectTrait(),
    };
    return target;
}

function makeGame(target: any, centerTile: any) {
    return {
        map: {
            tiles: { getByMapCoords: () => centerTile },
            mapBounds: { isWithinBounds: () => true },
            tileOccupation: {},
            getObjectsOnTile: (tile: any) => tile === centerTile ? [target] : [],
        },
        rules: {
            audioVisual: { weaponNullifyAnim: "" },
            combatDamage: { splashList: [], c4Warhead: "" },
        },
        events: { dispatch: () => undefined },
        mapRadiationTrait: { createRadSite: () => undefined },
        gameOpts: { destroyableBridges: true },
    } as any;
}

describe("Warhead AttachEffect integration", () => {
    test("detonation applies a Warhead AttachEffect to the live target trait", () => {
        const section = new IniSection("AttachWarhead");
        section.set("Verses", "1,1,1,1,1,100%");
        section.set("AttachEffect.Duration", "5");
        section.set("AttachEffect.SpeedMultiplier", "0.5");
        section.set("AttachEffect.Cumulative", "no");
        section.set("AttachEffect.AnimResetOnReapply", "yes");
        const warhead = new Warhead(new WarheadRules(section) as any);
        const target = makeTarget();
        const centerTile = target.tile;
        const game = makeGame(target, centerTile);
        const centerCoords = target.position.worldPosition;

        warhead.detonate(
            game,
            0,
            centerTile,
            0,
            centerCoords,
            ZoneType.Land,
            CollisionType.None,
            { obj: target },
            undefined,
            false,
            undefined,
        );

        expect(warhead.rules.aresAttachEffect).toMatchObject({
            duration: 5,
            cumulative: false,
            animResetOnReapply: true,
        });
        expect(target.aresAttachEffectTrait.getState()).toEqual([
            { effectId: "AttachWarhead", remainingFrames: 5, discardOnEntry: false },
        ]);
        expect(target.aresAttachEffectTrait.getAggregateMultipliers().speed).toBe(0.5);

        warhead.detonate(
            game,
            0,
            centerTile,
            0,
            centerCoords,
            ZoneType.Land,
            CollisionType.None,
            { obj: target },
            undefined,
            false,
            undefined,
        );
        expect(target.aresAttachEffectTrait.getState()).toEqual([
            { effectId: "AttachWarhead", remainingFrames: 5, discardOnEntry: false },
        ]);
    });
});
