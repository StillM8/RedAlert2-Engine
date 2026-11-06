import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';
export class ForceEndExecutor extends TriggerExecutor {
    execute(context: any): void {
        context.end();
    }
}
