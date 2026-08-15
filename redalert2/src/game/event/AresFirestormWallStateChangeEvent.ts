import { EventType } from "./EventType";

/**
 * Presentation event for a Firestorm wall's activation state change.
 *
 * The game side owns the wall's activation state (owner firestorm draining);
 * this event lets the render side swap the wall's displayed animation between
 * the authored idle (FSIDLE) and active (GAFSDF_A) animations without the
 * simulation depending on presentation resources.
 */
export class AresFirestormWallStateChangeEvent {
    public readonly type: EventType;
    constructor(
        public readonly building: any,
        public readonly active: boolean,
    ) {
        this.type = EventType.AresFirestormWallStateChange;
    }
}
