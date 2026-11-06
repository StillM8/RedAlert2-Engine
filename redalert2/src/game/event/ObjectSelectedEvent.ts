import { EventType } from "./EventType";

export class ObjectSelectedEvent {
    public readonly type: EventType;

    constructor(public readonly target: any, public readonly player: any) {
        this.type = EventType.ObjectSelected;
    }
}
