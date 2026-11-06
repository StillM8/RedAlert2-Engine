import { ObjectType } from "@/engine/type/ObjectType";
import { EventType } from "@/game/event/EventType";
import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class DestroyedAllUnitsNavalCondition extends TriggerCondition {
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
            if (event.type !== EventType.ObjectDestroy ||
                !event.target.isVehicle() ||
                event.target.owner !== owner) {
                return false;
            }
            return owner.getOwnedObjectsByType(ObjectType.Vehicle, true)
                .every((unit: any) => !unit.rules.naval);
        });
        return this.allDestroyed;
    }
}
