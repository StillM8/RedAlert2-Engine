import { NotifyDestroy } from './interface/NotifyDestroy';

/**
 * Tracks one infantry object while it is in a building garrison.
 *
 * Urban Combat pass-through damage destroys the infantry through the normal
 * object lifecycle, not through GarrisonTrait.evacuate(). Keeping this tiny
 * membership bridge on the occupant lets the host remove the dead object and
 * complete Bunker.Raidable true-owner reversion when the final occupant dies.
 */
export class AresGarrisonOccupantTrait implements NotifyDestroy {
    private building?: any;

    constructor(building: any) {
        this.building = building;
    }

    [NotifyDestroy.onDestroy](unit: any, world: any): void {
        const building = this.building;
        if (!building || building.isDestroyed) return;
        building.garrisonTrait?.handleOccupantDestroyed?.(unit, world);
        this.building = undefined;
    }

    release(): void {
        this.building = undefined;
    }

    dispose(): void {
        this.building = undefined;
    }
}
