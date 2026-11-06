import { NotifyUnspawn } from './interface/NotifyUnspawn';
import { GameObject } from '@/game/gameobject/GameObject';
import { World } from '@/game/World';
import { fnv32aStrings } from '@/util/math';

export const MIND_CONTROLLER_TRAIT_STATE_VERSION = 1 as const;

export interface MindControllerTraitState {
    version: typeof MIND_CONTROLLER_TRAIT_STATE_VERSION;
    maxCapacity: number | null;
    targetIds: number[];
}

export interface MindControllerTraitRestoreContext {
    strict?: boolean;
    resolveObjectById?(id: number): GameObject | undefined;
}

export class MindControllerTrait {
    private gameObject: GameObject;
    private maxCapacity: number;
    private targets: GameObject[];

    constructor(gameObject: GameObject, maxCapacity: number = 1) {
        this.gameObject = gameObject;
        this.maxCapacity = maxCapacity;
        this.targets = [];
    }

    isActive(): boolean {
        return this.targets.length > 0;
    }

    isAtCapacity(): boolean {
        return this.targets.length >= this.maxCapacity;
    }

    getTargets(): GameObject[] {
        return this.targets;
    }

    control(target: GameObject, world: World): boolean {
        if (!this.gameObject) {
            throw new Error("Trait already disposed");
        }
        if (!target.mindControllableTrait) {
            throw new Error(`Target "${target.name}" cannot be mind controlled`);
        }
        if (target.isDisposed || !target.mindControllableTrait.canBeMindControlled()) {
            return false;
        }
        target.mindControllableTrait.controlBy(this.gameObject, world);
        this.targets.push(target);
        while (this.targets.length > this.maxCapacity) {
            const oldestTarget = this.targets.shift();
            oldestTarget.mindControllableTrait.restore(world);
        }
        return true;
    }

    adoptTarget(target: GameObject): void {
        if (!this.targets.includes(target)) this.targets.push(target);
    }

    cleanTarget(target: GameObject): void {
        const index = this.targets.indexOf(target);
        if (index !== -1) {
            this.targets.splice(index, 1);
        }
    }

    captureState(): MindControllerTraitState {
        return {
            version: MIND_CONTROLLER_TRAIT_STATE_VERSION,
            maxCapacity: Number.isFinite(this.maxCapacity) ? this.maxCapacity : null,
            targetIds: this.targets
                .map((target) => target.id)
                .filter((id) => Number.isSafeInteger(id) && id >= 0),
        };
    }

    serializeState(): MindControllerTraitState {
        return this.captureState();
    }

    validateState(state: unknown): MindControllerTraitState {
        if (!state || typeof state !== 'object') {
            throw new Error('Invalid mind-controller state: expected an object');
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== MIND_CONTROLLER_TRAIT_STATE_VERSION) {
            throw new Error(`Unsupported mind-controller state version: ${String(candidate.version)}`);
        }
        const unlimited = candidate.maxCapacity === Number.POSITIVE_INFINITY;
        if (candidate.maxCapacity !== null && !unlimited &&
            (typeof candidate.maxCapacity !== 'number' || !Number.isSafeInteger(candidate.maxCapacity) || candidate.maxCapacity < 0)) {
            throw new Error('Invalid mind-controller state: maxCapacity');
        }
        if (!Array.isArray(candidate.targetIds) || candidate.targetIds.some((id) =>
            !Number.isSafeInteger(id) || (id as number) < 0)) {
            throw new Error('Invalid mind-controller state: targetIds');
        }
        if (new Set(candidate.targetIds as number[]).size !== (candidate.targetIds as number[]).length) {
            throw new Error('Invalid mind-controller state: duplicate targetIds');
        }
        if (candidate.maxCapacity !== null &&
            (candidate.targetIds as number[]).length > (candidate.maxCapacity as number)) {
            throw new Error('Invalid mind-controller state: targetIds exceed maxCapacity');
        }
        return {
            version: MIND_CONTROLLER_TRAIT_STATE_VERSION,
            maxCapacity: candidate.maxCapacity as number | null,
            targetIds: [...candidate.targetIds as number[]],
        };
    }

    restoreState(state: unknown, context: MindControllerTraitRestoreContext = {}): void {
        const normalized = this.validateState(state);
        const targets = normalized.targetIds.map((id) => context.resolveObjectById?.(id));
        if (context.strict && targets.some((target) => !target)) {
            throw new Error('Cannot restore mind-controller state: target unresolved');
        }
        this.targets = targets.filter((target): target is GameObject => !!target);
        this.maxCapacity = normalized.maxCapacity ?? Number.POSITIVE_INFINITY;
    }

    restoreSerializedState(state: unknown, context: MindControllerTraitRestoreContext = {}): void {
        this.restoreState(state, context);
    }

    getHash(): number {
        return fnv32aStrings([
            'MindControllerTrait',
            this.maxCapacity,
            ...this.targets.map((target) => target.id ?? -1),
        ]);
    }

    debugGetState(): MindControllerTraitState {
        return this.captureState();
    }

    [NotifyUnspawn.onUnspawn](gameObject: GameObject, world: World): void {
        for (const target of this.targets) {
            target.mindControllableTrait.restore(world);
        }
        this.targets.length = 0;
    }

    dispose(): void {
        this.targets.length = 0;
        this.gameObject = undefined as any;
    }
}
