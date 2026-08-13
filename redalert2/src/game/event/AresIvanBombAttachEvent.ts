import { EventType } from "./EventType";

/** Presentation event for a weapon-authored Ivan Bomb attach sound. */
export class AresIvanBombAttachEvent {
    public readonly type: EventType;
    constructor(
        public readonly target: any,
        public readonly soundName: string,
        public readonly player: any,
    ) {
        this.type = EventType.AresIvanBombAttach;
    }
}
