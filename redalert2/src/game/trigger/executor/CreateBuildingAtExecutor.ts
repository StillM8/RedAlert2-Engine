import { ObjectType } from "@/engine/type/ObjectType";
import { findDeliveryTile } from "@/game/superweapon/UnitDeliveryEffect";
import { resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class CreateBuildingAtExecutor extends TriggerExecutor {
    execute(context: any): void {
        const name = String(this.action.params[1] ?? "");
        const owner = resolveTriggerHousePlayer(context, this.trigger);
        const target = context.map.getTileAtWaypoint(this.action.params[6]);
        if (!name || !owner || !target || !context.rules.hasObject(name, ObjectType.Building)) {
            return;
        }
        const building = context.createObject(ObjectType.Building, name);
        context.changeObjectOwner(building, owner);
        let tile = target;
        try {
            tile = findDeliveryTile(context, building, target) ?? target;
        }
        catch {
        }
        context.spawnObject(building, tile);
    }
}
