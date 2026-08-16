import { EventType } from "./EventType";
export class TriggerAnimEvent {
    public readonly type: EventType;
    constructor(
        public readonly name: string,
        public readonly tile: any,
        /** Optional world-space origin for effects that do not start at a tile center. */
        public readonly position?: any,
    ) {
        this.type = EventType.TriggerAnim;
    }
}
