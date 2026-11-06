import { EventType } from "@/game/event/EventType";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class AttackedByHouseCondition extends TriggerCondition {
    private readonly houseReference: unknown;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.houseReference = event.params[1];
    }

    check(context: any, events: any[]): any[] {
        return events
            .filter((event) => {
                if (event.type !== EventType.ObjectAttacked) {
                    return false;
                }
                const target = event.target;
                const attacker = event.attacker?.player;
                return target.isTechno() &&
                    this.targets.includes(target) &&
                    !!attacker &&
                    this.matchesHouse(context, attacker, this.houseReference);
            })
            .map((event) => event.target);
    }
}
