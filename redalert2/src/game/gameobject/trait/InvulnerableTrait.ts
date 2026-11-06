import { Timer } from '@/game/gameobject/unit/Timer';
import { NotifyTick } from './interface/NotifyTick';
import { GameObject } from '@/game/gameobject/GameObject';
import { World } from '@/game/World';
import { fnv32aStrings } from '@/util/math';
import { resolveAresIronCurtainDuration } from '@/extensions/ares/AresWarheadEffects';

export const INVULNERABLE_TRAIT_STATE_VERSION = 1 as const;
export type ProtectionSource = 'generic' | 'iron-curtain' | 'force-shield';

export interface InvulnerableTraitState {
    version: typeof INVULNERABLE_TRAIT_STATE_VERSION;
    remainingFrames: number;
    initialFrames: number;
    activeSince?: number;
    source: ProtectionSource;
}

export class InvulnerableTrait {
    private timer: Timer;
    private source: ProtectionSource;

    constructor() {
        this.timer = new Timer();
        this.source = 'generic';
    }

    isActive(): boolean {
        return this.timer.isActive();
    }

    isIronCurtained(): boolean {
        return this.isActive() && this.source === 'iron-curtain';
    }

    getRemainingFrames(): number {
        return this.timer.getTicksLeft();
    }

    setActiveFor(duration: number, timestampOrWorld?: number | World, source: ProtectionSource = 'generic'): void {
        const timestamp = typeof timestampOrWorld === 'number'
            ? timestampOrWorld
            : timestampOrWorld?.currentTick;
        const ticks = Number.isFinite(duration) ? Math.max(0, Math.trunc(duration)) : 0;
        this.timer.setActiveFor(ticks, timestamp);
        this.source = ticks > 0 ? source : 'generic';
    }

    applyIronCurtain(duration: number, cap: number, modifier: number, timestamp?: number): {
        previousFrames: number;
        remainingFrames: number;
    } {
        const previousFrames = this.getRemainingFrames();
        const remainingFrames = Math.max(0, resolveAresIronCurtainDuration(
            previousFrames,
            duration,
            cap,
            modifier,
        ));
        if (remainingFrames > 0) {
            this.setActiveFor(remainingFrames, timestamp, 'iron-curtain');
        }
        else {
            this.clear();
        }
        return { previousFrames, remainingFrames };
    }

    clear(): void {
        this.timer.reset();
        this.source = 'generic';
    }

    captureState(): InvulnerableTraitState {
        const activeSince = this.timer.getActiveSince();
        return {
            version: INVULNERABLE_TRAIT_STATE_VERSION,
            remainingFrames: this.timer.getTicksLeft(),
            initialFrames: this.timer.getInitialTicks(),
            ...(typeof activeSince === 'number' ? { activeSince } : {}),
            source: this.source,
        };
    }

    serializeState(): InvulnerableTraitState {
        return this.captureState();
    }

    validateState(state: unknown): InvulnerableTraitState {
        if (!state || typeof state !== 'object') {
            throw new Error('Invalid protection trait state: expected an object');
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== INVULNERABLE_TRAIT_STATE_VERSION) {
            throw new Error(`Unsupported protection trait state version: ${String(candidate.version)}`);
        }
        for (const key of ['remainingFrames', 'initialFrames'] as const) {
            if (!Number.isSafeInteger(candidate[key]) || (candidate[key] as number) < 0) {
                throw new Error(`Invalid protection trait state: ${key}`);
            }
        }
        if ((candidate.remainingFrames as number) > (candidate.initialFrames as number)) {
            throw new Error('Invalid protection trait state: remainingFrames');
        }
        if (candidate.activeSince !== undefined &&
            (!Number.isSafeInteger(candidate.activeSince) || (candidate.activeSince as number) < 0)) {
            throw new Error('Invalid protection trait state: activeSince');
        }
        if (!['generic', 'iron-curtain', 'force-shield'].includes(candidate.source as string)) {
            throw new Error('Invalid protection trait state: source');
        }
        return {
            version: INVULNERABLE_TRAIT_STATE_VERSION,
            remainingFrames: candidate.remainingFrames as number,
            initialFrames: candidate.initialFrames as number,
            ...(candidate.activeSince !== undefined ? { activeSince: candidate.activeSince as number } : {}),
            source: candidate.source as ProtectionSource,
        };
    }

    restoreState(state: unknown): void {
        const normalized = this.validateState(state);
        this.timer.restoreState(normalized.remainingFrames, normalized.initialFrames, normalized.activeSince);
        this.source = normalized.source;
    }

    getHash(): number {
        return fnv32aStrings([
            'InvulnerableTrait',
            this.timer.getTicksLeft(),
            this.timer.getInitialTicks(),
            this.timer.getActiveSince() ?? -1,
            this.source,
        ]);
    }

    debugGetState(): InvulnerableTraitState {
        return this.captureState();
    }

    [NotifyTick.onTick](gameObject: GameObject, world: World): void {
        if (this.timer.tick(world.currentTick)) {
            this.source = 'generic';
        }
    }

    dispose(): void {
        this.timer.reset();
        this.source = 'generic';
    }
}

export class IronCurtainTrait extends InvulnerableTrait {
}
