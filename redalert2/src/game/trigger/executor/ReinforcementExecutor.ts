import { TriggerEvaEvent } from "@/game/event/TriggerEvaEvent";
import { findDeliveryTile } from "@/game/superweapon/UnitDeliveryEffect";
import { resolveHousePlayer, resolveTriggerHousePlayer } from "@/game/trigger/HouseReference";
import {
    parseTeamWaypoint,
    resolveTeamType,
    taskForceEntries,
    resolveUnitRules,
} from "@/game/trigger/TeamReference";
import { TriggerExecutor } from "@/game/trigger/TriggerExecutor";

export class ReinforcementExecutor extends TriggerExecutor {
    constructor(action: any, trigger: any, private readonly useActionWaypoint: boolean) {
        super(action, trigger);
    }

    execute(context: any): void {
        const teamType = resolveTeamType(context, this.action.params[1]);
        if (!teamType) {
            return;
        }
        const triggerOwner = resolveTriggerHousePlayer(context, this.trigger);
        const teamHouse = teamType.section.getString("House").trim();
        const owner = teamHouse && !["<none>", "none"].includes(teamHouse.toLowerCase())
            ? resolveHousePlayer(context, teamHouse)
            : triggerOwner;
        const waypoint = this.useActionWaypoint
            ? this.action.params[6]
            : teamType.section.getString("Waypoint");
        const tile = this.resolveTile(context, owner, waypoint);
        if (!owner || !tile) {
            return;
        }
        let spawned = 0;
        for (const entry of taskForceEntries(context, teamType)) {
            const rules = resolveUnitRules(context, entry.type);
            if (!rules) {
                continue;
            }
            for (let index = 0; index < entry.count; index++) {
                const unit = this.createUnit(context, rules, owner);
                if (!unit) {
                    continue;
                }
                const placement = this.findTile(context, unit, tile);
                context.spawnObject(unit, placement);
                unit.guardMode = !owner.isAi;
                unit.guardArea = { tile: placement, onBridge: false };
                spawned++;
            }
        }
        if (spawned) {
            context.events.dispatch(new TriggerEvaEvent("EVA_ReinforcementsHaveArrived"));
        }
    }

    private createUnit(context: any, rules: any, owner: any): any {
        if (context.createUnitForPlayer) {
            return context.createUnitForPlayer(rules, owner);
        }
        const unit = context.createObject(rules.type, rules.name);
        context.changeObjectOwner(unit, owner);
        return unit;
    }

    private findTile(context: any, unit: any, target: any): any {
        try {
            return findDeliveryTile(context, unit, target) ?? target;
        }
        catch {
            return target;
        }
    }

    private resolveTile(context: any, owner: any, waypoint: unknown): any {
        const waypointId = parseTeamWaypoint(waypoint);
        if (waypointId !== undefined) {
            return context.map.getTileAtWaypoint(waypointId);
        }
        if (owner?.baseCenterTile) {
            return owner.baseCenterTile;
        }
        if (owner?.startLocation !== undefined) {
            return context.map.getTileAtWaypoint(owner.startLocation);
        }
        return undefined;
    }
}
