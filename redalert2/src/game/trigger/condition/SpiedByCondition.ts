import { EventType } from "@/game/event/EventType";
import { isAnyHouseReference } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class SpiedByCondition extends TriggerCondition {
    private readonly houseReference: unknown;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.houseReference = event.params[1];
    }

    check(context: any, events: any[]): any[] {
        return events
            .filter((event) =>
                event.type === EventType.BuildingInfiltration &&
                this.targets.includes(event.target) &&
                (isAnyHouseReference(this.houseReference) ||
                    this.matchesHouse(context, event.source.owner, this.houseReference)))
            .map((event) => event.target);
    }
}
