import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class TriggerMusicEvent {
    public readonly type = "TriggerMusic";

    constructor(public readonly theme: string) {}
}

export class PlayMusicThemeExecutor extends TriggerExecutor {
    execute(context: any): void {
        const event = new TriggerMusicEvent(String(this.action.params[1]));
        context.events.dispatch(event);
    }
}
