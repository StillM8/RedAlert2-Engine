import { BuildingGarrisonEvent } from "@/game/event/BuildingGarrisonEvent";
import { EnterBuildingTask } from "@/game/gameobject/task/EnterBuildingTask";
export class GarrisonBuildingTask extends EnterBuildingTask {
    isAllowed(e: any): boolean {
        const garrison = this.target.garrisonTrait;
        return (!this.target.isDestroyed &&
            !!garrison &&
            garrison.canAcceptOccupant(e, this.game));
    }
    onEnter(e: any): void {
        this.game.limboObject(e, {
            selected: false,
            controlGroup: this.game
                .getUnitSelection()
                .getOrCreateSelectionModel(e)
                .getControlGroupNumber(),
        });
        const garrison = this.target.garrisonTrait;
        // Retail neutral structures and Ares Bunker.Raidable both use
        // temporary ownership: the entering infantry's owner controls the
        // building until the final occupant leaves, then it reverts.
        const claimTemporary = garrison.getOccupantCount() === 0 &&
            (this.target.owner.isNeutral ||
                (this.target.rules.aresUrbanCombat?.bunkerRaidable === true &&
                    !this.game.areFriendly(e, this.target)));
        if (claimTemporary) {
            e.owner.buildingsCaptured++;
            garrison.beginTemporaryOccupation(e.owner, this.game);
            this.game.events.dispatch(new BuildingGarrisonEvent(this.target));
        }
        garrison.addOccupant(e, this.game);
    }
}
