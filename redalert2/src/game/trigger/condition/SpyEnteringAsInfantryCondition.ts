import { EventType } from "@/game/event/EventType";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class SpyEnteringAsInfantryCondition extends TriggerCondition {
    private readonly infantryIndex: number;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.infantryIndex = Number(event.params[1]);
    }

    check(context: any, events: any[]): any[] {
        return events
            .filter((event) => {
                if (event.type !== EventType.BuildingInfiltration) {
                    return false;
                }
                return this.targets.includes(event.target) &&
                    event.source.disguiseTrait?.getDisguise()?.rules?.index === this.infantryIndex;
            })
            .map((event) => event.target);
    }
}
