import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";

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
}
