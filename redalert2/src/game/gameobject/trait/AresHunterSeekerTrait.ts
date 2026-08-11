import { Coords } from "@/game/Coords";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { selectAresHunterSeekerTarget } from "@/extensions/ares/AresHunterSeeker";
import { fnv32aStrings } from "@/util/math";

export interface AresHunterSeekerLaunchContext {
    randomOnly: boolean;
    affectsHouse?: string;
    detonateProximity: number;
    descendProximity: number;
    ascentSpeed: number;
    descentSpeed: number;
    emergeSpeed: number;
    /** Host supplies the normal movement task without coupling this trait to task-module initialization. */
    createMoveTask?: (game: any, tile: any) => any;
}

function targetTile(target: any): any | undefined {
    return target?.isBuilding?.() ? target.centerTile : target?.tile;
}

function tileDistance(first: any, second: any): number {
    if (!first || !second) return Number.POSITIVE_INFINITY;
    const dx = (first.rx ?? 0) - (second.rx ?? 0);
    const dy = (first.ry ?? 0) - (second.ry ?? 0);
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Native standalone equivalent of Antares' Hunter Seeker aircraft extension.
 * Launch code attaches this trait to the data-defined aircraft; the trait
 * then owns target reacquisition, deterministic pursuit, and weapon/warhead
 * detonation.  No object ID or Windows hook is involved.
 */
export class AresHunterSeekerTrait implements NotifyTick {
    private target?: any;
    private lastTargetTile?: any;

    constructor(private readonly context: AresHunterSeekerLaunchContext) {}

    getTarget(): any | undefined {
        return this.target;
    }

    [NotifyTick.onTick](aircraft: any, game: any): void {
        if (aircraft.isDestroyed || !aircraft.isSpawned) return;

        if (!this.isTargetValid(aircraft, game, this.target)) {
            this.target = selectAresHunterSeekerTarget({
                owner: aircraft.owner,
                objects: game.getWorld?.().getAllObjects?.() ?? game.world?.getAllObjects?.() ?? [],
                game,
                randomOnly: this.context.randomOnly,
                affectsHouse: this.context.affectsHouse,
            });
            this.lastTargetTile = undefined;
        }

        const target = this.target;
        if (!target) {
            this.cancelPursuit(aircraft);
            return;
        }

        const targetCell = targetTile(target);
        const proximity = this.resolveDetonateProximity(aircraft);
        if (targetCell && tileDistance(aircraft.tile, targetCell) <= proximity) {
            this.detonate(aircraft, target, game);
            return;
        }

        if (!targetCell) return;
        const currentTask = aircraft.unitOrderTrait?.getCurrentTask?.();
        if (typeof currentTask?.updateTarget === "function") {
            if (this.lastTargetTile !== targetCell) {
                currentTask.updateTarget(targetCell, false);
                this.lastTargetTile = targetCell;
            }
        }
        else {
            aircraft.unitOrderTrait?.cancelAllTasks?.();
            const moveTask = this.context.createMoveTask?.(game, targetCell);
            if (moveTask) aircraft.unitOrderTrait?.addTask?.(moveTask);
            this.lastTargetTile = targetCell;
        }
    }

    private isTargetValid(aircraft: any, game: any, target: any): boolean {
        return !!target &&
            target !== aircraft &&
            target.isSpawned !== false &&
            !target.isDestroyed &&
            !target.isCrashing &&
            target.limboData === undefined &&
            target.rules?.hunterSeekerIgnore !== true &&
            game.isValidTarget?.(target) !== false;
    }

    private resolveDetonateProximity(aircraft: any): number {
        const unitValue = aircraft.rules?.hunterSeekerDetonateProximity;
        const configured = Number.isFinite(unitValue) && unitValue > 0
            ? unitValue
            : this.context.detonateProximity;
        // A zero Ares default means no explicit range was supplied.  Keeping
        // a one-cell safety floor prevents a seeker with incomplete content
        // from orbiting a target forever while preserving authored values.
        return Math.max(1, Number.isFinite(configured) ? configured : 1);
    }

    private cancelPursuit(aircraft: any): void {
        const currentTask = aircraft.unitOrderTrait?.getCurrentTask?.();
        if (typeof currentTask?.updateTarget === "function") currentTask.cancel();
        this.lastTargetTile = undefined;
    }

    private detonate(aircraft: any, target: any, game: any): void {
        const weapon = aircraft.primaryWeapon;
        const targetCell = targetTile(target) ?? aircraft.tile;
        if (weapon?.warhead && targetCell) {
            const centerCoords = target.position?.worldPosition?.clone?.() ??
                Coords.tile3dToWorld(targetCell.rx + 0.5, targetCell.ry + 0.5, targetCell.z ?? 0);
            weapon.warhead.detonate(
                game,
                Number.isFinite(weapon.rules?.damage) ? weapon.rules.damage : 0,
                targetCell,
                target.position?.tileElevation ?? 0,
                centerCoords,
                target.zone ?? game.map.getTileZone(targetCell) ?? ZoneType.Ground,
                CollisionType.None,
                game.createTarget(target, targetCell),
                {
                    player: aircraft.owner,
                    obj: aircraft,
                    weapon,
                },
                false,
                undefined,
                undefined,
                false,
                (object: any) => object !== aircraft,
            );
        }
        if (!aircraft.isDestroyed) {
            game.destroyObject(aircraft, {
                player: aircraft.owner,
                obj: aircraft,
                weapon,
            });
        }
    }

    getHash(): number {
        return fnv32aStrings([
            "AresHunterSeekerTrait",
            this.target?.id ?? -1,
            this.lastTargetTile?.rx ?? -1,
            this.lastTargetTile?.ry ?? -1,
            this.context.randomOnly ? 1 : 0,
        ]);
    }

    debugGetState(): Record<string, unknown> {
        return {
            targetId: this.target?.id,
            lastTargetTile: this.lastTargetTile
                ? { rx: this.lastTargetTile.rx, ry: this.lastTargetTile.ry }
                : undefined,
            randomOnly: this.context.randomOnly,
            detonateProximity: this.context.detonateProximity,
        };
    }
}
