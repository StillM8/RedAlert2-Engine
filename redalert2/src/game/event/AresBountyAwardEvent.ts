import { EventType } from "./EventType";

/**
 * Published after the deterministic Ares bounty transaction succeeds and
 * before the victim is removed from the world. The position is a snapshot so
 * presentation consumers do not depend on the victim's later lifecycle.
 */
export class AresBountyAwardEvent {
    public readonly type: EventType;
    constructor(
        public readonly player: any,
        public readonly source: any,
        public readonly target: any,
        public readonly amount: number,
        public readonly position: any,
    ) {
        this.type = EventType.AresBountyAward;
    }
}
