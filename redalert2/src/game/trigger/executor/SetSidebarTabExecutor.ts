import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class SetSidebarTabExecutor extends TriggerExecutor {
    execute(context: any): void {
        const tab = Number(this.action.params[1]);
        context.sidebarTab = tab;
        context.setSidebarTab?.(tab);
    }
}
