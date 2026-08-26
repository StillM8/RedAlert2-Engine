import { NotifyDestroy } from './interface/NotifyDestroy';
import { fnv32aStrings } from '@/util/math';

export const ARES_GARRISON_OCCUPANT_STATE_VERSION = 1 as const;

/** Versioned state for the occupant's garrison membership. */
export interface AresGarrisonOccupantState {
    readonly version: typeof ARES_GARRISON_OCCUPANT_STATE_VERSION;
    /**
     * Deterministic object id of the hosting building, or undefined when the
     * occupant is in trench-traversal limbo with no host. Object ids come
     * from the deterministic per-match counter and are stable across peers.
     */
    readonly buildingId?: number;
}

export interface AresGarrisonOccupantRestoreContext {
    /**
     * Resolve a snapshot object id back to the live building. Returns
     * undefined for unknown ids so a stale snapshot degrades to hostless
     * instead of failing the whole restore.
     */
    resolveBuildingById?(id: number): unknown;
}

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

    /** Trench traversal keeps the infantry in limbo and moves only its host. */
    retarget(building: any): void {
        this.building = building;
    }

    release(): void {
        this.building = undefined;
    }

    dispose(): void {
        this.building = undefined;
    }

    getHash(): number {
        return fnv32aStrings(["AresGarrisonOccupantTrait", this.building?.id ?? -1]);
    }

    serializeState(): AresGarrisonOccupantState {
        return {
            version: ARES_GARRISON_OCCUPANT_STATE_VERSION,
            ...(this.building?.id !== undefined ? { buildingId: this.building.id } : {}),
        };
    }

    /**
     * Re-links the membership only after the payload validates; resolution
     * runs before any mutation so an invalid payload cannot clear a live
     * reference. An unresolvable id leaves the occupant hostless — the same
     * observable state as `release()`.
     */
    restoreState(state: unknown, context: AresGarrisonOccupantRestoreContext = {}): void {
        if (typeof state !== "object" || state === null) {
            throw new Error("Invalid Ares GarrisonOccupant state: expected an object");
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== ARES_GARRISON_OCCUPANT_STATE_VERSION) {
            throw new Error(`Unsupported Ares GarrisonOccupant state version: ${String(candidate.version)}`);
        }
        let resolved: any;
        if (candidate.buildingId !== undefined) {
            if (!Number.isSafeInteger(candidate.buildingId) || (candidate.buildingId as number) < 0) {
                throw new Error("Invalid Ares GarrisonOccupant state: buildingId must be a non-negative integer");
            }
            if (!context.resolveBuildingById) {
                throw new Error("Invalid Ares GarrisonOccupant state: buildingId requires resolveBuildingById");
            }
            resolved = context.resolveBuildingById(candidate.buildingId as number);
        }
        this.building = resolved;
    }
}
