import { Coords } from '@/game/Coords';
import { TriggerAnimEvent } from '@/game/event/TriggerAnimEvent';
import { TriggerSoundFxEvent } from '@/game/event/TriggerSoundFxEvent';
import { Vector3 } from '@/game/math/Vector3';
import { DriveLocomotor } from './DriveLocomotor';

const BURROW_THRESHOLD_TILES = 11;
const SUBTERRANEAN_ELEVATION = -256;
const SUBTERRANEAN_SPEED = 19;

/**
 * Standard Tunnel locomotion.
 *
 * Tunnel units use Drive-compatible ground routing near their destination and
 * switch to the retail subterranean elevation for long moves. The elevation
 * is represented by ObjectPosition, so shroud, collision, projectile-height
 * and renderer paths see the same state. Dig effects are emitted as ordinary
 * shared animation/sound events and therefore work for any authored Ares
 * ruleset.
 */
export class TunnelLocomotor extends DriveLocomotor {
    private burrowed = false;
    private transition?: { burrowed: boolean; targetElevation: number };

    constructor(game: any) {
        super(game);
    }

    selectNextWaypoint(unit: any, waypoints: any[]): any {
        this.updateBurrowState(unit, this.distanceToFinalWaypoint(unit, waypoints));
        return super.selectNextWaypoint(unit, waypoints);
    }

    /** Long Tunnel orders use a direct underground route instead of a
     * surface obstacle plan. The target cell still has to be land-passable;
     * buildings and units between the endpoints are not route blockers. */
    usesDirectPath(unit: any, targetTile: any): boolean {
        if (!unit.tile || !targetTile) return false;
        return Math.hypot(targetTile.rx - unit.tile.rx, targetTile.ry - unit.tile.ry) > BURROW_THRESHOLD_TILES;
    }

    tick(unit: any, targetPosition: any, destination: any, isCancel = false): any {
        if (this.burrowed && (isCancel || this.distanceToDestination(unit, destination) <= BURROW_THRESHOLD_TILES * Coords.LEPTONS_PER_TILE)) {
            this.beginTransition(unit, false);
        }
        const verticalMovement = this.advanceElevation(unit);
        if (verticalMovement) {
            return { distance: new Vector3(0, verticalMovement, 0), done: false };
        }
        return super.tick(unit, targetPosition, destination);
    }

    protected getSpeedMultiplier(_unit: any): number {
        return 1;
    }

    protected getMovementSpeed(unit: any): number {
        return this.burrowed ? SUBTERRANEAN_SPEED : super.getMovementSpeed(unit);
    }

    private distanceToFinalWaypoint(unit: any, waypoints: any[]): number {
        const target = waypoints[waypoints.length - 1]?.tile;
        if (!target || !unit.tile) return 0;
        return Math.hypot(target.rx - unit.tile.rx, target.ry - unit.tile.ry);
    }

    private distanceToDestination(unit: any, destination: any): number {
        const position = unit.position?.getMapPosition?.();
        return position && destination
            ? position.distanceTo(destination)
            : Number.POSITIVE_INFINITY;
    }

    private updateBurrowState(unit: any, distanceInTiles: number): void {
        if (!this.burrowed && distanceInTiles > BURROW_THRESHOLD_TILES) {
            this.beginTransition(unit, true);
        }
        else if (this.burrowed && distanceInTiles <= BURROW_THRESHOLD_TILES) {
            this.beginTransition(unit, false);
        }
    }

    private beginTransition(unit: any, burrowed: boolean): void {
        if (this.burrowed === burrowed && !this.transition) return;
        if (this.transition?.burrowed === burrowed) return;
        const previousPosition = unit.position?.worldPosition?.clone?.();
        const animation = burrowed
            ? (unit.rules?.digIn || this.game.rules?.audioVisual?.dig)
            : (unit.rules?.digOut || this.game.rules?.audioVisual?.dig);
        const sound = burrowed
            ? (unit.rules?.digInSound || this.game.rules?.audioVisual?.digSound)
            : (unit.rules?.digOutSound || this.game.rules?.audioVisual?.digSound);

        if (animation && unit.tile) {
            this.game.events?.dispatch?.(new TriggerAnimEvent(
                animation,
                unit.tile,
                previousPosition,
                unit.owner,
                unit,
            ));
        }
        if (sound && unit.tile) {
            this.game.events?.dispatch?.(new TriggerSoundFxEvent(sound, unit.tile));
        }

        const surfaceElevation = unit.onBridge
            ? this.game.map?.tileOccupation?.getBridgeOnTile?.(unit.tile)?.tileElevation ?? 0
            : 0;
        this.transition = {
            burrowed,
            targetElevation: burrowed ? SUBTERRANEAN_ELEVATION : surfaceElevation,
        };
    }

    private advanceElevation(unit: any): number {
        if (!this.transition) return 0;
        const currentElevation = Number(unit.position?.tileElevation ?? 0);
        const targetElevation = this.transition.targetElevation;
        const difference = targetElevation - currentElevation;
        if (!difference) {
            this.burrowed = this.transition.burrowed;
            this.transition = undefined;
            return 0;
        }
        const configured = Number(this.game.rules?.general?.tunnelSpeed);
        const tunnelSpeed = Number.isFinite(configured) ? Math.max(0, configured) : 1;
        const verticalLeptons = Math.sign(difference) * Math.min(
            Math.abs(difference),
            unit.moveTrait.baseSpeed * tunnelSpeed,
        );
        if (!verticalLeptons) return 0;
        if (Math.abs(verticalLeptons) >= Math.abs(difference)) {
            this.burrowed = this.transition.burrowed;
            this.transition = undefined;
        }
        return Coords.tileHeightToWorld(verticalLeptons);
    }
}
