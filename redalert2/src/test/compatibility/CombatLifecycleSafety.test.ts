import { describe, expect, test } from "bun:test";
import { Game } from "@/game/Game";
import { Warhead } from "@/game/Warhead";
import { TemporalTrait } from "@/game/gameobject/trait/TemporalTrait";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { EnterBuildingTask } from "@/game/gameobject/task/EnterBuildingTask";

describe("shared combat lifecycle safety", () => {
    test("ignores a stale damage reference after the target was destroyed", () => {
        let damageCalls = 0;
        const target: any = {
            isDestroyed: true,
            isDisposed: false,
            isCrashing: false,
            healthTrait: {
                inflictDamage: () => { damageCalls++; },
            },
        };
        const warhead = new Warhead({} as any);

        const applied = warhead.inflictDamage(100, target, undefined, {
            traits: { filter: () => [] },
        } as any);

        expect(applied).toBe(false);
        expect(damageCalls).toBe(0);
    });

    test("does not throw when a second destruction request races a terminal object", () => {
        const game = Object.create(Game.prototype) as Game;
        const target: any = { id: 42, isDestroyed: true, isDisposed: false };

        expect(() => game.destroyObject(target)).not.toThrow();
        expect(() => game.destroyObject({ id: 43, isDestroyed: false, isDisposed: true })).not.toThrow();
    });

    test("does not require a player on non-attributed destruction cleanup", () => {
        const game = Object.create(Game.prototype) as Game;
        (game as any).traits = { filter: () => [] };
        (game as any).events = { dispatch: () => undefined };
        const target: any = {
            isDestroyed: false,
            isDisposed: false,
            isCrashing: false,
            isSpawned: false,
            owner: undefined,
            isTechno: () => true,
            isBuilding: () => false,
            onDestroy: () => undefined,
            dispose: () => undefined,
        };

        expect(() => game.destroyObject(target, { obj: {} })).not.toThrow();
    });

    test("releases a stale temporal attacker instead of throwing", () => {
        const target: any = {
            attackTrait: undefined,
            isDestroyed: false,
            isDisposed: false,
            warpedOutTrait: { expire: () => { } },
        };
        const targetTemporal = new TemporalTrait(target);
        target.temporalTrait = targetTemporal;

        const attacker: any = {
            isDestroyed: false,
            isDisposed: false,
            temporalTrait: undefined,
        };
        const attackerTemporal = new TemporalTrait(attacker);
        attacker.temporalTrait = attackerTemporal;
        (attackerTemporal as any).currentTarget = target;
        (targetTemporal as any).attackers.add(attacker);
        (targetTemporal as any).eraseTicks = 10;

        expect(() => targetTemporal[NotifyTick.onTick](target, {} as any)).not.toThrow();
        expect((targetTemporal as any).attackers.size).toBe(0);
        expect((targetTemporal as any).eraseTicks).toBeUndefined();
    });

    test("does not start temporal state for non-warpable targets", () => {
        const target: any = {
            isDestroyed: false,
            isDisposed: false,
            rules: { warpable: false },
        };
        target.temporalTrait = new TemporalTrait(target);
        const attacker: any = { isDestroyed: false, isDisposed: false };
        attacker.temporalTrait = new TemporalTrait(attacker);

        attacker.temporalTrait.updateTarget(target, {}, {} as any);

        expect(target.temporalTrait.attackers.size).toBe(0);
        expect(attacker.temporalTrait.getTarget()).toBeUndefined();
    });

    test("cancels building entry when the destination disappears", () => {
        const target: any = { isDestroyed: true, isDisposed: false };
        const task = new EnterBuildingTask({}, target);

        expect(task.onTick({ moveTrait: { isDisabled: () => false } })).toBe(true);
    });
});
