import { VeteranLevel } from '@/game/gameobject/unit/VeteranLevel';
import { resolveAresIfvDecision } from '@/extensions/ares/AresTechnoRuntimeAdapters';
import { NotifyTick } from './interface/NotifyTick';

export function hasAresIfvRuntimeFields(rules: any): boolean {
    const ifv = rules?.ares?.ifv;
    return !!ifv && (ifv.weaponTurretIndexes.size > 0 || ifv.weaponUiNames.size > 0);
}

export class GunnerTrait {
    private lastHadGunner: boolean = false;
    private lastPassenger: any;
    private lastIfvMode?: number;
    [NotifyTick.onTick](unit: Unit): void {
        const passengers = unit.transportTrait.units;
        const passenger = passengers[0];
        const hasGunner = passengers.length > 0;
        const aresIfv = hasAresIfvRuntimeFields(unit.rules) ? unit.rules.ares.ifv : undefined;
        const aresDecision = aresIfv
            ? resolveAresIfvDecision(aresIfv, passengers)
            : undefined;
        const ifvMode = aresDecision?.mode ?? passenger?.rules.ifvMode ?? 0;
        const changed = hasGunner !== this.lastHadGunner ||
            passenger !== this.lastPassenger ||
            ifvMode !== this.lastIfvMode;
        if (!changed) return;

        this.lastHadGunner = hasGunner;
        this.lastPassenger = passenger;
        this.lastIfvMode = ifvMode;

        if (aresIfv) {
            if (!aresDecision) return;
            if (aresDecision.turretIndex >= 0 && aresDecision.turretIndex < unit.rules.turretCount) {
                unit.turretNo = aresDecision.turretIndex;
            }
            unit.armedTrait?.selectSpecialWeapon(ifvMode, unit.veteranLevel === VeteranLevel.Elite);
            return;
        }

        const turretIndex = unit.rules.turretIndexesByIfvMode.get(ifvMode) ?? 0;
        if (turretIndex < unit.rules.turretCount) {
            unit.turretNo = turretIndex;
            unit.armedTrait?.selectSpecialWeapon(ifvMode, unit.veteranLevel === VeteranLevel.Elite);
        }
    }
    getUiNameForIfvMode(mode: number, name?: string): string | undefined {
        switch (mode) {
            case 0:
                return "tip:rocket";
            case 1:
                return "tip:repair";
            case 2:
            case 4:
            case 5:
                return "tip:machinegun";
            default:
                return name ? `name:${name.toLowerCase()}` : undefined;
        }
    }
}
