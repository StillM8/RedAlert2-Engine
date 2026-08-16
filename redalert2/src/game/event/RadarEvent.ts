import { EventType } from "./EventType";
export class RadarEvent {
    public readonly type: EventType;
    constructor(
        public readonly target: any,
        public readonly radarEventType: any,
        public readonly tile: any,
        /** Optional producer metadata used by generic Ares presentation. */
        public readonly metadata?: {
            superWeaponRules?: any;
            superWeaponOwner?: any;
        },
    ) {
        this.type = EventType.RadarEvent;
    }
}
