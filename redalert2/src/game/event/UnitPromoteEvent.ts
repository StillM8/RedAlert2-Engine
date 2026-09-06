import { EventType } from "./EventType";
import type { VeteranLevel } from "@/game/gameobject/unit/VeteranLevel";

export class UnitPromoteEvent {
    public readonly type: EventType;
    /**
     * The rank the unit was just promoted TO. Ares presentation settings
     * (Promote.VeteranSound/EliteSound, EVA.VeteranPromoted/ElitePromoted,
     * Promote.VeteranFlash/EliteFlash) select on the achieved rank, not the
     * whole object state.
     */
    constructor(public readonly target: any, public readonly level: VeteranLevel) {
        this.type = EventType.UnitPromote;
    }
}
