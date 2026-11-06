import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class CenterCameraExecutor extends TriggerExecutor {
    execute(context: any): void {
        const tile = context.map.getTileAtWaypoint(this.action.params[6]);
        if (!tile) {
            return;
        }
        context.cameraTarget = tile;
        context.cameraSpeed = Number(this.action.params[1]);
        context.centerCameraAtWaypoint?.(tile, context.cameraSpeed);
    }
}
