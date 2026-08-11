import { Building, BuildStatus } from "@/game/gameobject/Building";
import { LocomotorType } from "@/game/type/LocomotorType";
import { MovementZone } from "@/game/type/MovementZone";
import { UnitRecycleEvent } from "@/game/event/UnitRecycleEvent";
import { EnterBuildingTask } from "@/game/gameobject/task/EnterBuildingTask";
export class EnterRecyclerTask extends EnterBuildingTask {
    private isReverseEngineering(e: any): boolean {
        return this.target.rules?.reverseEngineersVictims === true &&
            this.target.rules?.grinding === true &&
            (e.isInfantry() || e.isVehicle()) &&
            e.rules.canBeReversed === true;
    }
    isAllowed(e: any): boolean {
        return (e.rules.movementZone !== MovementZone.Fly &&
            e.rules.locomotor !== LocomotorType.Chrono &&
            !e.rules.engineer &&
            (this.game.sellTrait.computeRefundValue(e) > 0 || this.isReverseEngineering(e)) &&
            ((e.isInfantry() && this.target.rules.cloning) ||
                this.target.rules.grinding) &&
            !this.target.isDestroyed &&
            this.target.buildStatus === BuildStatus.Ready &&
            e.owner === this.target.owner);
    }
    onEnter(e: any): void {
        if (this.isReverseEngineering(e)) {
            e.owner.production?.addReverseEngineeredPlan(e.rules.reversedAs ?? e.rules.name);
        }
        e.aresVehicleHijackerTrait?.reimburseOnRecycle?.(this.target, this.game);
        this.game.sellTrait.sell(e);
        this.game.events.dispatch(new UnitRecycleEvent(e));
    }
}
