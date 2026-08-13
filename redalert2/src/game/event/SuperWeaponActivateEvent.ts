import { EventType } from "./EventType";
export class SuperWeaponActivateEvent {
    public readonly type: EventType;
    constructor(
        public readonly target: any,
        public readonly owner: any,
        public readonly atTile: any,
        public readonly atTile2: any,
        public readonly noSfxWarning: boolean,
        /** Authored rule section, retained for generic Ares presentation. */
        public readonly rules?: any,
    ) {
        this.type = EventType.SuperWeaponActivate;
    }
}
