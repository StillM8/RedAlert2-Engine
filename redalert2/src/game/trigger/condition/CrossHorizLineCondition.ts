import { EventType } from "@/game/event/EventType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { isAnyHouseReference } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class CrossHorizLineCondition extends TriggerCondition {
    private readonly houseReference: unknown;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.houseReference = event.params[1];
    }

    check(context: any, events: any[]): any[] {
        return events
            .filter((event) =>
                event.type === EventType.EnterTile &&
                event.source.zone !== ZoneType.Air &&
                this.targets.some((target) => target.ry === event.target.ry) &&
                (isAnyHouseReference(this.houseReference) ||
                    this.matchesHouse(context, event.source.owner, this.houseReference)))
            .map((event) => event.target);
    }
}
