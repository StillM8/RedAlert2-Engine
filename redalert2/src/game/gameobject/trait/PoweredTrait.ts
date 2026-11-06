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
    captureState(): { version: 1; turnedOn: boolean } {
        return { version: 1, turnedOn: this.turnedOn };
    }
    restoreState(state: unknown): void {
        if (!state || typeof state !== "object" || (state as any).version !== 1 ||
            typeof (state as any).turnedOn !== "boolean") {
            throw new Error("Invalid powered state");
        }
        this.turnedOn = (state as any).turnedOn;
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
