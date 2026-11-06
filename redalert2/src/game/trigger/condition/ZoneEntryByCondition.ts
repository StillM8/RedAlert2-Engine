import { EventType } from "@/game/event/EventType";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { MovementZone } from "@/game/type/MovementZone";
import { isAnyHouseReference } from "@/game/trigger/HouseReference";
import { TriggerCondition } from "@/game/trigger/TriggerCondition";

export class ZoneEntryByCondition extends TriggerCondition {
    check(context: any, events: any[]): any[] {
        const houseReference = this.event.params[1];
        return events
            .filter((event) => {
                const source = event.source;
                if (event.type !== EventType.EnterTile ||
                    !source ||
                    source.zone === ZoneType.Air ||
                    source.rules?.movementZone === MovementZone.Fly ||
                    source.isAircraft?.() === true ||
                    source.cloakableTrait?.isCloaked?.() === true ||
                    (typeof source.isUnit === "function" && !source.isUnit()) ||
                    !this.targets.some((target) => this.isInSameMovementZone(context, source, event.target, target))) {
                    return false;
                }
                return isAnyHouseReference(houseReference) ||
                    this.matchesHouse(context, source.owner, houseReference);
            })
            .map((event) => event.target);
    }
    private isInSameMovementZone(context: any, source: any, destination: any, taggedCell: any): boolean {
        if (taggedCell === destination) {
            return true;
        }
        if (source.rules?.movementZone === undefined || source.rules?.movementZone === null) {
            return true;
        }
        const speedType = source.rules?.speedType;
        const terrain = context.map?.terrain;
        if (terrain?.areInSameMovementZone && speedType !== undefined) {
            const taggedCellOnBridge = !!context.map?.tileOccupation?.getBridgeOnTile?.(taggedCell);
            return terrain.areInSameMovementZone(
                taggedCell,
                destination,
                speedType,
                !!source.onBridge,
                taggedCellOnBridge,
            );
        }
        const destinationZone = context.map?.getTileZone?.(destination) ??
            context.map?.tileOccupation?.getTileZone?.(destination);
        const taggedCellZone = context.map?.getTileZone?.(taggedCell) ??
            context.map?.tileOccupation?.getTileZone?.(taggedCell);
        return destinationZone !== undefined && destinationZone === taggedCellZone;
    }
}
