import { NotifyTick } from './interface/NotifyTick';
import { VeteranLevel } from '@/game/gameobject/unit/VeteranLevel';

// Sim ticks of sustained fire per stage. With retail RateUp=1 this reaches
// the top stage of a 3-stage gattling after ~7 seconds of continuous fire,
// matching the original's feel; retail RateDown=50 spins it down almost
// instantly when the gun goes quiet.
const STAGE_TICKS = 54;

/**
 * Yuri's gattling escalation (IsGattling=yes): the longer the weapon keeps
 * firing, the higher its stage, swapping in the faster Weapon(2n+1)/(2n+2)
 * pair via ArmedTrait.selectGattlingStage.
 *
 * Ares Gattling.Cycle=yes changes only the top-of-counter behavior. Once the
 * final stage has completed, the counter wraps to the first stage without
 * dropping the current target. The simulation remains fixed-step and the
 * value is local deterministic state, so replay/LAN ordering is unchanged.
 */
export class GattlingTrait {
    private value: number = 0;
    private stage: number = 0;
    private cycle?: boolean;

    [NotifyTick.onTick](gameObject: any): void {
        const attackTrait = gameObject.attackTrait;
        const armedTrait = gameObject.armedTrait;
        if (!attackTrait || !armedTrait) {
            return;
        }
        const rules = gameObject.rules;
        const stageCount = Math.max(1, rules.weaponStages);
        const maxValue = stageCount * STAGE_TICKS;
        const cycle = this.resolveCycle(rules);
        // The barrels keep spinning for as long as the gun is ENGAGED on a
        // target. The reliable engagement signal is an active Attack task
        // (buildings fire without one via opportunity fire, covered by the
        // attackState check); RateDown applies once the engagement ends.
        const currentTask = gameObject.unitOrderTrait?.getCurrentTask?.();
        const engaged = ((!!currentTask && (currentTask as any)[Symbol.for("ra2.isAttackTask")] === true) ||
            !attackTrait.isIdle() ||
            // Buildings defend through the attack trait's internal
            // opportunity-fire task, never a unit order.
            !!attackTrait.opportunityFireTask) &&
            !attackTrait.isDisabled();
        if (engaged) {
            if (cycle) {
                // Preserve overshoot so RateUp values greater than one do not
                // introduce a cadence error at the wrap boundary.
                this.value = (this.value + rules.rateUp) % maxValue;
            }
            else {
                this.value = Math.min(maxValue - 1, this.value + rules.rateUp);
            }
        }
        else {
            this.value = Math.max(0, this.value - rules.rateDown);
        }
        const newStage = Math.min(stageCount - 1, Math.floor(this.value / STAGE_TICKS));
        if (newStage !== this.stage) {
            this.stage = newStage;
            armedTrait.selectGattlingStage(newStage, gameObject.veteranLevel === VeteranLevel.Elite);
        }
    }

    private resolveCycle(rules: any): boolean {
        if (this.cycle !== undefined) return this.cycle;
        if (typeof rules?.gattlingCycle === "boolean") {
            this.cycle = rules.gattlingCycle;
            return this.cycle;
        }
        // TechnoRules keeps the source section protected. Reading it once here
        // lets current rules objects consume the Ares tag without duplicating
        // the TechnoRules parser; the result is cached for the object's life.
        this.cycle = rules?.ini?.getBool?.("Gattling.Cycle", false) ?? false;
        return this.cycle;
    }

    getStage(): number {
        return this.stage;
    }

    /** Test/debug hook for deterministic state inspection. */
    getCounter(): number {
        return this.value;
    }
}
