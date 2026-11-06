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
    resolveAresIvanBombFrame,
    resolveAresIvanBombRules,
    type AresIvanBombChargeRules,
} from '@/extensions/ares/AresIvanBombs';
import { fnv32aStrings } from '@/util/math';
import { scalarStateHash } from '@/util/stateHash';

export const TNT_CHARGE_TRAIT_STATE_VERSION = 1 as const;

export interface TntChargeTraitState {
    version: typeof TNT_CHARGE_TRAIT_STATE_VERSION;
    active: boolean;
    ticksLeft: number;
    initialTicks: number;
    startedAtTick?: number;
    attackerPlayerListIndex?: number;
    attackerObjectId?: number;
    bombRules?: AresIvanBombChargeRules;
}

export interface TntChargeTraitRestoreContext {
    strict?: boolean;
    resolvePlayerByIndex?(index: number): unknown;
    resolveObjectById?(id: number): unknown;
}

interface PreparedTntChargeTraitState {
    state: TntChargeTraitState;
    attackerInfo?: { player?: unknown; obj?: unknown };
}

function isCanonicalIdentity(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function cloneBombRules(rules: AresIvanBombChargeRules): AresIvanBombChargeRules {
    return {
        deathBomb: rules.deathBomb,
        destroysBridges: rules.destroysBridges,
        detachable: rules.detachable,
        damage: rules.damage,
        delay: rules.delay,
        ...(rules.tickingSound !== undefined ? { tickingSound: rules.tickingSound } : {}),
        ...(rules.attachSound !== undefined ? { attachSound: rules.attachSound } : {}),
        warhead: rules.warhead,
        ...(rules.image !== undefined ? { image: rules.image } : {}),
        flickerRate: rules.flickerRate,
        canDetonateTimeBomb: rules.canDetonateTimeBomb,
        canDetonateDeathBomb: rules.canDetonateDeathBomb,
        detonateOnSell: rules.detonateOnSell,
    };
}

function parseBombRules(value: unknown): AresIvanBombChargeRules | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object") {
        throw new Error("Invalid tnt charge state: bombRules must be an object");
    }
    const rules = value as Record<string, unknown>;
    for (const field of ["deathBomb", "destroysBridges", "detachable", "canDetonateTimeBomb", "canDetonateDeathBomb", "detonateOnSell"]) {
        if (typeof rules[field] !== "boolean") {
            throw new Error(`Invalid tnt charge state: bombRules.${field} must be boolean`);
        }
    }
    if (typeof rules.damage !== "number" || !Number.isFinite(rules.damage) || rules.damage < 0) {
        throw new Error("Invalid tnt charge state: bombRules.damage");
    }
    if (!Number.isSafeInteger(rules.delay) ||
        ((rules.delay as number) < -1 || (rules.delay as number) < 0 && rules.deathBomb !== true)) {
        throw new Error("Invalid tnt charge state: bombRules.delay");
    }
    if (typeof rules.warhead !== "string") {
        throw new Error("Invalid tnt charge state: bombRules.warhead");
    }
    if (typeof rules.flickerRate !== "number" || !Number.isFinite(rules.flickerRate) || rules.flickerRate < 0) {
        throw new Error("Invalid tnt charge state: bombRules.flickerRate");
    }
    for (const field of ["tickingSound", "attachSound", "image"]) {
        if (rules[field] !== undefined && typeof rules[field] !== "string") {
            throw new Error(`Invalid tnt charge state: bombRules.${field}`);
        }
    }
    return cloneBombRules(rules as unknown as AresIvanBombChargeRules);
}

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
    captureState(): TntChargeTraitState {
        const player = this.attackerInfo?.player;
        const object = this.attackerInfo?.obj;
        if (player !== undefined && player !== null && !isCanonicalIdentity(player.playerListIndex)) {
            throw new Error("Cannot capture tnt charge state: attacker player identity is not registered");
        }
        if (object !== undefined && object !== null && !isCanonicalIdentity(object.id)) {
            throw new Error("Cannot capture tnt charge state: attacker object identity is invalid");
        }
        return {
            version: TNT_CHARGE_TRAIT_STATE_VERSION,
            active: this.timer.isActive(),
            ticksLeft: this.timer.getTicksLeft(),
            initialTicks: this.timer.getInitialTicks(),
            ...(this.timer.getActiveSince() !== undefined
                ? { startedAtTick: this.timer.getActiveSince() }
                : {}),
            ...(player !== undefined && player !== null
                ? { attackerPlayerListIndex: player.playerListIndex }
                : {}),
            ...(object !== undefined && object !== null
                ? { attackerObjectId: object.id }
                : {}),
            ...(this.bombRules !== undefined ? { bombRules: cloneBombRules(this.bombRules) } : {}),
        };
    }
    getHash(): number {
        const state = this.captureState();
        return fnv32aStrings([
            "TntChargeTrait",
            "timer",
            state.active ? 1 : 0,
            state.ticksLeft,
            state.initialTicks,
            "started-at",
            state.startedAtTick === undefined ? "absent" : "present",
            state.startedAtTick ?? -1,
            "attacker-player",
            state.attackerPlayerListIndex === undefined ? "absent" : "present",
            state.attackerPlayerListIndex ?? -1,
            "attacker-object",
            state.attackerObjectId === undefined ? "absent" : "present",
            state.attackerObjectId ?? -1,
            scalarStateHash("bombRules", state.bombRules),
        ]);
    }
    validateState(state: unknown, options: TntChargeTraitRestoreContext = {}): void {
        this.prepareRestoreState(state, options);
    }
    restoreState(state: unknown, options: TntChargeTraitRestoreContext = {}): void {
        const prepared = this.prepareRestoreState(state, options);
        this.timer.restoreState(
            prepared.state.ticksLeft,
            prepared.state.initialTicks,
            prepared.state.startedAtTick,
        );
        this.attackerInfo = prepared.attackerInfo;
        this.bombRules = prepared.state.bombRules === undefined
            ? undefined
            : cloneBombRules(prepared.state.bombRules);
    }
    private prepareRestoreState(
        state: unknown,
        options: TntChargeTraitRestoreContext,
    ): PreparedTntChargeTraitState {
        if (!state || typeof state !== "object") {
            throw new Error("Invalid tnt charge state: expected an object");
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== TNT_CHARGE_TRAIT_STATE_VERSION) {
            throw new Error(`Unsupported tnt charge state version: ${String(candidate.version)}`);
        }
        if (typeof candidate.active !== "boolean") {
            throw new Error("Invalid tnt charge state: active must be boolean");
        }
        if (!Number.isSafeInteger(candidate.ticksLeft) || (candidate.ticksLeft as number) < 0) {
            throw new Error("Invalid tnt charge state: ticksLeft");
        }
        if (!Number.isSafeInteger(candidate.initialTicks) || (candidate.initialTicks as number) < 0) {
            throw new Error("Invalid tnt charge state: initialTicks");
        }
        if (candidate.startedAtTick !== undefined && !isCanonicalIdentity(candidate.startedAtTick)) {
            throw new Error("Invalid tnt charge state: startedAtTick");
        }
        if (candidate.attackerPlayerListIndex !== undefined &&
            !isCanonicalIdentity(candidate.attackerPlayerListIndex)) {
            throw new Error("Invalid tnt charge state: attackerPlayerListIndex");
        }
        if (candidate.attackerObjectId !== undefined &&
            !isCanonicalIdentity(candidate.attackerObjectId)) {
            throw new Error("Invalid tnt charge state: attackerObjectId");
        }
        const active = candidate.active;
        const ticksLeft = candidate.ticksLeft as number;
        const initialTicks = candidate.initialTicks as number;
        if (active && (ticksLeft <= 0 || initialTicks < ticksLeft)) {
            throw new Error("Invalid tnt charge state: active timer range");
        }
        if (!active && (ticksLeft !== 0 || initialTicks !== 0)) {
            throw new Error("Invalid tnt charge state: inactive timer range");
        }
        const bombRules = parseBombRules(candidate.bombRules);
        const strict = options.strict === true;
        const player = candidate.attackerPlayerListIndex === undefined
            ? undefined
            : options.resolvePlayerByIndex?.(candidate.attackerPlayerListIndex as number) as any;
        if (candidate.attackerPlayerListIndex !== undefined) {
            if (player !== undefined && player?.playerListIndex !== candidate.attackerPlayerListIndex) {
                throw new Error(
                    `Cannot restore tnt charge state: player identity ${candidate.attackerPlayerListIndex} is unresolved`,
                );
            }
            if (strict && player === undefined) {
                throw new Error(
                    `Cannot restore tnt charge state: player identity ${candidate.attackerPlayerListIndex} is unresolved`,
                );
            }
        }
        const object = candidate.attackerObjectId === undefined
            ? undefined
            : options.resolveObjectById?.(candidate.attackerObjectId as number);
        if (candidate.attackerObjectId !== undefined) {
            if (object !== undefined && (object as any)?.id !== candidate.attackerObjectId) {
                throw new Error(
                    `Cannot restore tnt charge state: object identity ${candidate.attackerObjectId} is unresolved`,
                );
            }
            if (strict && object === undefined) {
                throw new Error(
                    `Cannot restore tnt charge state: object identity ${candidate.attackerObjectId} is unresolved`,
                );
            }
        }
        return {
            state: {
                version: TNT_CHARGE_TRAIT_STATE_VERSION,
                active,
                ticksLeft,
                initialTicks,
                ...(candidate.startedAtTick !== undefined
                    ? { startedAtTick: candidate.startedAtTick as number }
                    : {}),
                ...(candidate.attackerPlayerListIndex !== undefined
                    ? { attackerPlayerListIndex: candidate.attackerPlayerListIndex as number }
                    : {}),
                ...(candidate.attackerObjectId !== undefined
                    ? { attackerObjectId: candidate.attackerObjectId as number }
                    : {}),
                ...(bombRules !== undefined ? { bombRules } : {}),
            },
            attackerInfo: player !== undefined || object !== undefined
                ? {
                    ...(player !== undefined ? { player } : {}),
                    ...(object !== undefined ? { obj: object } : {}),
                }
                : undefined,
        };
    }
    hasCharge(): boolean {
        return this.timer.isActive();
    }
    setCharge(ticks: number, currentTick: number, attackerInfo: any, bombRules?: AresIvanBombChargeRules): boolean {
        if (!this.hasCharge()) {
            const normalizedTicks = Number.isFinite(ticks) ? Math.trunc(ticks) : 0;
            if (normalizedTicks < 0) {
                this.timer.setActiveFor(Number.MAX_SAFE_INTEGER, currentTick);
                this.attackerInfo = attackerInfo;
                this.bombRules = bombRules;
                return true;
            }
            this.timer.setActiveFor(Math.max(1, normalizedTicks), currentTick);
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
    getPlantingFrame(): number | undefined {
        return this.timer.getActiveSince();
    }
    getBombDelay(): number {
        return this.bombRules?.delay ?? this.timer.getInitialTicks();
    }
    getBombFrame(imageFrames: number, defaultFlickerRate: number = 0): number {
        const plantingFrame = this.timer.getActiveSince() ?? 0;
        const elapsedFrames = Math.max(0, this.timer.getInitialTicks() - this.timer.getTicksLeft());
        return resolveAresIvanBombFrame({
            currentFrame: plantingFrame + elapsedFrames,
            plantingFrame,
            delay: this.getBombDelay(),
            imageFrames,
            flickerRate: this.getFlickerRate(defaultFlickerRate),
            deathBomb: this.bombRules?.deathBomb,
        });
    }
    isDeathBomb(): boolean {
        return this.bombRules?.deathBomb === true;
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
            this.detonateIvanWarhead(world, gameObject);
        }
    }
    [NotifySell.onSell](gameObject: GameObject, world: World): void {
        if (this.timer.isActive() && (this.bombRules?.detonateOnSell ?? true)) {
            this.detonateIvanWarhead(world, gameObject);
        }
    }
    /**
     * Remote detonation (Ares IvanBomb.CanDetonateTimeBomb /
     * IvanBomb.CanDetonateDeathBomb): the bomb detonates early at its owner's
     * command. The documented CanDetonate* gates decide whether a time or
     * death bomb is eligible.
     */
    tryManualDetonate(gameObject: GameObject, world: World): boolean {
        if (!this.timer.isActive() || !this.canBeManuallyDetonated()) {
            return false;
        }
        this.detonateIvanWarhead(world, gameObject);
        return true;
    }

    protected detonateIvanWarhead(world: World, target: GameObject): void {
        const bombRules = this.getResolvedBombRules(world, false);
        const attackerInfo = this.attackerInfo;
        this.removeCharge();
        const damage = bombRules.damage;
        const warhead = new Warhead(world.rules.getWarhead(bombRules.warhead));
        const tile = target.tile;
        const elevation = target.tileElevation;
        const zone = target.isUnit() ? target.zone : world.map.getTileZone(tile);
        const onBridge = !!target.isUnit() && target.onBridge;
        if (bombRules.destroysBridges && target.isBuilding() && target.cabHutTrait) {
            target.cabHutTrait.demolishBridge(world, attackerInfo);
        }
        warhead.detonate(world as any, damage, tile, elevation, target.isBuilding()
            ? Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z + elevation)
            : target.position.worldPosition, zone, onBridge ? CollisionType.OnBridge : CollisionType.None, world.createTarget(target, tile), { ...attackerInfo, weapon: undefined }, false, false as any, undefined);
    }
    private getResolvedBombRules(world: World, alliedTarget: boolean): AresIvanBombChargeRules {
        return this.bombRules ?? resolveAresIvanBombRules(
            VANILLA_BOMB_RULES,
            world.rules.combatDamage,
            alliedTarget,
        );
    }
}
