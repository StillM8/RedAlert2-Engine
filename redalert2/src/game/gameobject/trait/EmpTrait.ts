import { VeteranAbility } from "@/game/gameobject/unit/VeteranAbility";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { resolveAresEmpCounter } from "@/extensions/ares/AresEMP";

interface DisableableTrait {
    isDisabled(): boolean;
    setDisabled(disabled: boolean): void;
}

/**
 * Runtime state for Ares' per-Techno EMP counter.
 *
 * This trait deliberately owns only the common paralysis state.  Building
 * systems such as radar, production, spawners and superweapons consume
 * isUnderEMP() through their own natural runtime services instead of making
 * the EMP implementation depend on those systems.
 */
export class EmpTrait implements NotifyTick {
    private gameObject: any;
    private remainingFrames = 0;
    private stateApplied = false;
    private previousMoveDisabled?: boolean;
    private previousAttackDisabled?: boolean;

    constructor(gameObject: any) {
        this.gameObject = gameObject;
    }

    isUnderEMP(): boolean {
        return this.remainingFrames > 0;
    }

    getRemainingFrames(): number {
        return this.remainingFrames;
    }

    /**
     * Applies one Ares EMP.Duration/EMP.Cap operation to this Techno.
     * Returns true when the operation affected an eligible state, including a
     * reapplication to a Techno that is already EMP'd.
     */
    apply(duration: number, cap: number, modifier = 1): boolean {
        if (!this.gameObject || !Number.isFinite(duration) || !Number.isFinite(cap)) {
            return false;
        }
        if (this.gameObject.rules?.immuneToEMP || this.hasVeteranEmpImmunity()) {
            return false;
        }

        const oldRemaining = this.remainingFrames;
        const nextRemaining = resolveAresEmpCounter(oldRemaining, duration, cap, modifier);
        this.remainingFrames = nextRemaining;

        if (nextRemaining > 0) {
            this.enableParalysis();
        }
        else if (oldRemaining > 0) {
            this.disableParalysis();
        }

        return oldRemaining !== nextRemaining || nextRemaining > 0 || duration !== 0;
    }

    [NotifyTick.onTick](): void {
        if (this.remainingFrames <= 0) {
            return;
        }
        this.remainingFrames--;
        if (this.remainingFrames <= 0) {
            this.remainingFrames = 0;
            this.disableParalysis();
        }
    }

    getHash(): number {
        return this.remainingFrames;
    }

    debugGetState(): { remainingFrames: number; underEMP: boolean } {
        return {
            remainingFrames: this.remainingFrames,
            underEMP: this.isUnderEMP(),
        };
    }

    dispose(): void {
        this.disableParalysis();
        this.gameObject = undefined;
    }

    private hasVeteranEmpImmunity(): boolean {
        return !!this.gameObject?.veteranTrait?.hasVeteranAbility?.(VeteranAbility.EMPIMMUNE);
    }

    private enableParalysis(): void {
        if (!this.stateApplied) {
            this.previousMoveDisabled = this.gameObject.moveTrait?.isDisabled?.();
            this.previousAttackDisabled = this.gameObject.attackTrait?.isDisabled?.();
            this.stateApplied = true;
        }
        this.setDisabled(this.gameObject.moveTrait, true);
        this.setDisabled(this.gameObject.attackTrait, true);

        // Flying aircraft crash on EMP in Ares.  Threshold-based destruction
        // for other flying/hovering technos is a separate capability.
        if (this.gameObject.isAircraft?.() &&
            this.gameObject.zone === ZoneType.Air &&
            this.gameObject.crashableTrait?.crash) {
            this.gameObject.crashableTrait.crash();
        }
    }

    private disableParalysis(): void {
        if (!this.stateApplied) {
            return;
        }
        this.setDisabled(this.gameObject?.moveTrait, this.previousMoveDisabled ?? false);
        this.setDisabled(this.gameObject?.attackTrait, this.previousAttackDisabled ?? false);
        this.previousMoveDisabled = undefined;
        this.previousAttackDisabled = undefined;
        this.stateApplied = false;
    }

    private setDisabled(trait: DisableableTrait | undefined, disabled: boolean): void {
        trait?.setDisabled(disabled);
    }
}
