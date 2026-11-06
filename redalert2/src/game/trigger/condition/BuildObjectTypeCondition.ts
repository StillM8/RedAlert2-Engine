import { EventType } from "@/game/event/EventType";
import { resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class BuildObjectTypeCondition extends TriggerCondition {
    private readonly objectIndex: number;

    constructor(event: any, trigger: any, private readonly objectType: any) {
        super(event, trigger);
        this.objectIndex = Number(event.params[1]);
    }

    check(context: any, events: any[]): boolean {
        const owner = this.player ?? resolveTriggerHousePlayer(context, this.trigger);
        if (!owner) {
            return false;
        }
        return events.some((event) =>
            event.type === EventType.ObjectSpawn &&
            event.gameObject?.owner === owner &&
            event.gameObject.type === this.objectType &&
            event.gameObject.rules?.index === this.objectIndex);
    }
}
