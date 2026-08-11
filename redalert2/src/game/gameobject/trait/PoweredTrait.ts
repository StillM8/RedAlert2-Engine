import { PowerLevel } from '@/game/player/trait/PowerTrait';
import { GameObject } from '@/game/gameobject/GameObject';
export class PoweredTrait {
    private obj: GameObject;
    private turnedOn: boolean;
    constructor(obj: GameObject) {
        this.obj = obj;
        this.turnedOn = true;
    }
    setTurnedOn(turnedOn: boolean): void {
        this.turnedOn = turnedOn;
    }
    isCharged(): boolean {
        return (!!this.obj.isBuilding() &&
            !!this.obj.overpoweredTrait?.hasChargersToPowerOn());
    }
    isPoweredOn(checkCharged: boolean = false): boolean {
        if (!this.obj || !this.turnedOn || this.obj.empTrait?.isUnderEMP()) {
            return false;
        }
        if (checkCharged && !this.isCharged()) {
            return false;
        }
        if (this.obj.owner.powerTrait?.isAresBatteryKeepingOnline?.(this.obj)) {
            return true;
        }
        return !this.obj.rules.power && this.obj.rules.needsEngineer
            ? !this.obj.owner.isNeutral
            : !!this.obj.owner.powerTrait &&
                this.obj.owner.powerTrait?.level !== PowerLevel.Low;
    }
    dispose(): void {
        this.obj = undefined;
    }
}
