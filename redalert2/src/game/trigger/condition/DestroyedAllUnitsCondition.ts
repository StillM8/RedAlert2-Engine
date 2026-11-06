import { ObjectType } from "@/engine/type/ObjectType";
import { EventType } from "@/game/event/EventType";
import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class DestroyedAllUnitsCondition extends TriggerCondition {
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
        this.allDestroyed = events.some((event) => {
            if (event.type !== EventType.ObjectDestroy) {
                return false;
            }
            const target = event.target;
            return target.isUnit() && target.owner === owner && !this.hasUnitsLeft(owner);
        });
        return this.allDestroyed;
    }

    private hasUnitsLeft(owner: any): boolean {
        return [ObjectType.Aircraft, ObjectType.Vehicle, ObjectType.Infantry]
            .some((type) => owner.getOwnedObjectsByType(type, true).length > 0);
    }
}
