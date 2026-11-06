import { GameSpeed } from "@/game/GameSpeed";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class RandomDelayCondition extends TriggerCondition {
    private elapsedTicks = 0;
    private timerTicks?: number;

    check(context: any, events: any[]): boolean {
        if (this.timerTicks === undefined) {
            const percent = context.generateRandomInt(50, 150) / 100;
            this.timerTicks = Math.floor(percent * Number(this.event.params[1])) *
                GameSpeed.BASE_TICKS_PER_SECOND;
        }
        const elapsed = this.elapsedTicks++;
        return elapsed >= this.timerTicks;
    }

    reset(): void {
        this.timerTicks = undefined;
        this.elapsedTicks = 0;
    }
}
