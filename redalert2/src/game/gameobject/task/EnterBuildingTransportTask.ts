import { EnterTransportEvent } from "@/game/event/EnterTransportEvent";
import { EnterBuildingTask } from "@/game/gameobject/task/EnterBuildingTask";
import {
    getAresPassengerRules,
    isAresBuildingPassengerClassAllowed,
} from "@/extensions/ares/AresPassengers";

/**
 * Passenger entry for BuildingTypes using InfantryAbsorb / UnitAbsorb.
 *
 * Buildings cannot use EnterTransportTask because that task deliberately
 * assumes a movable target.  This reuses EnterBuildingTask for movement while
 * storing cargo in the same TransportTrait used by vehicles, keeping capacity,
 * hashing, destruction cleanup and Ares Specific Passengers in one place.
 */
export class EnterBuildingTransportTask extends EnterBuildingTask {
    protected isAllowed(unit: any): boolean {
        const extension = getAresPassengerRules(this.target.rules);
        return !this.target.isDestroyed &&
            this.game.areFriendly(unit, this.target) &&
            this.target.transportTrait?.allowsManualEntry?.() !== false &&
            isAresBuildingPassengerClassAllowed(extension, unit) &&
            this.target.transportTrait?.unitFitsInside?.(unit) === true &&
            !unit.mindControllableTrait?.isActive() &&
            !unit.mindControllerTrait?.isActive();
    }

    protected onEnter(unit: any): boolean {
        if (!this.isAllowed(unit)) return false;
        this.game.limboObject(unit, {
            selected: false,
            controlGroup: this.game
                .getUnitSelection()
                .getOrCreateSelectionModel(unit)
                .getControlGroupNumber(),
            inTransport: true,
        });
        this.target.transportTrait.units.push(unit);
        this.game.events.dispatch(new EnterTransportEvent(this.target));
        return true;
    }
}
