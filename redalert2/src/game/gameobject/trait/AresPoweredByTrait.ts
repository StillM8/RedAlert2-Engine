import { resolveAresPoweredByDecision } from "@/extensions/ares/AresTechnoRuntimeAdapters";
import { resolveAresPoweredUnitState } from "@/extensions/ares/AresPoweredUnitRuntime";
import { NotifyTick } from "./interface/NotifyTick";

const DEFAULT_CHECK_INTERVAL_TICKS = 15;

/**
 * Generic runtime state for a TechnoType with Ares PoweredBy providers.
 *
 * The trait deliberately uses the same movement/attack disable hooks as the
 * existing robot-control trait. Provider discovery and the transition choice
 * stay in the Ares adapters, so this path has no Mental Omega object names.
 */
export class AresPoweredByTrait implements NotifyTick {
    private gameObject: any;
    private offline = false;
    private powered = false;
    private ticksUntilCheck = 0;
    private readonly checkIntervalTicks: number;

    constructor(gameObject: any, checkIntervalTicks: number = DEFAULT_CHECK_INTERVAL_TICKS) {
        this.gameObject = gameObject;
        this.checkIntervalTicks = Math.max(0, Math.trunc(checkIntervalTicks));
    }

    isOffline(): boolean {
        return this.offline;
    }

    isPowered(): boolean {
        return this.powered;
    }

    [NotifyTick.onTick](gameObject: any): void {
        const rules = gameObject?.rules?.ares?.poweredBy;
        if (!rules?.providers?.length) return;

        if (this.ticksUntilCheck > 0) {
            this.ticksUntilCheck--;
            return;
        }
        this.ticksUntilCheck = this.checkIntervalTicks;

        const providers = this.getProviderObjects(gameObject);
        const providerDecision = resolveAresPoweredByDecision(rules, providers);
        const stateDecision = resolveAresPoweredUnitState({
            providerOnline: providerDecision.powered,
            deactivated: this.offline,
            isUnit: gameObject.isUnit?.() === true,
            insideBuilding: this.isInsideBuilding(gameObject),
            underEMP: gameObject.empTrait?.isUnderEMP?.() === true,
            operated: gameObject.operatorTrait?.isOffline?.() !== true,
        });
        this.powered = stateDecision.powered;

        if (stateDecision.transition === "power-down") {
            this.setOffline(gameObject, true);
        }
        else if (stateDecision.transition === "power-up") {
            this.setOffline(gameObject, false);
        }
    }

    private getProviderObjects(gameObject: any): any[] {
        const buildings = gameObject?.owner?.buildings;
        return buildings ? [...buildings] : [];
    }

    private isInsideBuilding(gameObject: any): boolean {
        const buildings = gameObject?.owner?.buildings;
        if (!buildings) return false;
        return [...buildings].some((building: any) =>
            building?.garrisonTrait?.units?.includes(gameObject) === true ||
            building?.tankBunkerTrait?.unit === gameObject,
        );
    }

    private setOffline(gameObject: any, offline: boolean): void {
        this.offline = offline;
        if (offline) {
            gameObject.unitOrderTrait?.getTasks?.().forEach((task: any) => task.cancel?.());
            gameObject.moveTrait?.setDisabled?.(true);
            gameObject.attackTrait?.setDisabled?.(true);
            return;
        }

        // Do not override another generic suppressor while restoring power.
        if (gameObject.empTrait?.isUnderEMP?.() === true ||
            gameObject.parasiteableTrait?.isParalyzed?.() === true ||
            gameObject.magnetizedTrait?.isActive?.() === true ||
            gameObject.operatorTrait?.isOffline?.() === true) {
            return;
        }
        gameObject.moveTrait?.setDisabled?.(false);
        gameObject.attackTrait?.setDisabled?.(false);
    }

    dispose(): void {
        this.gameObject = undefined;
    }
}
