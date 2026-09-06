import { clamp, fnv32aStrings } from "@/util/math";
import type { DeterministicStateOwner } from "./DeterministicStateOwner";

export interface AmmoTraitState {
    readonly ammo: number;
}

/**
 * Canonical state: current ammo decides whether a weapon may fire this tick.
 * maxAmmo is authored rules and is deliberately not part of the fingerprint.
 */
export class AmmoTrait implements DeterministicStateOwner<AmmoTraitState> {
    private _ammo: number;
    private maxAmmo: number;
    constructor(maxAmmo: number, ammo: number = maxAmmo) {
        this.maxAmmo = maxAmmo;
        this.ammo = ammo;
    }
    get ammo(): number {
        return this._ammo;
    }
    set ammo(value: number) {
        this._ammo = clamp(value, 0, this.maxAmmo);
    }
    isFull(): boolean {
        return this.ammo === this.maxAmmo;
    }
    getHash(): number {
        return fnv32aStrings(["AmmoTrait", this._ammo]);
    }
    captureState(): AmmoTraitState {
        return { ammo: this._ammo };
    }
    restoreState(state: unknown): void {
        if (typeof state !== "object" || state === null || !Number.isSafeInteger((state as AmmoTraitState).ammo)) {
            throw new Error("Invalid AmmoTrait state");
        }
        // Route through the setter so the max clamp invariant holds.
        this.ammo = (state as AmmoTraitState).ammo as number;
    }
}
