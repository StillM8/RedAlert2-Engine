import { EventType } from "@/game/event/EventType";
import { resolveHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class SpyEnteringAsHouseCondition extends TriggerCondition {
    private readonly houseReference: unknown;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.houseReference = event.params[1];
    }

    check(context: any, events: any[]): any[] {
        const disguiseOwner = resolveHousePlayer(context, this.houseReference);
        return events
            .filter((event) => {
                if (event.type !== EventType.BuildingInfiltration) {
                    return false;
                }
                const disguisedPlayer = event.source.disguiseTrait?.getDisguise()?.owner;
                return this.targets.includes(event.target) &&
                    (disguisedPlayer === disguiseOwner ||
                        this.matchesHouse(context, disguisedPlayer, this.houseReference));
            })
            .map((event) => event.target);
    }
}
