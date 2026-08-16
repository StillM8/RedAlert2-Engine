import {
    advanceAresAnimationDamage,
    type AresAnimationDamageDefinition,
    type AresAnimationDamageState,
} from "@/extensions/ares/AresAnimationDamage";
import { GameSpeed } from "@/game/GameSpeed";

export interface AresAnimationDamageSpawn {
    definition: AresAnimationDamageDefinition;
    tile: any;
    position: any;
    elevation: number;
    zone: any;
    sourcePlayer?: any;
    sourceObject?: any;
}

export interface AresAnimationDamageDelivery extends AresAnimationDamageSpawn {
    damage: number;
}

interface RuntimeInstance extends AresAnimationDamageSpawn {
    frame: number;
    loopNumber: number;
    frameAccumulator: number;
    damageState: AresAnimationDamageState;
}

export interface AresAnimationDamageRuntimeHost {
    applyAresAnimationDamageArea(request: AresAnimationDamageDelivery): void;
}

/**
 * Simulation-side lifetime for standalone Ares animation damage.
 *
 * The renderer owns the visual transient, but damage must be driven by the
 * deterministic game tick. This runtime mirrors the animation frame clock,
 * keeps Damage.Delay in animation frames, and snapshots instances so a
 * damage-triggered explosion cannot recursively run in the same tick.
 */
export class AresAnimationDamageRuntime {
    private nextId = 1;
    private instances = new Map<number, RuntimeInstance>();

    spawn(request: AresAnimationDamageSpawn): boolean {
        if (request.definition.damage <= 0 || request.definition.rate <= 0) {
            return false;
        }

        this.instances.set(this.nextId++, {
            ...request,
            frame: request.definition.reverse
                ? request.definition.end
                : request.definition.start,
            loopNumber: 0,
            frameAccumulator: 0,
            damageState: { accumulator: 0 },
        });
        return true;
    }

    update(host: AresAnimationDamageRuntimeHost): void {
        const active = [...this.instances.entries()];
        for (const [id, instance] of active) {
            // A new animation created by a damage warhead starts on the next
            // simulation tick, matching the transient animation lifecycle.
            if (!this.instances.has(id)) continue;

            instance.frameAccumulator += instance.definition.rate / GameSpeed.BASE_TICKS_PER_SECOND;
            const framesToAdvance = Math.floor(instance.frameAccumulator);
            instance.frameAccumulator -= framesToAdvance;

            let finished = false;
            for (let frame = 0; frame < framesToAdvance; frame++) {
                const step = advanceAresAnimationDamage(instance.definition, instance.damageState);
                instance.damageState = step.state;
                if (step.damage) {
                    host.applyAresAnimationDamageArea({
                        ...instance,
                        damage: step.damage,
                    });
                }

                if (this.advanceFrame(instance)) {
                    finished = true;
                    break;
                }
            }

            if (finished) {
                this.instances.delete(id);
            }
        }
    }

    clear(): void {
        this.instances.clear();
    }

    getActiveCount(): number {
        return this.instances.size;
    }

    private advanceFrame(instance: RuntimeInstance): boolean {
        const definition = instance.definition;
        const targetFrame = definition.reverse
            ? (instance.loopNumber > 0 ? definition.loopStart : definition.start)
            : (instance.loopNumber > 0 ? definition.loopEnd : definition.end);
        const step = definition.reverse ? -1 : 1;
        const nextFrame = instance.frame + step;

        if (definition.reverse ? nextFrame >= targetFrame : nextFrame <= targetFrame) {
            instance.frame = nextFrame;
            return false;
        }

        if (definition.loopCount === -1 || instance.loopNumber < definition.loopCount - 1) {
            instance.loopNumber++;
            instance.frame = definition.reverse ? definition.loopEnd : definition.loopStart;
            return false;
        }

        return true;
    }
}
