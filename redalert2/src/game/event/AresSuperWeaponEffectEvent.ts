import { EventType } from "./EventType";

/**
 * Fired when a superweapon effect reaches its first simulation frame.
 *
 * Ares separates activation-time sound from target-cell presentation.  The
 * event is emitted by the shared effect lifecycle, after SW.Deferment has
 * elapsed, so custom handlers and vanilla effects use the same timing.
 */
export class AresSuperWeaponEffectEvent {
    public readonly type: EventType;

    constructor(
        public readonly rules: any,
        public readonly owner: any,
        public readonly atTile: any,
        public readonly noSfxWarning: boolean = false,
    ) {
        this.type = EventType.AresSuperWeaponEffect;
    }
}
