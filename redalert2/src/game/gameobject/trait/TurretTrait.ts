import { FacingUtil } from '@/game/gameobject/unit/FacingUtil';
import { NotifyTick } from './interface/NotifyTick';
import { NotifySpawn } from './interface/NotifySpawn';
import { fnv32aStrings } from '@/util/math';
import type { DeterministicStateOwner } from './DeterministicStateOwner';

export interface TurretTraitState {
    readonly facing: number;
    readonly desiredFacing: number;
}

/**
 * Canonical state: current and desired facings decide rotation for the next
 * ticks, and facing feeds weapon delivery. Floats hash via deterministic
 * Number-to-string formatting.
 */
export class TurretTrait implements DeterministicStateOwner<TurretTraitState> {
    private facing: number = 0;
    private desiredFacing: number = 0;
    isRotating(): boolean {
        return this.facing !== this.desiredFacing;
    }
    getHash(): number {
        return fnv32aStrings(["TurretTrait", this.facing, this.desiredFacing]);
    }
    captureState(): TurretTraitState {
        return { facing: this.facing, desiredFacing: this.desiredFacing };
    }
    restoreState(state: unknown): void {
        if (typeof state !== "object" || state === null) {
            throw new Error("Invalid TurretTrait state");
        }
        const candidate = state as Partial<TurretTraitState>;
        if (typeof candidate.facing !== "number" || !Number.isFinite(candidate.facing) ||
            typeof candidate.desiredFacing !== "number" || !Number.isFinite(candidate.desiredFacing)) {
            throw new Error("Invalid TurretTrait state");
        }
        this.facing = candidate.facing;
        this.desiredFacing = candidate.desiredFacing;
    }
    [NotifySpawn.onSpawn](target: any): void {
        if (target.isUnit()) {
            this.facing = this.desiredFacing = target.direction;
        }
    }
    [NotifyTick.onTick](gameObject: any): void {
        if (this.desiredFacing !== this.facing) {
            const rotationSpeed = gameObject.rules.rot;
            this.facing = FacingUtil.tick(this.facing, this.desiredFacing, rotationSpeed || Number.POSITIVE_INFINITY).facing;
        }
    }
}
