import { SuperWeaponReadyEvent } from './event/SuperWeaponReadyEvent';
import { GameSpeed } from './GameSpeed';
import {
    isAresChargeDrainMoneyDue,
    normalizeAresChargeToDrainRatio,
    startAresChargeDrain,
    stopAresChargeDrain,
} from '@/extensions/ares/AresSuperWeaponChargeDrain';
import {
    applyAresSuperWeaponMoney,
    canAresSuperWeaponTransactMoney,
} from '@/extensions/ares/AresSuperWeaponMoney';
export enum SuperWeaponStatus {
    Charging = 0,
    Paused = 1,
    Ready = 2,
    Draining = 3,
}
export class SuperWeapon {
    public name: string;
    public rules: any;
    public owner: any;
    public oneTimeOnly: boolean;
    public status: SuperWeaponStatus;
    public isGift: boolean;
    public rechargeTicks: number;
    public chargeTicks: number;
    private chargeDrainRatio = 1;
    /** First tick at which a VirtualCharge superweapon became unavailable. */
    private virtualChargeSinceTick?: number;
    constructor(name: string, rules: any, owner: any, oneTimeOnly: boolean = false) {
        this.name = name;
        this.rules = rules;
        this.owner = owner;
        this.oneTimeOnly = oneTimeOnly;
        this.status = SuperWeaponStatus.Charging;
        this.isGift = false;
        this.rechargeTicks = 60 * rules.rechargeTime * GameSpeed.BASE_TICKS_PER_SECOND;
        this.chargeTicks = this.rechargeTicks;
        // Antares grants a newly acquired SW.InitialReady superweapon its
        // first ready state without waiting through RechargeTime.  Re-grant
        // shot-history/persistence is a separate player-state capability;
        // this constructor covers the deterministic initial grant path.
        if (oneTimeOnly || rules.ares?.swInitialReady === true) {
            this.status = SuperWeaponStatus.Ready;
            this.chargeTicks = 0;
        }
    }
    update(game: any): void {
        if (this.status === SuperWeaponStatus.Draining) {
            this.updateChargeDrain();
            return;
        }
        if (this.chargeTicks > 0 && this.status !== SuperWeaponStatus.Paused) {
            this.chargeTicks--;
            if (this.chargeTicks === 0) {
                this.status = SuperWeaponStatus.Ready;
                game.events.dispatch(new SuperWeaponReadyEvent(this));
            }
        }
    }
    pauseTimer(currentTick?: number): void {
        if (this.status === SuperWeaponStatus.Draining) {
            this.deactivateChargeDrain();
        }
        if (this.rules.ares?.swVirtualCharge === true &&
            currentTick !== undefined &&
            this.virtualChargeSinceTick === undefined) {
            this.virtualChargeSinceTick = currentTick;
        }
        this.status = SuperWeaponStatus.Paused;
    }
    resumeTimer(currentTick?: number): void {
        if (this.rules.ares?.swVirtualCharge === true &&
            currentTick !== undefined &&
            this.virtualChargeSinceTick !== undefined) {
            const elapsed = Math.max(0, currentTick - this.virtualChargeSinceTick);
            this.chargeTicks = Math.max(0, this.chargeTicks - elapsed);
            this.virtualChargeSinceTick = undefined;
        }
        this.status = this.chargeTicks > 0 ? SuperWeaponStatus.Charging : SuperWeaponStatus.Ready;
    }
    resetTimer(): void {
        this.chargeTicks = this.rechargeTicks;
        this.virtualChargeSinceTick = undefined;
        if (this.status === SuperWeaponStatus.Ready) {
            this.status = SuperWeaponStatus.Charging;
        }
    }
    getTimerSeconds(): number {
        return this.chargeTicks / GameSpeed.BASE_TICKS_PER_SECOND;
    }
    getChargeProgress(): number {
        if (this.status === SuperWeaponStatus.Draining) {
            const duration = Math.max(1, this.rechargeTicks * this.chargeDrainRatio);
            return Math.max(0, Math.min(1, 1 - this.chargeTicks / duration));
        }
        return (this.rechargeTicks - this.chargeTicks) / this.rechargeTicks;
    }

    isChargeDrainActive(): boolean {
        return this.status === SuperWeaponStatus.Draining;
    }

    startChargeDrain(ratio: number): boolean {
        if (this.status !== SuperWeaponStatus.Ready) return false;
        this.chargeDrainRatio = normalizeAresChargeToDrainRatio(ratio);
        const transition = startAresChargeDrain(this.rechargeTicks, this.chargeDrainRatio);
        this.chargeTicks = transition.timerTicks;
        this.status = SuperWeaponStatus.Draining;
        return true;
    }

    deactivateChargeDrain(): boolean {
        if (this.status !== SuperWeaponStatus.Draining) return false;
        const transition = stopAresChargeDrain(this.rechargeTicks, this.chargeTicks, this.chargeDrainRatio);
        this.chargeTicks = transition.timerTicks;
        this.status = transition.state === "ready"
            ? SuperWeaponStatus.Ready
            : SuperWeaponStatus.Charging;
        return true;
    }

    private updateChargeDrain(): void {
        if (this.chargeTicks > 0) this.chargeTicks--;
        const amount = this.rules.ares?.moneyDrainAmount;
        const delay = this.rules.ares?.moneyDrainDelay;
        if (this.chargeTicks > 0 && isAresChargeDrainMoneyDue(this.chargeTicks, delay) && amount) {
            if (!canAresSuperWeaponTransactMoney(this.owner.credits, amount) ||
                !applyAresSuperWeaponMoney(this.owner, amount)) {
                // Antares stops the drain when a scheduled transaction cannot
                // be completed; the already-spent charge remains consumed.
                this.deactivateChargeDrain();
                return;
            }
        }
        if (this.chargeTicks <= 0) {
            // Automatic expiry shuts the effect down and starts a normal
            // recharge cycle. The type-specific effect can attach its own
            // deactivation hook when that handler is implemented.
            this.chargeTicks = this.rechargeTicks;
            this.status = SuperWeaponStatus.Charging;
        }
    }
}
