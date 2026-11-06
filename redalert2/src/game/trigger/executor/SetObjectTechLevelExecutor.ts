import { SET_OBJECT_TECH_LEVEL_OBJECT_MARKER } from "@/data/map/trigger/TriggerActionType";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class SetObjectTechLevelExecutor extends TriggerExecutor {
    execute(context: any): void {
        const params = this.action?.params;
        if (!Array.isArray(params) || params[0] !== SET_OBJECT_TECH_LEVEL_OBJECT_MARKER) {
            throw new Error("Set Object Tech Level has an invalid object marker");
        }
        if (typeof params[1] !== "string" || !params[1].trim()) {
            throw new Error("Set Object Tech Level has an invalid type identifier");
        }
        if (!Number.isSafeInteger(params[6]) || params[6] < -1) {
            throw new Error(`Invalid P7 tech level: ${String(params[6])}`);
        }
        if (typeof context?.setObjectTechLevel !== "function") {
            throw new Error("Set Object Tech Level runtime is unavailable");
        }
        context.setObjectTechLevel(params[1], params[6]);
    }
}
