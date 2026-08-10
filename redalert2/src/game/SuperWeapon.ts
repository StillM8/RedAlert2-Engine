import { SuperWeaponReadyEvent } from './event/SuperWeaponReadyEvent';
import { GameSpeed } from './GameSpeed';
export enum SuperWeaponStatus {
    Charging = 0,
    Paused = 1,
    Ready = 2
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
        if (this.chargeTicks > 0 && this.status !== SuperWeaponStatus.Paused) {
            this.chargeTicks--;
            if (this.chargeTicks === 0) {
                this.status = SuperWeaponStatus.Ready;
                game.events.dispatch(new SuperWeaponReadyEvent(this));
            }
        }
    }
    pauseTimer(currentTick?: number): void {
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
        return (this.rechargeTicks - this.chargeTicks) / this.rechargeTicks;
    }
}
