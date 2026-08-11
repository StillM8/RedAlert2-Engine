import { fnv32aStrings } from "@/util/math";
import { NotifyTick } from "./interface/NotifyTick";

export interface AresOperatorRules {
    operator?: readonly string[];
    operatorAny?: boolean;
}

function normalize(value: unknown): string {
    return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function passengersOf(object: any): readonly any[] {
    return object?.transportTrait?.units ?? object?.garrisonTrait?.units ?? [];
}

function infantryTypeName(passenger: any): string {
    return normalize(passenger?.name ?? passenger?.rules?.name);
}

/**
 * Ares Operator= is a data-defined capability, not a second power system.
 * A vehicle uses its transport passengers and an InfantryAbsorb building uses
 * its garrison passengers.  The same predicate is used by the runtime trait
 * and tests so the two host paths cannot drift apart.
 */
export function isAresOperatorSatisfied(object: AresOperatorRules & { transportTrait?: any; garrisonTrait?: any }): boolean {
    const passengers = passengersOf(object).filter((passenger) => passenger?.isInfantry?.() === true);
    if (!passengers.length) return false;
    if (object.operatorAny) return true;
    const required = new Set((object.operator ?? []).map(normalize).filter(Boolean));
    return passengers.some((passenger) => required.has(infantryTypeName(passenger)));
}

/**
 * Native equivalent of Antares' IsOperated/Deactivated checks.  An operator
 * requirement disables only movement and weapons; it does not disable the
 * building's other services (power, factory, radar, or superweapons).
 */
export class AresOperatorTrait implements NotifyTick {
    private offline = false;

    isOffline(): boolean {
        return this.offline;
    }

    isOperated(object: any): boolean {
        const rules = object.rules ?? object;
        return isAresOperatorSatisfied({
            operator: rules.operator,
            operatorAny: rules.operatorAny,
            transportTrait: object.transportTrait,
            garrisonTrait: object.garrisonTrait,
        });
    }

    [NotifyTick.onTick](object: any): void {
        if (!object || object.isDestroyed || object.isCrashing || object.isSpawned === false) return;
        const shouldBeOffline = !this.isOperated(object);
        if (shouldBeOffline === this.offline) return;

        this.offline = shouldBeOffline;
        if (shouldBeOffline) {
            object.unitOrderTrait?.getTasks?.().forEach((task: any) => task.cancel?.());
            object.moveTrait?.setDisabled?.(true);
            object.attackTrait?.setDisabled?.(true);
            return;
        }

        // Do not wake a unit which is still held by another deterministic
        // suppressor.  Those traits own their own restoration state.
        if (!object.empTrait?.isUnderEMP?.() &&
            !object.robotControlTrait?.isOffline?.() &&
            !object.magnetizedTrait?.isActive?.() &&
            !object.parasiteableTrait?.isParalyzed?.()) {
            object.moveTrait?.setDisabled?.(false);
            object.attackTrait?.setDisabled?.(false);
        }
    }

    getHash(): number {
        return fnv32aStrings(["AresOperatorTrait", this.offline ? 1 : 0]);
    }

    debugGetState(): { offline: boolean } {
        return { offline: this.offline };
    }
}
