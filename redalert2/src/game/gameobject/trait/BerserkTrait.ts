import { NotifyTick } from './interface/NotifyTick';
import { RangeHelper } from '../unit/RangeHelper';
import { Coords } from '@/game/Coords';

// Re-scan for a victim at most this often, to keep the per-tick cost low
const RETARGET_INTERVAL_TICKS = 10;
const SCAN_RANGE_TILES = 8;

// Berserk state from Psychedelic warheads (Chaos Drone gas): the unit becomes
// uncontrollable and force-attacks the nearest techno regardless of ownership.
export class BerserkTrait implements NotifyTick {
    private gameObject: any;
    private remainingTicks: number = 0;
    private retargetCooldown: number = 0;
    private forcedTask?: any;
    constructor(gameObject: any) {
        this.gameObject = gameObject;
    }
    captureState(): Record<string, unknown> {
        return { version: 1, remainingTicks: this.remainingTicks, retargetCooldown: this.retargetCooldown };
    }
    restoreState(state: unknown): void {
        if (!state || typeof state !== "object" || (state as any).version !== 1 ||
            !Number.isSafeInteger((state as any).remainingTicks) || (state as any).remainingTicks < 0 ||
            !Number.isSafeInteger((state as any).retargetCooldown) || (state as any).retargetCooldown < 0) {
            throw new Error("Invalid berserk state");
        }
        this.remainingTicks = (state as any).remainingTicks;
        this.retargetCooldown = (state as any).retargetCooldown;
    }
    isActive(): boolean {
        return this.remainingTicks > 0;
    }
    refresh(durationTicks: number, game: any): void {
        if (durationTicks <= 0)
            return;
        const wasActive = this.isActive();
        this.remainingTicks = Math.max(this.remainingTicks, Math.floor(durationTicks));
        if (!wasActive) {
            this.retargetCooldown = 0;
            const orderTrait = this.gameObject?.unitOrderTrait;
            orderTrait?.clearOrders();
            orderTrait?.cancelAllTasks();
        }
    }
    [NotifyTick.onTick](obj: any, game: any): void {
        if (!this.remainingTicks)
            return;
        this.remainingTicks--;
        if (!this.remainingTicks) {
            this.restoreControl();
            return;
        }
        if (obj.isDestroyed || !obj.isSpawned)
            return;
        const orderTrait = obj.unitOrderTrait;
        if (!orderTrait)
            return;
        // Swallow any player/AI-issued orders while berserk
        orderTrait.clearOrders();
        const currentTask = orderTrait.getCurrentTask();
        if (currentTask && currentTask !== this.forcedTask) {
            orderTrait.cancelAllTasks();
            return;
        }
        if (this.retargetCooldown > 0) {
            this.retargetCooldown--;
            return;
        }
        if (orderTrait.hasTasks())
            return;
        this.retargetCooldown = RETARGET_INTERVAL_TICKS;
        const attackTrait = obj.attackTrait;
        if (!attackTrait || attackTrait.isDisabled())
            return;
        const victim = this.findNearestVictim(obj, game, attackTrait);
        if (victim) {
            const task = attackTrait.createAttackTask(game, victim.target, victim.target.tile, victim.weapon, { force: true });
            this.forcedTask = task;
            orderTrait.addTask(task);
        }
    }
    private findNearestVictim(obj: any, game: any, attackTrait: any): {
        target: any;
        weapon: any;
    } | undefined {
        const rangeHelper = new RangeHelper(game.map.tileOccupation);
        const maxDistance = SCAN_RANGE_TILES * Coords.LEPTONS_PER_TILE;
        let best: { target: any; weapon: any } | undefined;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const candidate of attackTrait.scanTechnosAround(obj, SCAN_RANGE_TILES, game)) {
            if (candidate === obj ||
                !candidate.isTechno() ||
                candidate.isDestroyed ||
                !candidate.healthTrait ||
                !game.isValidTarget(candidate)) {
                continue;
            }
            const distance = rangeHelper.distance3(obj, candidate);
            if (distance > maxDistance || distance >= bestDistance)
                continue;
            // force=true so allies and own units are valid targets
            const weapon = attackTrait.selectWeaponVersus(obj, candidate, game, true);
            if (!weapon)
                continue;
            best = { target: candidate, weapon: weapon };
            bestDistance = distance;
        }
        return best;
    }
    private restoreControl(): void {
        this.remainingTicks = 0;
        const orderTrait = this.gameObject?.unitOrderTrait;
        if (this.forcedTask &&
            orderTrait?.getTasks().includes(this.forcedTask) &&
            !this.forcedTask.isCancelling()) {
            this.forcedTask.cancel();
        }
        this.forcedTask = undefined;
    }
    dispose(): void {
        this.forcedTask = undefined;
        this.gameObject = undefined;
    }
}
