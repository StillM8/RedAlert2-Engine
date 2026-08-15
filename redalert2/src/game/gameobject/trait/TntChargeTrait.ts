import { Coords } from '@/game/Coords';
import { Warhead } from '@/game/Warhead';
import { DeathType } from '@/game/gameobject/common/DeathType';
import { CollisionType } from '@/game/gameobject/unit/CollisionType';
import { Timer } from '@/game/gameobject/unit/Timer';
import { NotifyDestroy } from './interface/NotifyDestroy';
import { NotifyTick } from './interface/NotifyTick';
import { NotifySell } from './interface/NotifySell';
import { GameObject } from '@/game/gameobject/GameObject';
import { World } from '@/game/World';
import {
    resolveAresIvanBombRules,
    type AresIvanBombChargeRules,
} from '@/extensions/ares/AresIvanBombs';

const VANILLA_BOMB_RULES = {
    deathBomb: false,
    deathBombOnAllies: false,
    destroysBridges: true,
    detachable: true,
    detonateOnSell: true,
};

export class TntChargeTrait implements NotifyDestroy, NotifySell, NotifyTick {
    private timer: Timer;
    private attackerInfo?: any;
    private bombRules?: AresIvanBombChargeRules;
    constructor() {
        this.timer = new Timer();
    }
    hasCharge(): boolean {
        return this.timer.isActive();
    }
    setCharge(ticks: number, currentTick: number, attackerInfo: any, bombRules?: AresIvanBombChargeRules): boolean {
        if (!this.hasCharge()) {
            // Negative delay means a death bomb: never auto-detonate, but
            // remain active for death/sell/manual-detonation handling.
            if (ticks < 0) {
                this.timer.setActiveFor(Number.MAX_SAFE_INTEGER, currentTick);
                this.attackerInfo = attackerInfo;
                this.bombRules = bombRules;
                return true;
            }
            this.timer.setActiveFor(Math.max(0, Math.trunc(ticks)), currentTick);
            this.attackerInfo = attackerInfo;
            this.bombRules = bombRules;
            return true;
        }
        return false;
    }
    getChargeOwner(): any {
        return this.attackerInfo?.player;
    }
    removeCharge(): void {
        this.timer.reset();
        this.attackerInfo = undefined;
        this.bombRules = undefined;
    }
    getTicksLeft(): number {
        return this.timer.getTicksLeft();
    }
    getInitialTicks(): number {
        return this.timer.getInitialTicks();
    }
    getBombImageName(): string | undefined {
        return this.bombRules?.image;
    }
    getFlickerRate(defaultValue: number): number {
        return this.bombRules?.flickerRate ?? defaultValue;
    }
    getTickingSound(): string | undefined {
        return this.bombRules?.tickingSound;
    }
    canBeDisarmed(): boolean {
        return this.bombRules?.detachable ?? true;
    }
    canBeManuallyDetonated(): boolean {
        const rules = this.bombRules;
        if (!rules) return true;
        return rules.deathBomb ? rules.canDetonateDeathBomb : rules.canDetonateTimeBomb;
    }
    [NotifyTick.onTick](gameObject: GameObject, world: World): void {
        if (this.timer.isActive() && this.timer.tick(world.currentTick) === true) {
            this.detonateIvanWarhead(world, gameObject);
        }
    }
    [NotifyDestroy.onDestroy](gameObject: GameObject, world: World, context?: any): void {
        if (this.timer.isActive() &&
            !context?.weapon?.warhead.rules.ivanBomb &&
            gameObject.deathType !== DeathType.None &&
            gameObject.deathType !== DeathType.Temporal) {
            this.timer.reset();
            this.detonateIvanWarhead(world, gameObject);
        }
    }
    [NotifySell.onSell](gameObject: GameObject, world: World): void {
        if (this.timer.isActive() && (this.bombRules?.detonateOnSell ?? true)) {
            this.detonateIvanWarhead(world, gameObject);
        }
    }
    private detonateIvanWarhead(world: World, target: GameObject): void {
        const bombRules = this.getResolvedBombRules(world, false);
        this.timer.reset();
        const damage = bombRules.damage;
        const warhead = new Warhead(world.rules.getWarhead(bombRules.warhead));
        const tile = target.tile;
        const elevation = target.tileElevation;
        const zone = target.isUnit() ? target.zone : world.map.getTileZone(tile);
        const onBridge = !!target.isUnit() && target.onBridge;
        if (bombRules.destroysBridges && target.isBuilding() && target.cabHutTrait) {
            target.cabHutTrait.demolishBridge(world, this.attackerInfo);
        }
        warhead.detonate(world as any, damage, tile, elevation, target.isBuilding()
            ? Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z + elevation)
            : target.position.worldPosition, zone, onBridge ? CollisionType.OnBridge : CollisionType.None, world.createTarget(target, tile), { ...this.attackerInfo, weapon: undefined }, false, false as any, undefined);
    }
    private getResolvedBombRules(world: World, alliedTarget: boolean): AresIvanBombChargeRules {
        return this.bombRules ?? resolveAresIvanBombRules(
            VANILLA_BOMB_RULES,
            world.rules.combatDamage,
            alliedTarget,
        );
    }
}
