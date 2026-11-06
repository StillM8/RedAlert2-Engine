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
        public mutationOwner?: any,
        public useUnitPalette: boolean = false,
        public mutationId?: number,
        public mutationContext?: string,
        public animationChain?: string[],
        public triggerOwner?: any,
    ) {
        this.type = EventType.TriggerAnim;
    }
}
