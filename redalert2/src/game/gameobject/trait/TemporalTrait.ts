import { DeathType } from '@/game/gameobject/common/DeathType';
import { AttackTask } from '@/game/gameobject/task/AttackTask';
import { MoveTask } from '@/game/gameobject/task/move/MoveTask';
import { NotifyDestroy } from './interface/NotifyDestroy';
import { NotifyTick } from './interface/NotifyTick';
import { GameObject } from '@/game/gameobject/GameObject';
import { World } from '@/game/World';
import { applyAresChronoPrison } from '@/extensions/ares/AresChronoPrisonIntegration';
export class TemporalTrait {
    private gameObject: GameObject;
    private ticksWhenWarpedOut: boolean = true;
    private attackers: Set<GameObject> = new Set();
    private currentTarget?: GameObject;
    private currentWeapon?: any;
    private eraseTicks?: number;
    constructor(gameObject: GameObject) {
        this.gameObject = gameObject;
    }
    [NotifyTick.onTick](gameObject: GameObject, world: World): void {
        gameObject.attackTrait &&
            ((gameObject.attackTrait.currentTarget &&
                !gameObject.warpedOutTrait.isActive()) ||
                this.releaseCurrentTarget(world));
        if (this.eraseTicks !== undefined) {
            for (const attacker of this.attackers) {
                const weapon = attacker.temporalTrait?.currentWeapon;
                if (!weapon || attacker.isDestroyed || attacker.isDisposed) {
                    // An attacker can be removed between target acquisition
                    // and the target's next temporal tick.  Treat the stale
                    // link as a released beam instead of crashing the match.
                    attacker.temporalTrait?.releaseCurrentTarget?.(world);
                    continue;
                }
                const damage = weapon.rules.damage;
                this.eraseTicks -= damage;
                if (this.eraseTicks <= 0) {
                    const chronoDecision = applyAresChronoPrison(
                        attacker,
                        gameObject,
                        weapon.rules,
                        world as any,
                        {
                            phase: "temporal-erasure",
                            warheadIsTemporal: weapon.warhead?.rules?.temporal === true,
                            warheadCanAffect: true,
                        },
                    );
                    if (chronoDecision.eligible) {
                        this.eraseTicks = undefined;
                        break;
                    }
                    gameObject.deathType = DeathType.Temporal;
                    gameObject.temporalWarpAwayOverride = weapon?.warhead?.rules?.temporalWarpAway;
                    world.destroyObject(gameObject, { player: attacker.owner, obj: attacker, weapon }, true);
                    this.eraseTicks = undefined;
                    break;
                }
            }
            if (!this.attackers.size) {
                this.eraseTicks = undefined;
            }
        }
    }
    captureState(): Record<string, unknown> {
        return {
            version: 1,
            targetId: this.currentTarget?.id ?? null,
            weaponName: this.currentWeapon?.rules?.name ?? null,
            weaponType: this.currentWeapon?.type ?? null,
            attackerIds: [...this.attackers].map(attacker => attacker.id).sort((a, b) => a - b),
            eraseTicks: this.eraseTicks ?? null,
        };
    }
    restoreState(state: unknown, context: { resolveObjectById?: (id: number) => any; strict?: boolean } = {}): void {
        if (!state || typeof state !== "object" || (state as any).version !== 1 ||
            (state as any).targetId !== null && !Number.isSafeInteger((state as any).targetId) ||
            !Array.isArray((state as any).attackerIds) || (state as any).eraseTicks !== null &&
            !Number.isSafeInteger((state as any).eraseTicks)) {
            throw new Error("Invalid temporal state");
        }
        const target = (state as any).targetId === null ? undefined : context.resolveObjectById?.((state as any).targetId);
        if ((state as any).targetId !== null && !target && context.strict) {
            throw new Error("Cannot restore temporal target: unresolved");
        }
        const weaponName = (state as any).weaponName as string | null;
        const weapon = weaponName
            ? [this.gameObject?.primaryWeapon, this.gameObject?.secondaryWeapon, this.gameObject?.deathWeapon]
                .find((candidate: any) => candidate?.rules?.name === weaponName)
            : undefined;
        if (weaponName && !weapon && context.strict) {
            throw new Error("Cannot restore temporal weapon: unresolved");
        }
        this.currentTarget = undefined;
        this.currentWeapon = undefined;
        this.attackers.clear();
        this.currentTarget = target;
        this.currentWeapon = weapon;
        this.eraseTicks = (state as any).eraseTicks ?? undefined;
        for (const id of (state as any).attackerIds as number[]) {
            const attacker = context.resolveObjectById?.(id);
            if (!attacker && context.strict) throw new Error(`Cannot restore temporal attacker ${id}: unresolved`);
            if (attacker) this.attackers.add(attacker);
        }
    }
    getTarget(): GameObject | undefined {
        return this.currentTarget;
    }
    updateTarget(target: GameObject, weapon: any, world: World): void {
        if (!target || target.isDestroyed || target.isDisposed || target.rules?.warpable === false) {
            this.releaseCurrentTarget(world);
            return;
        }
        if (this.currentTarget !== target) {
            this.releaseCurrentTarget(world);
            this.currentTarget = target;
            this.currentWeapon = weapon;
            const attackerCount = target.temporalTrait.attackers.size;
            target.temporalTrait.attackers.add(this.gameObject);
            if (!attackerCount) {
                target.warpedOutTrait.setActive(true, true, world);
                const currentTask = target.unitOrderTrait.getCurrentTask();
                if ((currentTask && currentTask instanceof AttackTask) ||
                    currentTask instanceof MoveTask) {
                    currentTask.cancel();
                }
                target.temporalTrait.eraseTicks = 10 * target.healthTrait.maxHitPoints;
            }
        }
    }
    releaseCurrentTarget(world: World): void {
        if (this.currentTarget) {
            if (!this.currentTarget.isDisposed) {
                const attackers = this.currentTarget.temporalTrait.attackers;
                attackers.delete(this.gameObject);
                if (!attackers.size) {
                    this.currentTarget.warpedOutTrait.expire(world);
                    this.currentTarget.temporalTrait.eraseTicks = undefined;
                }
            }
            this.currentTarget = undefined;
            this.currentWeapon = undefined;
        }
    }
    /** Release all temporal attackers before Ares moves this unit into limbo. */
    releaseAttackersForAresAbduction(world: World): void {
        for (const attacker of [...this.attackers]) {
            attacker.temporalTrait?.releaseCurrentTarget?.(world);
        }
        this.attackers.clear();
        this.eraseTicks = undefined;
    }
    [NotifyDestroy.onDestroy](gameObject: GameObject, world: World): void {
        this.releaseCurrentTarget(world);
    }
    dispose(): void {
        this.gameObject = undefined;
        this.attackers.clear();
    }
}
