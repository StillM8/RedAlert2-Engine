import { NotifyUnspawn } from './interface/NotifyUnspawn';
import { GameObject } from '@/game/gameobject/GameObject';
import { World } from '@/game/World';
import { fnv32aStrings } from '@/util/math';

export const MIND_CONTROLLABLE_TRAIT_STATE_VERSION = 1 as const;

export interface MindControllableTraitState {
    version: typeof MIND_CONTROLLABLE_TRAIT_STATE_VERSION;
    permanent: boolean;
    controllerId?: number;
    controllerPlayerIndex?: number;
    controllerName?: string;
    ownerPlayerIndex?: number;
    ownerName?: string;
    previousOwnerPlayerIndex?: number;
    previousOwnerName?: string;
}

export interface MindControllableTraitRestoreContext {
    strict?: boolean;
    resolveObjectById?(id: number): GameObject | undefined;
    resolvePlayerByIndex?(index: number): any;
    resolvePlayerByName?(name: string): any;
    changeObjectOwner?(object: GameObject, owner: any): void;
}

export class MindControllableTrait {
    private gameObject: GameObject;
    private controller?: GameObject;
    private prevOwner?: any;
    private permanent = false;
    private readonly getPlayerIndex?: (player: any) => number | undefined;

    constructor(gameObject: GameObject, options: { getPlayerIndex?(player: any): number | undefined } = {}) {
        this.gameObject = gameObject;
        this.getPlayerIndex = options.getPlayerIndex;
    }

    getOriginalOwner(): any {
        return this.prevOwner;
    }

    isActive(): boolean {
        return this.permanent || !!this.controller;
    }

    isPermanent(): boolean {
        return this.permanent;
    }

    canBeMindControlled(): boolean {
        return !this.permanent && !this.controller;
    }

    getController(): GameObject | undefined {
        return this.controller;
    }

    controlBy(controller: GameObject, world: World): void {
        if (this.permanent) {
            throw new Error(`Object "${this.gameObject?.name}" is permanently mind controlled`);
        }
        if (this.controller) {
            throw new Error(`Object "${this.gameObject?.name}" is already mind controlled by "${controller.name}"`);
        }
        this.controller = controller;
        this.prevOwner = this.gameObject.owner;
        if (world.changeObjectOwner) {
            world.changeObjectOwner(this.gameObject, controller.owner);
        }
        else {
            this.gameObject.owner = controller.owner;
        }
    }

    capturePermanent(owner: any, world: World): boolean {
        if (!owner) return false;
        this.controller?.mindControllerTrait?.cleanTarget?.(this.gameObject);
        this.controller = undefined;
        this.prevOwner = undefined;
        this.permanent = true;
        if (world.changeObjectOwner) {
            world.changeObjectOwner(this.gameObject, owner);
        }
        else {
            this.gameObject.owner = owner;
        }
        return true;
    }

    restore(world: World): void {
        if (this.permanent) return;
        if (this.prevOwner) {
            this.controller?.mindControllerTrait?.cleanTarget?.(this.gameObject);
            if (world.changeObjectOwner) {
                world.changeObjectOwner(this.gameObject, this.prevOwner);
            }
            else {
                this.gameObject.owner = this.prevOwner;
            }
            this.prevOwner = undefined;
            this.controller = undefined;
        }
    }

    makePermanent(markPermanent: boolean = false): void {
        this.controller?.mindControllerTrait?.cleanTarget?.(this.gameObject);
        this.controller = undefined;
        this.prevOwner = undefined;
        if (markPermanent) this.permanent = true;
    }

    captureState(): MindControllableTraitState {
        const controllerIndex = this.controller === undefined
            ? undefined
            : this.getPlayerIndex?.(this.controller.owner);
        const previousOwnerIndex = this.prevOwner === undefined
            ? undefined
            : this.getPlayerIndex?.(this.prevOwner);
        const ownerIndex = this.permanent
            ? this.getPlayerIndex?.(this.gameObject.owner)
            : undefined;
        const controllerName = this.controller === undefined
            ? undefined
            : String(this.controller.name ?? this.controller.id ?? "");
        const ownerName = this.permanent
            ? String(this.gameObject.owner?.name ?? this.gameObject.owner?.id ?? "")
            : undefined;
        const previousOwnerName = this.prevOwner === undefined
            ? undefined
            : String(this.prevOwner.name ?? this.prevOwner.id ?? "");
        return {
            version: MIND_CONTROLLABLE_TRAIT_STATE_VERSION,
            permanent: this.permanent,
            ...(this.controller?.id !== undefined ? { controllerId: this.controller.id } : {}),
            ...(controllerIndex !== undefined ? { controllerPlayerIndex: controllerIndex } : {}),
            ...(controllerName ? { controllerName } : {}),
            ...(ownerIndex !== undefined ? { ownerPlayerIndex: ownerIndex } : {}),
            ...(ownerName ? { ownerName } : {}),
            ...(previousOwnerIndex !== undefined ? { previousOwnerPlayerIndex: previousOwnerIndex } : {}),
            ...(previousOwnerName ? { previousOwnerName } : {}),
        };
    }

    serializeState(): MindControllableTraitState {
        return this.captureState();
    }

    validateState(state: unknown): MindControllableTraitState {
        if (!state || typeof state !== 'object') {
            throw new Error('Invalid mind-control state: expected an object');
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== MIND_CONTROLLABLE_TRAIT_STATE_VERSION) {
            throw new Error(`Unsupported mind-control state version: ${String(candidate.version)}`);
        }
        if (typeof candidate.permanent !== 'boolean') {
            throw new Error('Invalid mind-control state: permanent');
        }
        for (const key of ['controllerId', 'controllerPlayerIndex', 'ownerPlayerIndex', 'previousOwnerPlayerIndex'] as const) {
            if (candidate[key] !== undefined &&
                (!Number.isSafeInteger(candidate[key]) || (candidate[key] as number) < 0)) {
                throw new Error(`Invalid mind-control state: ${key}`);
            }
        }
        for (const key of ['controllerName', 'ownerName', 'previousOwnerName'] as const) {
            if (candidate[key] !== undefined && typeof candidate[key] !== 'string') {
                throw new Error(`Invalid mind-control state: ${key}`);
            }
        }
        if (candidate.permanent && (candidate.controllerId !== undefined || candidate.controllerName !== undefined)) {
            throw new Error('Invalid mind-control state: permanent controller');
        }
        if (!candidate.permanent && candidate.controllerId === undefined && candidate.controllerName === undefined &&
            candidate.previousOwnerPlayerIndex !== undefined) {
            throw new Error('Invalid mind-control state: previous owner');
        }
        return {
            version: MIND_CONTROLLABLE_TRAIT_STATE_VERSION,
            permanent: candidate.permanent,
            ...(candidate.controllerId !== undefined ? { controllerId: candidate.controllerId as number } : {}),
            ...(candidate.controllerPlayerIndex !== undefined ? { controllerPlayerIndex: candidate.controllerPlayerIndex as number } : {}),
            ...(candidate.controllerName !== undefined ? { controllerName: candidate.controllerName as string } : {}),
            ...(candidate.ownerPlayerIndex !== undefined ? { ownerPlayerIndex: candidate.ownerPlayerIndex as number } : {}),
            ...(candidate.ownerName !== undefined ? { ownerName: candidate.ownerName as string } : {}),
            ...(candidate.previousOwnerPlayerIndex !== undefined ? { previousOwnerPlayerIndex: candidate.previousOwnerPlayerIndex as number } : {}),
            ...(candidate.previousOwnerName !== undefined ? { previousOwnerName: candidate.previousOwnerName as string } : {}),
        };
    }

    restoreState(state: unknown, context: MindControllableTraitRestoreContext = {}): void {
        const normalized = this.validateState(state);
        const controller = normalized.controllerId !== undefined
            ? context.resolveObjectById?.(normalized.controllerId)
            : undefined;
        const resolvePlayer = (index: number | undefined, name: string | undefined): any => {
            const byIndex = index !== undefined ? context.resolvePlayerByIndex?.(index) : undefined;
            if (byIndex !== undefined) return byIndex;
            return name !== undefined ? context.resolvePlayerByName?.(name) : undefined;
        };
        const previousOwner = resolvePlayer(
            normalized.previousOwnerPlayerIndex,
            normalized.previousOwnerName,
        );
        const permanentOwner = resolvePlayer(
            normalized.ownerPlayerIndex,
            normalized.ownerName,
        );
        if (context.strict && normalized.controllerId !== undefined && !controller) {
            throw new Error(`Cannot restore mind-control controller ${normalized.controllerId}: unresolved`);
        }
        if (context.strict && normalized.previousOwnerPlayerIndex !== undefined && !previousOwner) {
            throw new Error(`Cannot restore mind-control owner ${normalized.previousOwnerPlayerIndex}: unresolved`);
        }
        if (context.strict && normalized.previousOwnerName !== undefined && !previousOwner) {
            throw new Error(`Cannot restore mind-control owner ${normalized.previousOwnerName}: unresolved`);
        }
        if (context.strict && normalized.ownerPlayerIndex !== undefined && !permanentOwner) {
            throw new Error(`Cannot restore mind-control owner ${normalized.ownerPlayerIndex}: unresolved`);
        }
        if (context.strict && normalized.ownerName !== undefined && !permanentOwner) {
            throw new Error(`Cannot restore mind-control owner ${normalized.ownerName}: unresolved`);
        }
        this.controller?.mindControllerTrait?.cleanTarget?.(this.gameObject);
        this.controller = controller;
        this.prevOwner = previousOwner;
        this.permanent = normalized.permanent;
        const controllerOwner = controller?.owner ?? resolvePlayer(
            normalized.controllerPlayerIndex,
            normalized.controllerName,
        );
        const restoredOwner = this.permanent
            ? permanentOwner
            : controllerOwner ?? previousOwner;
        if (restoredOwner) {
            if (context.changeObjectOwner) {
                context.changeObjectOwner(this.gameObject, restoredOwner);
            }
            else {
                this.gameObject.owner = restoredOwner;
            }
        }
        if (controller) {
            controller.mindControllerTrait?.adoptTarget?.(this.gameObject);
        }
    }

    restoreSerializedState(state: unknown, context: MindControllableTraitRestoreContext = {}): void {
        this.restoreState(state, context);
    }

    getHash(): number {
        return fnv32aStrings([
            'MindControllableTrait',
            this.permanent ? 1 : 0,
            this.controller?.id ?? -1,
            (this.controller ? this.getPlayerIndex?.(this.controller.owner) : undefined) ?? -1,
            (this.prevOwner ? this.getPlayerIndex?.(this.prevOwner) : undefined) ?? -1,
        ]);
    }

    debugGetState(): MindControllableTraitState {
        return this.captureState();
    }

    [NotifyUnspawn.onUnspawn](gameObject: GameObject, world: World): void {
        if (this.permanent) return;
        if (this.controller) {
            this.controller.mindControllerTrait.cleanTarget(gameObject);
            if (!gameObject.isDestroyed && gameObject.limboData) {
                this.restore(world);
            }
        }
    }

    dispose(): void {
        this.controller = undefined;
        this.prevOwner = undefined;
        this.permanent = false;
        this.gameObject = undefined as any;
    }
}
