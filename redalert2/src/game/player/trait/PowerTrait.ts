import { PowerLowEvent } from '../../event/PowerLowEvent';
import { PowerRestoreEvent } from '../../event/PowerRestoreEvent';
import { PowerChangeEvent } from '../../event/PowerChangeEvent';
import { NotifyPower } from '../../trait/interface/NotifyPower';
import { fnv32aStrings } from '@/util/math';
import type { AresBatteryDefinitionLike } from '@/extensions/ares/AresBattery';
import { aresBatteryMatchesBuildingType } from '@/extensions/ares/AresBattery';
export enum PowerLevel {
    Low = 0,
    Normal = 1
}
export class PowerTrait {
    private player: any;
    private power: number;
    private drain: number;
    private level: PowerLevel;
    private blackoutFrames: number;
    private powerByObject: Map<any, number>;
    /** Auxiliary output/drain from active Ares Battery superweapons. */
    private auxiliaryPower: number;
    private activeAresBatteries: number;
    private batteryKeepOnline: Map<string, number>;
    private batteryOverpower: Map<string, number>;
    constructor(player: any) {
        this.player = player;
        this.power = 0;
        this.drain = 0;
        this.level = PowerLevel.Normal;
        this.blackoutFrames = 0;
        this.powerByObject = new Map();
        this.auxiliaryPower = 0;
        this.activeAresBatteries = 0;
        this.batteryKeepOnline = new Map();
        this.batteryOverpower = new Map();
    }
    isLowPower(): boolean {
        return this.level === PowerLevel.Low;
    }
    setBlackoutFor(frames: number, world: any) {
        const wasBlackedOut = this.blackoutFrames > 0;
        this.blackoutFrames = frames;
        if (!wasBlackedOut) {
            this.updateLevel(world);
        }
    }
    updateBlackout(world: any) {
        if (this.blackoutFrames > 0) {
            this.blackoutFrames--;
            if (this.blackoutFrames <= 0) {
                this.updateLevel(world);
            }
        }
    }
    getBlackoutDuration(): number {
        return this.blackoutFrames;
    }

    /** Adds one active Battery's auxiliary power and building-type effects. */
    activateAresBattery(definition: AresBatteryDefinitionLike, world?: any): void {
        const power = Number.isFinite(definition.batteryPower)
            ? Math.trunc(definition.batteryPower as number)
            : 0;
        this.activeAresBatteries++;
        this.auxiliaryPower += power;
        if (power >= 0) {
            this.power += power;
        }
        else {
            this.drain += -power;
        }
        this.addBatteryTypes(this.batteryKeepOnline, definition.batteryKeepOnline);
        this.addBatteryTypes(this.batteryOverpower, definition.batteryOverpower);
        this.notifyPowerChanged(world);
    }

    /** Removes one active Battery using Antares' duplicate-preserving semantics. */
    deactivateAresBattery(definition: AresBatteryDefinitionLike, world?: any): void {
        if (this.activeAresBatteries <= 0) return;
        const power = Number.isFinite(definition.batteryPower)
            ? Math.trunc(definition.batteryPower as number)
            : 0;
        this.activeAresBatteries--;
        this.auxiliaryPower -= power;
        if (power >= 0) {
            this.power -= power;
        }
        else {
            this.drain -= -power;
        }
        this.removeBatteryTypes(this.batteryKeepOnline, definition.batteryKeepOnline);
        this.removeBatteryTypes(this.batteryOverpower, definition.batteryOverpower);
        this.notifyPowerChanged(world);
    }

    isAresBatteryActive(): boolean {
        return this.activeAresBatteries > 0;
    }

    isAresBatteryKeepingOnline(building: any): boolean {
        return this.isAresBatteryActive() && this.hasBatteryBuildingType(this.batteryKeepOnline, building);
    }

    isAresBatteryOverpowering(building: any): boolean {
        return this.isAresBatteryActive() && this.hasBatteryBuildingType(this.batteryOverpower, building);
    }

    getAresAuxiliaryPower(): number {
        return this.auxiliaryPower;
    }
    updateFrom(object: any, action: 'add' | 'update' | 'remove', world: any) {
        const power = object.rules.power;
        if (!power)
            return;
        if (power < 0) {
            if (action === 'add' || action === 'remove') {
                this.drain += action === 'add' ? -power : power;
            }
        }
        else {
            // Bio Reactor: each garrisoned infantry acts as a battery on top of
            // the health-scaled base output.
            const occupantBonus = (object.rules.occupantsPowerBonus &&
                object.garrisonTrait?.units.length)
                ? object.rules.occupantsPowerBonus * object.garrisonTrait.units.length
                : 0;
            let powerDelta = 0;
            if (action === 'add') {
                const powerValue = this.computePowerOutput(object, power, occupantBonus);
                this.powerByObject.set(object, powerValue);
                powerDelta = this.getEffectivePowerOutput(object, powerValue);
            }
            else if (action === 'update' || action === 'remove') {
                const oldPowerValue = this.powerByObject.get(object);
                if (oldPowerValue === undefined) {
                    throw new Error("Cannot update power before add.");
                }
                if (action === 'update') {
                    const newPowerValue = this.computePowerOutput(object, power, occupantBonus);
                    this.powerByObject.set(object, newPowerValue);
                    powerDelta = this.getEffectivePowerOutput(object, newPowerValue) -
                        this.getEffectivePowerOutput(object, oldPowerValue);
                }
                else {
                    this.powerByObject.delete(object);
                    powerDelta = -this.getEffectivePowerOutput(object, oldPowerValue);
                }
            }
            this.power += powerDelta;
        }
        this.notifyPowerChanged(world);
    }
    /**
     * Reconciles positive power output with the current EMP counters. Ares
     * keeps power drain intact while an EMP-disabled power producer contributes
     * no output, so this is intentionally separate from updateFrom's spawn,
     * health and ownership events.
     */
    refreshEmpState(world: any): void {
        const effectivePower = [...this.powerByObject.entries()]
            .reduce((total, [object, nominal]) => total + this.getEffectivePowerOutput(object, nominal), 0);
        if (effectivePower === this.power) {
            return;
        }
        this.power = effectivePower;
        this.notifyPowerChanged(world);
    }
    private computePowerOutput(object: any, power: number, occupantBonus: number): number {
        return Math.ceil((power * object.healthTrait.health) / 100) + occupantBonus;
    }
    private getEffectivePowerOutput(object: any, nominalPower: number): number {
        return object.empTrait?.isUnderEMP?.() ? 0 : nominalPower;
    }
    private notifyPowerChanged(world?: any): void {
        this.updateLevel(world);
        if (!world) return;
        world.traits.filter(NotifyPower).forEach((trait: any) => {
            trait[NotifyPower.onPowerChange](this.player, world);
        });
        world.events.dispatch(new PowerChangeEvent(this.player, this.power, this.drain));
    }
    private updateLevel(world?: any) {
        const oldLevel = this.level;
        this.level = this.power >= this.drain && !this.blackoutFrames
            ? PowerLevel.Normal
            : PowerLevel.Low;
        if (!world) return;
        if (this.level !== oldLevel) {
            if (oldLevel === PowerLevel.Normal && this.level === PowerLevel.Low) {
                world.traits.filter(NotifyPower).forEach((trait: any) => {
                    trait[NotifyPower.onPowerLow](this.player, world);
                });
                world.events.dispatch(new PowerLowEvent(this.player));
            }
            if (oldLevel === PowerLevel.Low && this.level === PowerLevel.Normal) {
                world.traits.filter(NotifyPower).forEach((trait: any) => {
                    trait[NotifyPower.onPowerRestore](this.player, world);
                });
                world.events.dispatch(new PowerRestoreEvent(this.player));
            }
        }
    }
    getHash(): number {
        const values: (string | number)[] = [
            "power",
            this.power,
            this.drain,
            this.blackoutFrames,
            "ares-battery",
            this.auxiliaryPower,
            this.activeAresBatteries,
        ];
        for (const [name, count] of [...this.batteryKeepOnline.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            values.push("keep", name, count);
        }
        for (const [name, count] of [...this.batteryOverpower.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            values.push("overpower", name, count);
        }
        return fnv32aStrings(values);
    }
    debugGetState() {
        return {
            power: this.power,
            drain: this.drain,
            auxiliaryPower: this.auxiliaryPower,
            activeAresBatteries: this.activeAresBatteries,
            batteryKeepOnline: Object.fromEntries(this.batteryKeepOnline),
            batteryOverpower: Object.fromEntries(this.batteryOverpower),
        };
    }
    dispose() {
        this.player = undefined;
        this.powerByObject.clear();
        this.batteryKeepOnline.clear();
        this.batteryOverpower.clear();
        this.auxiliaryPower = 0;
        this.activeAresBatteries = 0;
    }

    private addBatteryTypes(target: Map<string, number>, types: readonly string[] | undefined): void {
        for (const type of types ?? []) {
            if (typeof type !== "string" || !type.trim()) continue;
            const key = type.trim().toLocaleLowerCase("en-US");
            target.set(key, (target.get(key) ?? 0) + 1);
        }
    }

    private removeBatteryTypes(target: Map<string, number>, types: readonly string[] | undefined): void {
        for (const type of types ?? []) {
            if (typeof type !== "string" || !type.trim()) continue;
            const key = type.trim().toLocaleLowerCase("en-US");
            const count = target.get(key) ?? 0;
            if (count <= 1) target.delete(key);
            else target.set(key, count - 1);
        }
    }

    private hasBatteryBuildingType(target: Map<string, number>, building: any): boolean {
        if (!target.size) return false;
        return aresBatteryMatchesBuildingType(building, target.keys());
    }
}
