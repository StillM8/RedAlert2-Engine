import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class BuildingExistsCondition extends TriggerCondition {
    private readonly objectIndex: number;

    constructor(event: any, trigger: any, private readonly negate: boolean = false) {
        super(event, trigger);
        this.objectIndex = Number(event.params[1]);
    }

    check(context: any, events: any[]): boolean {
        if (!this.player) {
            return false;
        }
        const exists = [...this.player.buildings].some((building: any) =>
            building.rules.index === this.objectIndex);
        return this.negate ? !exists : exists;
    }
}
