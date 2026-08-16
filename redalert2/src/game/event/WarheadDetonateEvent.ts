import { EventType } from "./EventType";
export class WarheadDetonateEvent {
    public readonly type: EventType;
    constructor(
        public readonly target: any,
        public readonly position: any,
        public readonly explodeAnim: any,
        public readonly isLightningStrike: boolean,
        /** Center cell and delivery context for animation-damage follow-up. */
        public readonly centerTile?: any,
        public readonly elevation?: number,
        public readonly zone?: any,
        public readonly sourcePlayer?: any,
        public readonly sourceObject?: any,
    ) {
        this.type = EventType.WarheadDetonate;
    }
}
