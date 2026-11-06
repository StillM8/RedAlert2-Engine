import { resolveTriggerHousePlayer } from '@/game/trigger/HouseReference';
import { TriggerExecutor } from '@/game/trigger/TriggerExecutor';
import {
    AresPreferredTargetingCellKind,
    setAresPreferredTargetingCell,
} from '@/extensions/ares/AresSuperWeaponTargetingCell';

/**
 * Map trigger actions 135/140 establish the Ares AI preferred targeting cell
 * for the trigger's house. The built-in bot observes the result through
 * GameApi.getAresSuperWeaponTargetingCell. An unresolvable authored waypoint
 * clears the preference so the *_Cell_Clear constraints observe the
 * documented "no preferred cell known" state.
 */
export class SetAresPreferredTargetingCellExecutor extends TriggerExecutor {
    constructor(action: any, trigger: any, private readonly kind: AresPreferredTargetingCellKind) {
        super(action, trigger);
    }

    execute(context: any): void {
        const player = resolveTriggerHousePlayer(context, this.trigger);
        if (!player) {
            console.warn(`No house found for preferred targeting cell; ` +
                `skipping action ${this.getDebugName()}.`);
            return;
        }
        const waypointId = Number(this.action.params[6]);
        const tile = context.map.getTileAtWaypoint(waypointId);
        if (!tile) {
            setAresPreferredTargetingCell(player, this.kind, undefined);
            return;
        }
        setAresPreferredTargetingCell(player, this.kind, { x: tile.rx, y: tile.ry });
    }
}
