import { Order } from "@/game/order/Order";
import { OrderType } from "@/game/order/OrderType";
import { PointerType } from "@/engine/type/PointerType";
import { GarrisonBuildingTask } from "@/game/gameobject/task/GarrisonBuildingTask";
import { EnterBuildingTransportTask } from "@/game/gameobject/task/EnterBuildingTransportTask";
import { RangeHelper } from "@/game/gameobject/unit/RangeHelper";
import { OrderFeedbackType } from "@/game/order/OrderFeedbackType";
import { MovementZone } from "@/game/type/MovementZone";
import { LocomotorType } from "@/game/type/LocomotorType";
import { EnterRecyclerTask } from "@/game/gameobject/task/EnterRecyclerTask";
import { EnterBunkerTask } from "@/game/gameobject/task/EnterBunkerTask";
import { InfiltrateBuildingTask } from "@/game/gameobject/task/InfiltrateBuildingTask";
import { EnterHospitalTask } from "@/game/gameobject/task/EnterHospitalTask";
import {
    getAresPassengerRules,
    isAresBuildingPassengerClassAllowed,
} from "@/extensions/ares/AresPassengers";
export class OccupyOrder extends Order {
    private game: any;
    constructor(game: any) {
        super(OrderType.Occupy);
        this.game = game;
        this.targetOptional = false;
        this.terminal = true;
        this.feedbackType = OrderFeedbackType.Capture;
    }
    getPointerType(mini: boolean): PointerType {
        return mini
            ? this.isAllowed()
                ? PointerType.OccupyMini
                : PointerType.NoActionMini
            : this.isAllowed()
                ? PointerType.Occupy
                : PointerType.NoOccupy;
    }
    isValid(): boolean {
        if (!(this.target.obj?.isSpawned &&
            this.target.obj?.isBuilding() &&
            this.sourceObject.isUnit())) {
            return false;
        }
        if (this.isUnitRecycle(this.sourceObject, this.target.obj)) {
            return true;
        }
        if (this.isBunkerEntry(this.sourceObject, this.target.obj)) {
            return true;
        }
        if (this.isBuildingPassengerEntry(this.sourceObject, this.target.obj)) {
            return true;
        }
        if (!this.sourceObject.isInfantry()) {
            return false;
        }
        if (this.target.obj.isBuilding() && this.target.obj.hospitalTrait) {
            return this.game.areFriendly(this.sourceObject, this.target.obj) &&
                this.sourceObject.isInfantry();
        }
        if (this.target.obj.garrisonTrait) {
            // Centralized in GarrisonTrait so cursor validation and the final
            // enter task use identical Ares CanBeOccupiedBy/Bunker.Raidable
            // semantics instead of diverging ownership checks.
            return this.target.obj.garrisonTrait.canAcceptOccupant(this.sourceObject, this.game);
        }
        return !!(this.target.obj.rules.spyable &&
            this.sourceObject.rules.infiltrate &&
            !this.game.areFriendly(this.sourceObject, this.target.obj));
    }
    private isUnitRecycle(unit: any, building: any): boolean {
        return unit.owner === building.owner &&
            ((unit.isInfantry() && building.rules.cloning) || building.rules.grinding) &&
            !unit.rules.engineer;
    }
    private isBunkerEntry(unit: any, building: any): boolean {
        return building.rules.bunker &&
            unit.isVehicle() &&
            !unit.rules.naval &&
            unit.rules.locomotor !== LocomotorType.Aircraft &&
            unit.rules.locomotor !== LocomotorType.Hover &&
            unit.rules.movementZone !== MovementZone.Fly &&
            this.game.areFriendly(unit, building) &&
            !unit.mindControllableTrait?.isActive();
    }
    private isBuildingPassengerEntry(unit: any, building: any): boolean {
        if (!building.transportTrait || building.transportTrait.allowsManualEntry?.() === false) {
            return false;
        }
        const extension = getAresPassengerRules(building.rules);
        return this.game.areFriendly(unit, building) &&
            isAresBuildingPassengerClassAllowed(extension, unit) &&
            !unit.mindControllableTrait?.isActive() &&
            !unit.mindControllerTrait?.isActive();
    }
    isAllowed(): boolean {
        const building = this.target.obj;
        const unit = this.sourceObject;
        if (this.isUnitRecycle(unit, building)) {
            return unit.rules.movementZone !== MovementZone.Fly &&
                unit.rules.locomotor !== LocomotorType.Chrono &&
                this.game.sellTrait.computeRefundValue(unit) > 0;
        }
        if (this.isBunkerEntry(unit, building)) {
            return !building.tankBunkerTrait?.isOccupied();
        }
        if (this.isBuildingPassengerEntry(unit, building)) {
            return building.transportTrait.unitFitsInside(unit);
        }
        if (building.hospitalTrait) {
            return unit.healthTrait.health < 100 &&
                unit.rules.movementZone !== MovementZone.Fly;
        }
        if (building.garrisonTrait) {
            return building.garrisonTrait.canAcceptOccupant(unit, this.game);
        }
        return true;
    }
    process(): any[] {
        const building = this.target.obj;
        const unit = this.sourceObject;
        if (this.isUnitRecycle(unit, building)) {
            return [new EnterRecyclerTask(this.game, building)];
        }
        if (this.isBunkerEntry(unit, building)) {
            return [new EnterBunkerTask(this.game, building)];
        }
        if (this.isBuildingPassengerEntry(unit, building)) {
            return [new EnterBuildingTransportTask(this.game, building)];
        }
        if (building.hospitalTrait) {
            return [new EnterHospitalTask(this.game, building)];
        }
        if (building.garrisonTrait) {
            return [new GarrisonBuildingTask(this.game, building)];
        }
        return [new InfiltrateBuildingTask(this.game, building)];
    }
    onAdd(tasks: any[], replace: boolean): boolean {
        if (!replace) {
            const existingTask = tasks.find(task => task instanceof GarrisonBuildingTask ||
                task instanceof EnterBuildingTransportTask ||
                task instanceof InfiltrateBuildingTask);
            if (this.isValid() &&
                this.isAllowed() &&
                existingTask &&
                !existingTask.isCancelling() &&
                existingTask.target === this.target.obj) {
                if (new RangeHelper(this.game.map.tileOccupation).isInTileRange(this.sourceObject, this.target.obj, 0, Math.SQRT2)) {
                    return false;
                }
            }
        }
        return true;
    }
}