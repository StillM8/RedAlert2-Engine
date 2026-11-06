import { EventType } from "@/game/event/EventType";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";
export class AttackedByAnyCondition extends TriggerCondition {
    check(context: any, events: any[]) {
        return events
            .filter((event) => {
            if (event.type !== EventType.ObjectAttacked)
                return false;
            const target = event.target;
            if (!target.isTechno() || !this.targets.includes(target))
                return false;
            const attackerPlayer = event.attacker?.player;
            return ((!attackerPlayer ||
                (!context.alliances.areAllied(attackerPlayer, target.owner) &&
                    attackerPlayer !== target.owner)) &&
                !event.incidental);
        })
            .map((event) => event.target);
    }
}
