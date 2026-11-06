import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class AmbientLightCondition extends TriggerCondition {
    private previousAmbient?: number;

    constructor(
        event: any,
        trigger: any,
        private readonly direction: "below" | "above",
    ) {
        super(event, trigger);
        this.threshold = Number(event.params[1]) / 100;
    }

    private readonly threshold: number;

    check(context: any, events: any[]): boolean {
        const previousAmbient = this.previousAmbient;
        const currentAmbient = context.mapLightingTrait.getAmbient().ambient;
        this.previousAmbient = currentAmbient;
        return previousAmbient !== undefined &&
            previousAmbient !== currentAmbient &&
            (this.direction === "above"
                ? currentAmbient >= this.threshold && previousAmbient < this.threshold
                : currentAmbient <= this.threshold && previousAmbient > this.threshold);
    }
}
