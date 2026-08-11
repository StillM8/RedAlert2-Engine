import { EnterBuildingTask } from "@/game/gameobject/task/EnterBuildingTask";
import {
    applyAresVehicleHijack,
    getAresVehicleHijackAction,
} from "@/extensions/ares/AresVehicleThief";

/** Moves a VehicleThief/CanDrive infantry onto a valid vehicle and performs the shared Ares action. */
export class HijackVehicleTask extends EnterBuildingTask {
    isAllowed(driver: any): boolean {
        return getAresVehicleHijackAction(driver, this.target, this.game) !== "none";
    }

    onEnter(driver: any): boolean {
        return applyAresVehicleHijack(driver, this.target, this.game);
    }
}
