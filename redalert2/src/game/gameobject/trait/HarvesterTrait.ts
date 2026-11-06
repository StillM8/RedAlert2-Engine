import { NotifyTick } from './interface/NotifyTick';
import { ReturnOreTask } from '../task/harvester/ReturnOreTask';
import { GatherOreTask } from '../task/harvester/GatherOreTask';
import { NotifySpawn } from './interface/NotifySpawn';
import { NotifyOwnerChange } from './interface/NotifyOwnerChange';
import { GameSpeed } from '@/game/GameSpeed';
import { NotifyTeleport } from './interface/NotifyTeleport';
import { NotifyOrder } from './interface/NotifyOrder';
import { OrderType } from '@/game/order/OrderType';
import { LandType } from '@/game/type/LandType';
export enum HarvesterStatus {
    Idle = 0,
    LookingForOreSite = 1,
    MovingToOreSite = 2,
    Harvesting = 3,
    LookingForRefinery = 4,
    MovingToRefinery = 5,
    Docking = 6,
    PreparingToUnload = 7,
    Unloading = 8
}
export class HarvesterTrait {
    private storage: number;
    private ore: number;
    private gems: number;
    private status: HarvesterStatus;
    private lastGatherExplicit: boolean;
    private autoGatherOnNextIdle: boolean;
    private ticksSinceLastRefineryCheck: number;
    private ticksSinceLastOreCheck: number;
    private lastOreSite?: any;
    constructor(storage: number) {
        this.storage = storage;
        this.ore = 0;
        this.gems = 0;
        this.status = HarvesterStatus.Idle;
        this.lastGatherExplicit = false;
        this.autoGatherOnNextIdle = false;
        this.ticksSinceLastRefineryCheck = 0;
        this.ticksSinceLastOreCheck = 0;
    }
    [NotifySpawn.onSpawn](unit: any, world: any): void {
        if (unit.owner.isCombatant()) {
            world.afterTick(() => {
                unit.unitOrderTrait.addTask(new GatherOreTask(world, undefined));
            });
            unit.attackTrait?.increasePassiveScanCooldown(1);
        }
    }
    [NotifyOwnerChange.onChange](unit: any, oldOwner: any, world: any): void {
        if ((!oldOwner.isCombatant() && unit.owner.isCombatant()) ||
            world.alliances.areAllied(unit.owner, oldOwner)) {
            world.afterTick(() => {
                unit.unitOrderTrait.addTask(new GatherOreTask(world, undefined));
            });
        }
    }
    [NotifyTick.onTick](unit: any, world: any): void {
        if (this.status === HarvesterStatus.LookingForRefinery) {
            if (this.ticksSinceLastRefineryCheck++ > 5 * GameSpeed.BASE_TICKS_PER_SECOND) {
                this.ticksSinceLastRefineryCheck = 0;
                if (unit.unitOrderTrait.hasTasks()) {
                    this.ticksSinceLastRefineryCheck = -25 * GameSpeed.BASE_TICKS_PER_SECOND;
                }
                else if ([...unit.owner.buildings].some(b => b.rules.refinery) || this.lastGatherExplicit) {
                    unit.unitOrderTrait.addTask(new ReturnOreTask(world, undefined));
                }
                else {
                    this.status = HarvesterStatus.Idle;
                }
            }
        }
        else if (this.status === HarvesterStatus.LookingForOreSite) {
            if (this.ticksSinceLastOreCheck++ > 20 * GameSpeed.BASE_TICKS_PER_SECOND) {
                this.ticksSinceLastOreCheck = 0;
                if (!unit.unitOrderTrait.hasTasks()) {
                    unit.unitOrderTrait.addTask(new GatherOreTask(world, undefined));
                }
            }
        }
        else if (this.status === HarvesterStatus.Idle &&
            this.autoGatherOnNextIdle &&
            unit.unitOrderTrait.isIdle() &&
            unit.tile.landType === LandType.Tiberium) {
            this.autoGatherOnNextIdle = false;
            unit.unitOrderTrait.addTask(new GatherOreTask(world, unit.tile, true));
        }
    }
    [NotifyTeleport.onBeforeTeleport](unit: any, world: any, tile: any, keepDock: boolean): void {
        if (!keepDock && unit.owner.isCombatant()) {
            this.status = HarvesterStatus.Idle;
            this.lastOreSite = undefined;
            if (tile && unit.rules.teleporter) {
                world.afterTick(() => {
                    unit.unitOrderTrait.addTask(new (this.isFull() ? ReturnOreTask : GatherOreTask)(world, undefined));
                });
            }
        }
    }
    [NotifyOrder.onPush](unit: any, orderType: OrderType): void {
        this.autoGatherOnNextIdle = [
            OrderType.AttackMove,
            OrderType.Move,
            OrderType.ForceMove,
            OrderType.Scatter
        ].includes(orderType);
        if ([HarvesterStatus.LookingForRefinery, HarvesterStatus.LookingForOreSite].includes(this.status)) {
            this.status = HarvesterStatus.Idle;
        }
    }
    captureState(): Record<string, unknown> {
        return {
            version: 1,
            ore: this.ore,
            gems: this.gems,
            status: this.status,
            lastGatherExplicit: this.lastGatherExplicit,
            autoGatherOnNextIdle: this.autoGatherOnNextIdle,
            ticksSinceLastRefineryCheck: this.ticksSinceLastRefineryCheck,
            ticksSinceLastOreCheck: this.ticksSinceLastOreCheck,
            lastOreSite: this.lastOreSite ? { x: this.lastOreSite.rx, y: this.lastOreSite.ry } : null,
        };
    }
    restoreState(state: unknown, context: { resolveTile?: (x: number, y: number) => any; strict?: boolean } = {}): void {
        if (!state || typeof state !== "object" || (state as any).version !== 1 ||
            !Number.isFinite((state as any).ore) || !Number.isFinite((state as any).gems) ||
            !Number.isSafeInteger((state as any).status) || (state as any).status < HarvesterStatus.Idle || (state as any).status > HarvesterStatus.Unloading ||
            typeof (state as any).lastGatherExplicit !== "boolean" || typeof (state as any).autoGatherOnNextIdle !== "boolean" ||
            !Number.isSafeInteger((state as any).ticksSinceLastRefineryCheck) || !Number.isSafeInteger((state as any).ticksSinceLastOreCheck)) {
            throw new Error("Invalid harvester state");
        }
        this.ore = (state as any).ore;
        this.gems = (state as any).gems;
        this.status = (state as any).status;
        this.lastGatherExplicit = (state as any).lastGatherExplicit;
        this.autoGatherOnNextIdle = (state as any).autoGatherOnNextIdle;
        this.ticksSinceLastRefineryCheck = (state as any).ticksSinceLastRefineryCheck;
        this.ticksSinceLastOreCheck = (state as any).ticksSinceLastOreCheck;
        this.lastOreSite = (state as any).lastOreSite === null ? undefined : context.resolveTile?.((state as any).lastOreSite.x, (state as any).lastOreSite.y);
        if ((state as any).lastOreSite !== null && !this.lastOreSite && context.strict) {
            throw new Error("Cannot restore harvester ore site: unresolved");
        }
    }
    isFull(): boolean {
        return this.ore + this.gems >= this.storage;
    }
    isEmpty(): boolean {
        return !this.ore && !this.gems;
    }
    getHash(): number {
        return 100 * this.ore + this.gems;
    }
    debugGetState(): {
        ore: number;
        gems: number;
    } {
        return { ore: this.ore, gems: this.gems };
    }
}
