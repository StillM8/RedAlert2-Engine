import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class TechTypeExistsCondition extends TriggerCondition {
    private readonly minimum: number;
    private readonly objectIndex: number;

    constructor(event: any, trigger: any) {
        super(event, trigger);
        this.minimum = Number(event.params[1]);
        this.objectIndex = Number(event.params[2]);
    }

    check(context: any, events: any[]): boolean {
        return this.count(context) >= this.minimum;
    }

    protected count(context: any): number {
        return this.objects(context).filter((object: any) =>
            object.rules?.index === this.objectIndex).length;
    }

    protected objects(context: any): any[] {
        const objects = context.getWorld?.()?.getAllObjects?.() ??
            context.world?.getAllObjects?.() ??
            [];
        if (objects.length) {
            return objects;
        }
        return (context.getAllPlayers?.() ?? context.playerList?.getAll?.() ?? [])
            .flatMap((player: any) => player.getOwnedObjects?.(true) ?? []);
    }
}
