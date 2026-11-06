import { NotifyTick } from './interface/NotifyTick';
import { ScatterTask } from '../task/ScatterTask';
import { GameSpeed } from '@/game/GameSpeed';
import { GameObject } from '@/game/gameobject/GameObject';
import { World } from '@/game/World';
export class IdleActionTrait {
    private cooldownTicks: number = Number.POSITIVE_INFINITY;
    private _actionDueThisTick: boolean = false;
    private idle: boolean = false;
    [NotifyTick.onTick](gameObject: GameObject, world: World): void {
        this._actionDueThisTick = false;
        const isIdle = !gameObject.unitOrderTrait.hasTasks();
        if (isIdle && !this.idle) {
            this.resetCooldown(world, gameObject);
        }
        else if (isIdle) {
            if (this.cooldownTicks === 0) {
                this.doIdleAction(gameObject, world);
                this.resetCooldown(world, gameObject);
            }
            else {
                this.cooldownTicks--;
            }
        }
        else {
            this.cooldownTicks = Number.POSITIVE_INFINITY;
        }
        this.idle = isIdle;
    }
    doIdleAction(gameObject: GameObject, world: World): void {
        if (gameObject.isInfantry()) {
            if (gameObject.rules.fraidycat) {
                if (world.generateRandom() > 0.5) {
                    gameObject.unitOrderTrait.addTask(new ScatterTask(world, undefined, { noSlopes: true }));
                    return;
                }
            }
            this._actionDueThisTick = true;
            if (gameObject.rules.isCow && world.generateRandom() > 0.5) {
                gameObject.unitOrderTrait.addTask(new ScatterTask(world, undefined, { noSlopes: true }));
            }
        }
    }
    actionDueThisTick(): boolean {
        return this._actionDueThisTick;
    }
    private resetCooldown(world: World, gameObject?: GameObject): void {
        const authoredFrequency = world.rules.audioVisual.idleActionFrequency;
        const baseFrequency = gameObject?.rules.isCow
            ? Math.min(authoredFrequency, 1)
            : authoredFrequency;
        const randomOffset = world.generateRandom() * baseFrequency * 0.5;
        const frequency = Math.max(0, baseFrequency - randomOffset);
        this.cooldownTicks = Math.floor(frequency * GameSpeed.BASE_TICKS_PER_SECOND);
    }
}
