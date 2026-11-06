import { EventType } from "@/game/event/EventType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { isAnyHouseReference } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class EnteredByCondition extends TriggerCondition {
    private readonly houseReference: unknown;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.houseReference = event.params[1];
    }

    check(context: any, events: any[]): any[] {
        return events
            .filter((event) => {
                if ((event.type !== EventType.EnterObject && event.type !== EventType.EnterTile) ||
                    !this.targets.includes(event.target) ||
                    (event.type === EventType.EnterTile && event.source.zone === ZoneType.Air)) {
                    return false;
                }
                return isAnyHouseReference(this.houseReference) ||
                    this.matchesHouse(context, event.source.owner, this.houseReference);
            })
            .map((event) => event.target);
    }
}
