import { EventType } from "./EventType";
export class TriggerAnimEvent {
    public readonly type: EventType;
    constructor(
        public readonly name: string,
        public readonly tile: any,
        /** Optional world-space origin for effects that do not start at a tile center. */
        public readonly position?: any,
        /** Optional creator context used by Ares animation damage attribution. */
        public readonly sourcePlayer?: any,
        public readonly sourceObject?: any,
    ) {
        this.type = EventType.TriggerAnim;
    }
}
