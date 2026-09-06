import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { fnv32aStrings } from "@/util/math";

export const ARES_PASSENGER_TURRET_STATE_VERSION = 1 as const;

/** Versioned state for the passenger-driven turret index latch. */
export interface AresPassengerTurretState {
    readonly version: typeof ARES_PASSENGER_TURRET_STATE_VERSION;
    /**
     * Last turret index written to the transport, or -1 before the first
     * write. Latched so unchanged passenger counts do not rewrite turretNo
     * every tick; a diverged latch silently freezes or rewrites the visible
     * turret, so it participates in the canonical lockstep hash.
     */
    readonly lastTurretIndex: number;
}

/**
 * Implements the shared Ares PassengerTurret rule for any transport that
 * opts into it. The turret index is the number of passengers, clamped to the
 * authored turret count; no Mental Omega unit identity is involved.
 */
export class AresPassengerTurretTrait implements NotifyTick {
    private lastTurretIndex = -1;

    [NotifyTick.onTick](gameObject: any): void {
        const turretCount = Math.max(0, Math.trunc(gameObject.rules?.turretCount ?? 0));
        if (!turretCount || !gameObject.transportTrait) return;
        const passengerCount = gameObject.transportTrait.units.length;
        const turretIndex = Math.min(passengerCount, turretCount - 1);
        if (turretIndex === this.lastTurretIndex) return;
        this.lastTurretIndex = turretIndex;
        gameObject.turretNo = turretIndex;
    }

    getHash(): number {
        return fnv32aStrings(["AresPassengerTurretTrait", this.lastTurretIndex]);
    }

    serializeState(): AresPassengerTurretState {
        return {
            version: ARES_PASSENGER_TURRET_STATE_VERSION,
            lastTurretIndex: this.lastTurretIndex,
        };
    }

    /**
     * Replaces the latched index only after the payload validates. An invalid
     * payload throws instead of mutating, so a corrupt snapshot cannot leave
     * the trait half-restored.
     */
    restoreState(state: unknown): void {
        if (typeof state !== "object" || state === null) {
            throw new Error("Invalid Ares PassengerTurret state: expected an object");
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== ARES_PASSENGER_TURRET_STATE_VERSION) {
            throw new Error(`Unsupported Ares PassengerTurret state version: ${String(candidate.version)}`);
        }
        const index = candidate.lastTurretIndex;
        if (!Number.isSafeInteger(index) || (index as number) < -1) {
            throw new Error("Invalid Ares PassengerTurret state: lastTurretIndex must be an integer >= -1");
        }
        this.lastTurretIndex = index as number;
    }
}
