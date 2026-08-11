import { NotifyTick } from './interface/NotifyTick';
import { BuildStatus } from '@/game/gameobject/Building';
// Retail YR: units with PoweredUnit=yes (Robot Tank) only operate while their owner
// has at least one powered building with PowersUnit=<unit name> (Robot Control Center).
// When the last center dies, sells or the base goes low-power, the unit shuts down in
// place until a center comes back online.
const CHECK_INTERVAL_TICKS = 15;
export class RobotControlTrait implements NotifyTick {
    private gameObject: any;
    private offline: boolean = false;
    private ticksUntilCheck: number = 0;
    constructor(gameObject: any) {
        this.gameObject = gameObject;
    }
    isOffline(): boolean {
        return this.offline;
    }
    [NotifyTick.onTick](obj: any, gameState: any): void {
        if (this.ticksUntilCheck > 0) {
            this.ticksUntilCheck--;
            return;
        }
        this.ticksUntilCheck = CHECK_INTERVAL_TICKS;
        const shouldBeOffline = !this.hasActiveControlCenter(obj);
        if (shouldBeOffline !== this.offline) {
            this.offline = shouldBeOffline;
            if (shouldBeOffline) {
                obj.unitOrderTrait.getTasks().forEach((task: any) => task.cancel?.());
                obj.moveTrait?.setDisabled(true);
                obj.attackTrait?.setDisabled(true);
            }
            else {
                // Don't clobber another suppressor (squid grab, magnetron pin).
                if (!obj.parasiteableTrait?.isParalyzed() &&
                    !obj.magnetizedTrait?.isActive() &&
                    !obj.operatorTrait?.isOffline()) {
                    obj.moveTrait?.setDisabled(false);
                    obj.attackTrait?.setDisabled(false);
                }
            }
        }
    }
    private hasActiveControlCenter(obj: any): boolean {
        return !![...obj.owner.buildings].find((building: any) => building.rules.powersUnit === obj.name &&
            building.buildStatus === BuildStatus.Ready &&
            !building.warpedOutTrait.isActive() &&
            (!building.poweredTrait || building.poweredTrait.isPoweredOn()));
    }
    dispose(): void {
        this.gameObject = undefined;
    }
}
