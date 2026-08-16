import { EventType } from "./EventType";

export type AresSuperWeaponMessageStage =
    | "abort"
    | "insufficientFunds"
    | "cannotFire";

/**
 * Failure messages that do not have a corresponding vanilla event.  Keeping
 * these on the simulation event bus lets every presentation host render the
 * authored Ares label without teaching the simulation about UI or CSF data.
 */
export class AresSuperWeaponMessageEvent {
    public readonly type: EventType;

    constructor(
        public readonly stage: AresSuperWeaponMessageStage,
        public readonly owner: any,
        public readonly rules: any,
        public readonly atTile?: any,
    ) {
        this.type = EventType.AresSuperWeaponMessage;
    }
}
