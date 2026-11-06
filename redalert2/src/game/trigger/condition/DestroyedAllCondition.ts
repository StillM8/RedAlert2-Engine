import { EventType } from "@/game/event/EventType";
import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class DestroyedAllCondition extends TriggerCondition {
    private allDestroyed = false;
    private readonly houseReference: unknown;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.houseReference = event.params[1];
    }

    check(context: any, events: any[]): boolean {
        if (this.allDestroyed) {
            return true;
        }
        const owner = resolveHousePlayer(context, this.houseReference);
        if (!owner) {
            return false;
        }
        this.allDestroyed = events.some((event) =>
            event.type === EventType.ObjectDestroy &&
            event.target.isTechno() &&
            event.target.owner === owner &&
            owner.getOwnedObjects(true).length === 0);
        return this.allDestroyed;
    }
}
