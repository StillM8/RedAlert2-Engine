import { EventType } from "@/game/event/EventType";
import type { FlhCoords } from "@/game/art/FlhCoords";
import type { PrismSupportWeaponProfile } from "@/extensions/ares/AresPrismForwarding";

export class PrismSupportBeamEvent {
    public readonly type = EventType.PrismSupportBeam;

    constructor(
        public readonly source: any,
        public readonly target: any,
        public readonly profile: PrismSupportWeaponProfile,
        public readonly sourceFlh: FlhCoords,
        public readonly depth: number,
        public readonly downstreamCount: number,
        public readonly sequenceId: number,
    ) {}
}
