import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';
export class TimerStopExecutor extends TriggerExecutor {
    execute(context: any): void {
        if (context.countdownTimer.isRunning()) {
            context.countdownTimer.stop();
        }
    }
}
