import { EventType } from "./EventType";

export class HouseDiscoveredEvent {
    public readonly type: EventType;

    constructor(public readonly house: any, public readonly player: any) {
        this.type = EventType.HouseDiscovered;
    }
}
