import { describe, expect, test } from "bun:test";
import { Projectile, ProjectileState } from "@/game/gameobject/Projectile";
import { TransientAnim } from "@/engine/renderable/entity/TransientAnim";
import { ChronoFxHandler } from "@/engine/renderable/fx/handler/ChronoFxHandler";
import { EventType } from "@/game/event/EventType";
import { DeathType } from "@/game/gameobject/common/DeathType";
import { Warhead } from "@/game/Warhead";
import { WarheadRules } from "@/game/rules/WarheadRules";
import { IniSection } from "@/data/IniSection";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";

function projectileWithPreImpact(animation: any, warheadName = "CUSTOM") {
    const projectile = new Projectile(warheadName, {}, {}, {} as any);
    (projectile as any).fromWeapon = {
        type: 0,
        warhead: { rules: { preImpactAnim: "PREIMPACT" } },
    };
    (projectile as any).maxSpeed = 1;
    (projectile as any).preImpactPending = false;
    (projectile as any).preImpactAnimName = undefined;
    (projectile as any).detonationTimer = 0;
    return { projectile, game: { art: { getAnimation: () => animation } } };
}

function damageTarget(health: number): any {
    const target: any = {
        isDestroyed: false,
        isDisposed: false,
        isCrashing: false,
        isSpawned: true,
        isInfantry: () => false,
        isTechno: () => true,
        isUnit: () => true,
        isBuilding: () => false,
        isAircraft: () => false,
        onAttack: () => undefined,
        healthTrait: {
            health,
            getHitPoints: () => health,
            inflictDamage: () => { target.healthTrait.health = 0; },
        },
        rules: { preventScatter: true },
    };
    return target;
}

function infantryTarget(): any {
    const target: any = {
        isDestroyed: false,
        isDisposed: false,
        isCrashing: false,
        isSpawned: true,
        isInfantry: () => true,
        isTechno: () => true,
        isUnit: () => true,
        isBuilding: () => false,
        isAircraft: () => false,
        onAttack: () => undefined,
        rules: { isHuman: true },
        zone: ZoneType.Ground,
        tileElevation: 0,
        tile: { rx: 1, ry: 2, z: 0 },
        position: { worldPosition: { clone: () => ({ x: 1, y: 0, z: 2 }) } },
        infDeathType: DeathType.Normal,
        healthTrait: {
            health: 1,
            getHitPoints: () => 1,
            inflictDamage: () => { target.healthTrait.health = 0; },
        },
    };
    return target;
}

describe("Ares pre-impact and temporal effects", () => {
    test("waits for the authored pre-impact animation before completing detonation", () => {
        const { projectile, game } = projectileWithPreImpact({ durationTicks: 4 });
        let completions = 0;
        (projectile as any).completeDetonation = () => { completions++; };
        (projectile as any).detonate(game);
        expect((projectile as any).state).toBe(ProjectileState.Impact);
        expect((projectile as any).detonationTimer).toBe(4);
        expect(completions).toBe(0);
        for (let tick = 0; tick < 3; tick++) projectile.update(game);
        expect(completions).toBe(0);
        projectile.update(game);
        expect(completions).toBe(1);
    });

    test("ends looping pre-impact animations after one pass", () => {
        const animation: any = Object.create(TransientAnim.prototype);
        animation.forceOneShot = true;
        animation.finished = false;
        animation.isAnimNotStarted = () => false;
        animation.isAnimFinished = () => false;
        let ended = 0;
        animation.endAnimationLoop = () => { ended++; };
        animation.update(0);
        expect(ended).toBe(1);
    });

    test("uses WarpAway overrides only for temporal destruction", () => {
        const listeners: Record<string, (event: any) => void> = {};
        const game: any = {
            events: {
                subscribe: (type: EventType, callback: (event: any) => void) => {
                    listeners[type] = callback;
                    return { dispose: () => undefined };
                },
            },
            rules: { audioVisual: { warpOut: "WARPIN", warpAway: "WARPOUT" } },
        };
        const names: string[] = [];
        const handler = new ChronoFxHandler(game, {
            createTransientAnim: (name: string, callback: (anim: any) => void) => {
                names.push(name);
                callback({ setPosition: () => undefined });
            },
        });
        handler.init();
        const target: any = {
            deathType: DeathType.Temporal,
            temporalWarpAwayOverride: "CUSTOM",
            isBuilding: () => false,
            tile: { rx: 0, ry: 0, z: 0 },
            position: { getTileOffset: () => ({ multiplyScalar: () => ({ x: 0, y: 0 }) }) },
        };
        listeners[EventType.ObjectDestroy]?.({ target });
        expect(names).toEqual(["CUSTOM"]);
        target.temporalWarpAwayOverride = undefined;
        target.deathType = DeathType.Temporal;
        listeners[EventType.ObjectDestroy]?.({ target });
        expect(names).toEqual(["CUSTOM", "WARPOUT"]);
        handler.dispose();
    });

    test("routes nonmutation InfDeathAnim through TriggerAnim and leaves numeric InfDeath fallback intact", () => {
        const section = new IniSection("InfDeathWH");
        section.set("InfDeathAnim", "DEATHANIM");
        section.set("PreventScatter", "yes");
        const warhead = new Warhead(new WarheadRules(section));
        const target = infantryTarget();
        const events: any[] = [];
        const game: any = {
            art: { getAnimation: () => ({ makeInfantry: -1 }) },
            traits: { filter: () => [] },
            events: { dispatch: (event: any) => events.push(event) },
            destroyObject: () => { target.isDestroyed = true; },
            startAresMakeInfantryFromInfDeathAnim: () => { throw new Error("unexpected mutation"); },
        };
        warhead.inflictDamage(1, target, undefined, game);
        expect(events).toHaveLength(2);
        expect(events[0]).toBeDefined();
        expect(target.aresInfDeathAnimationHandled).toBe(true);

        const fallbackSection = new IniSection("NumericInfDeath");
        fallbackSection.set("PreventScatter", "yes");
        const fallbackWarhead = new Warhead(new WarheadRules(fallbackSection));
        const fallbackTarget = infantryTarget();
        let destroyed = false;
        fallbackWarhead.inflictDamage(1, fallbackTarget, undefined, {
            traits: { filter: () => [] },
            events: { dispatch: () => undefined },
            destroyObject: () => { destroyed = true; },
        } as any);
        expect(destroyed).toBe(true);
    });

    test("recognizes a mutation InfDeathAnim without routing it through TriggerAnim", () => {
        const section = new IniSection("MutationWH");
        section.set("InfDeathAnim", "MUTATIONANIM");
        section.set("PreventScatter", "yes");
        const warhead = new Warhead(new WarheadRules(section));
        const target = infantryTarget();
        let mutationStarted = false;
        const eventNames: string[] = [];
        const result = warhead.inflictDamage(1, target, undefined, {
            art: { getAnimation: () => ({ makeInfantry: 0 }) },
            traits: { filter: () => [] },
            events: { dispatch: (event: any) => { eventNames.push(event.constructor.name); } },
            destroyObject: () => { throw new Error("mutation must defer destruction"); },
            startAresMakeInfantryFromInfDeathAnim: () => { mutationStarted = true; return true; },
        } as any);
        expect(result).toBe(true);
        expect(mutationStarted).toBe(true);
        expect(eventNames).not.toContain("TriggerAnimEvent");
    });
});
