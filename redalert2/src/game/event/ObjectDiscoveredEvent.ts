import { EventType } from "./EventType";

export class ObjectDiscoveredEvent {
    public readonly type: EventType;

    constructor(public readonly target: any, public readonly player: any) {
        this.type = EventType.ObjectDiscovered;
    }
}
