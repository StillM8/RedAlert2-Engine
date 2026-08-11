import { NotifyTick } from './interface/NotifyTick';
import { NotifyUnspawn } from './interface/NotifyUnspawn';

// The beam (ROF 20) refreshes the hold long before it lapses; once it stops,
// the victim drops after a beat and takes falling damage.
const HOLD_TICKS = 40;
const DROP_DAMAGE_FRACTION = 0.15;

/**
 * Magnetron suspension (IsLocomotor warheads): while the beam holds, the
 * vehicle can neither move nor fight; when the beam ends, it is dropped for
 * a chunk of falling damage.
 */
export class MagnetizedTrait {
    private holdTicks = 0;
    private active = false;
    private game: any;
    private lifter: any;

    refresh(gameObject: any, game: any, lifter: any): void {
        this.holdTicks = HOLD_TICKS;
        this.game = game;
        this.lifter = lifter;
        if (!this.active) {
            this.active = true;
            gameObject.moveTrait?.setDisabled(true);
            gameObject.attackTrait?.setDisabled(true);
        }
    }

    isActive(): boolean {
        return this.active;
    }

    [NotifyTick.onTick](gameObject: any): void {
        if (!this.active) {
            return;
        }
        if (--this.holdTicks <= 0) {
            this.release(gameObject, true);
        }
    }

    [NotifyUnspawn.onUnspawn](gameObject: any): void {
        this.release(gameObject, false);
    }

    private release(gameObject: any, applyDropDamage: boolean): void {
        if (!this.active) {
            return;
        }
        this.active = false;
        // Don't wake a robot tank that is shut down (no control center).
        if (!gameObject.robotControlTrait?.isOffline() &&
            !gameObject.operatorTrait?.isOffline()) {
            gameObject.moveTrait?.setDisabled(false);
            gameObject.attackTrait?.setDisabled(false);
        }
        if (applyDropDamage && this.game && !gameObject.isDestroyed) {
            const damage = Math.floor((gameObject.rules.strength ?? 0) * DROP_DAMAGE_FRACTION);
            if (damage > 0) {
                gameObject.healthTrait?.inflictDamage(damage, this.lifter ?? gameObject, this.game);
            }
        }
        this.game = undefined;
        this.lifter = undefined;
    }

    dispose(): void {
        this.game = undefined;
        this.lifter = undefined;
    }
}
