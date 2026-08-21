import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import {
    advanceAresAttachEffectsInPlace,
    applyAresAttachEffect,
    discardAresAttachEffectsOnEntry,
    type AresAttachEffectApplyResult,
    type AresAttachEffectId,
    type AresAttachEffectInstance,
    type AresAttachEffectAdvanceResult,
    type AresAttachEffectRemovalResult,
} from "@/extensions/ares/AresAttachEffectRuntime";
import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { NotifyUnspawn } from "@/game/gameobject/trait/interface/NotifyUnspawn";
import {
    restoreAresAttachEffectExtensionState,
    serializeAresAttachEffectExtensionState,
    type AresAttachEffectExtensionState,
    type AresAttachEffectStateTarget,
} from "@/extensions/ares/AresAttachEffectState";
import {
    advanceAresAnimationDamage,
    parseAresAnimationDamage,
} from "@/extensions/ares/AresAnimationDamage";
import { GameSpeed } from "@/game/GameSpeed";

export interface AresAttachEffectMultipliers {
    speed: number;
    armor: number;
    firepower: number;
    rof: number;
}

export interface AresAttachEffectTraitOptions {
    /** Owning techno used for temporary Cloakable and residual-effect seams. */
    gameObject?: any;
    definitions?: ReadonlyMap<AresAttachEffectId, AresAttachEffectDefinition>;
    instances?: readonly AresAttachEffectInstance[];
    /** Optional TechnoType-owned effect that is scheduled from spawn onward. */
    automaticEffect?: AresAttachEffectBinding;
}

interface AresAnimationDamageRuntimeState {
    accumulator: number;
    frameAccumulator: number;
    sourcePlayer?: any;
}

export interface AresAttachEffectBinding {
    effectId: AresAttachEffectId;
    definition: AresAttachEffectDefinition;
}

export type AresAttachEffectAutomaticPhase =
    | "inactive"
    | "waiting-initial"
    | "active"
    | "waiting-renewal"
    | "disabled";

export interface AresAttachEffectAutomaticSchedule {
    phase: AresAttachEffectAutomaticPhase;
    remainingDelay: number;
}

export interface AresAttachEffectTraitAdvanceResult extends AresAttachEffectAdvanceResult {
    /** Present when expiry or a pending delay caused an automatic retry/apply. */
    automaticApply?: AresAttachEffectApplyResult;
}

export interface AresAttachEffectPresentation {
    effectId: AresAttachEffectId;
    animation?: string;
    temporalHidesAnim: boolean;
}

/**
 * Generic gameplay bridge for Ares AttachEffect state.
 *
 * The trait owns effect instances, aggregate numeric modifiers, and the
 * presentation state consumed by the shared render plugin. It deliberately
 * does not mutate movement, armor, weapon, cloak, save, or network services.
 */
export class AresAttachEffectTrait implements NotifySpawn, NotifyTick, NotifyUnspawn {
    private readonly gameObject?: any;
    private instances: AresAttachEffectInstance[];
    private definitions: Map<AresAttachEffectId, AresAttachEffectDefinition>;
    private automaticEffect?: AresAttachEffectBinding;
    private automaticPhase: AresAttachEffectAutomaticPhase = "inactive";
    private automaticRemainingDelay = 0;
    private presentationRevision = 0;
    private animationRevision = 0;
    private animationDamageState = new Map<AresAttachEffectId, AresAnimationDamageRuntimeState[]>();

    constructor(options: AresAttachEffectTraitOptions = {}) {
        this.gameObject = options.gameObject;
        this.instances = (options.instances ?? []).map(instance => ({ ...instance }));
        this.definitions = new Map(options.definitions ?? []);
        this.automaticEffect = options.automaticEffect;
        if (this.automaticEffect) {
            this.definitions.set(this.automaticEffect.effectId, this.automaticEffect.definition);
            this.automaticPhase = this.hasAutomaticInstance() ? "active" : "inactive";
        }
        this.reconcileAnimationDamageState([], this.instances);
        this.syncDynamicCloak();
    }

    getState(): readonly AresAttachEffectInstance[] {
        return this.instances.map(instance => ({ ...instance }));
    }

    /**
     * Deterministic state fingerprint over live effect instances, the
     * automatic-effect schedule, and pending animation-damage accumulation
     * so lockstep hash checkpoints can detect AttachEffect divergence between
     * peers or after a snapshot restore.
     */
    getHash(): number {
        let hash = this.automaticPhase.length;
        for (const instance of this.instances) {
            hash = (hash * 31 + instance.remainingFrames) | 0;
            hash = (hash * 31 + (instance.discardOnEntry ? 1 : 0)) | 0;
        }
        hash = (hash * 31 + this.automaticRemainingDelay) | 0;
        // Accumulators are fractional; quantize to fixed-point so the integer
        // hash is stable across identical floating-point sequences.
        for (const effectId of [...this.animationDamageState.keys()].sort()) {
            const states = this.animationDamageState.get(effectId)!;
            states.forEach((state, occurrence) => {
                if (!state) return;
                for (const char of effectId) {
                    hash = (hash * 31 + char.charCodeAt(0)) | 0;
                }
                hash = (hash * 31 + occurrence) | 0;
                hash = (hash * 31 + Math.round(state.accumulator * 256)) | 0;
                hash = (hash * 31 + Math.round(state.frameAccumulator * 256)) | 0;
            });
        }
        return hash;
    }

    /** Returns the AttachEffect state needed by a deterministic snapshot host. */
    serializeState(): AresAttachEffectExtensionState {
        return serializeAresAttachEffectExtensionState({
            instances: this.instances,
            automaticPhase: this.automaticPhase,
            automaticRemainingDelay: this.automaticRemainingDelay,
            animationDamage: this.serializeAnimationDamage(),
        });
    }

    private serializeAnimationDamage() {
        const snapshots = [];
        for (const [effectId, states] of this.animationDamageState) {
            states.forEach((state, occurrence) => {
                if (!state) return;
                // Zero accumulators carry no information; omitting them keeps
                // damage-free snapshots identical to the original format.
                if (state.accumulator === 0 && state.frameAccumulator === 0) return;
                snapshots.push({
                    effectId,
                    occurrence,
                    accumulator: state.accumulator,
                    frameAccumulator: state.frameAccumulator,
                });
            });
        }
        return snapshots;
    }

    /** Restore active effects and the automatic scheduler as one state unit. */
    restoreState(state: unknown): void {
        const restored: AresAttachEffectStateTarget = {
            instances: this.instances,
            automaticPhase: this.automaticPhase,
            automaticRemainingDelay: this.automaticRemainingDelay,
            animationDamage: new Map(),
        };
        restoreAresAttachEffectExtensionState(restored, state);
        // Reconcile against the incoming instance list FIRST so the damage
        // queue is sized to the restored effects, then overlay the snapshot's
        // partial accumulators. Reconciling after the overlay would rebuild
        // the queues from an empty previous list and silently zero them.
        this.animationDamageState.clear();
        this.reconcileAnimationDamageState([], restored.instances);
        for (const [effectId, states] of restored.animationDamage) {
            const existing = this.animationDamageState.get(effectId);
            if (!existing) continue;
            states.forEach((state, occurrence) => {
                if (!state || !existing[occurrence]) return;
                existing[occurrence].accumulator = state.accumulator;
                existing[occurrence].frameAccumulator = state.frameAccumulator;
            });
        }
        this.instances = restored.instances.map(instance => ({ ...instance }));
        this.automaticPhase = restored.automaticPhase;
        this.automaticRemainingDelay = restored.automaticRemainingDelay;
        this.presentationRevision++;
        this.animationRevision++;
        this.pruneDefinitions();
        this.syncDynamicCloak();
    }

    apply(
        effectId: AresAttachEffectId,
        definition: AresAttachEffectDefinition,
        options: {
            protectedByIronCurtainOrForceShield?: boolean;
            context?: any;
            sourcePlayer?: any;
        } = {},
    ): AresAttachEffectApplyResult {
        const previousInstances = this.instances;
        const previousDefinition = this.definitions.get(effectId);
        const result = applyAresAttachEffect(definition, effectId, this.instances, options);
        this.instances = result.instances.map(instance => ({ ...instance }));
        this.reconcileAnimationDamageState(
            previousInstances,
            this.instances,
            effectId,
            result.decision,
            options.sourcePlayer,
        );

        if (["applied", "reapplied", "stacked"].includes(result.decision)) {
            this.definitions.set(effectId, definition);
            if (effectId === this.automaticEffect?.effectId) {
                this.automaticPhase = "active";
                this.automaticRemainingDelay = 0;
            }
            const effectWasAdded = result.decision === "applied" || result.decision === "stacked";
            const animationDefinitionChanged = previousDefinition?.animation !== definition.animation ||
                previousDefinition?.temporalHidesAnim !== definition.temporalHidesAnim;
            // A non-cumulative reapply keeps the current animation running
            // unless AnimResetOnReapply explicitly asks for a restart.  New
            // stacks, expiry/removal, and authored animation changes still
            // rebuild the attached presentation.
            if (effectWasAdded || animationDefinitionChanged) {
                this.presentationRevision++;
            }
            if (result.resetAnimation) {
                this.animationRevision++;
            }
        }
        else if (effectId === this.automaticEffect?.effectId && result.decision === "ignored-zero-duration") {
            this.automaticPhase = "disabled";
            this.automaticRemainingDelay = 0;
        }
        this.pruneDefinitions();
        this.syncDynamicCloak(options.context);
        return this.copyApplyResult(result);
    }

    advance(options: {
        includeState?: boolean;
        context?: any;
    } = {}): AresAttachEffectTraitAdvanceResult {
        const previousInstances = this.instances.map(instance => ({ ...instance }));
        this.applyAnimationDamage(options.context);
        const expiredEffectIds = advanceAresAttachEffectsInPlace(this.instances);
        this.reconcileAnimationDamageState(previousInstances, this.instances);
        if (expiredEffectIds.length) this.presentationRevision++;
        let automaticApply: AresAttachEffectApplyResult | undefined;

        if (this.automaticEffect &&
            this.automaticPhase === "active" &&
            !this.hasAutomaticInstance()) {
            const delay = safeDelay(this.automaticEffect.definition.delay);
            if (delay < 0) {
                this.automaticPhase = "disabled";
                this.automaticRemainingDelay = 0;
            }
            else {
                this.automaticPhase = "waiting-renewal";
                // The shared scheduler below processes the renewal timer
                // during this same update, matching the reference ordering.
                this.automaticRemainingDelay = delay;
            }
        }

        automaticApply = this.processAutomaticDelay(options);
        if (expiredEffectIds.length || automaticApply !== undefined) {
            this.pruneDefinitions();
        }
        this.syncDynamicCloak(options.context);
        return {
            instances: options.includeState === false ? this.instances : this.getState(),
            expiredEffectIds: [...expiredEffectIds],
            automaticApply,
        };
    }

    /** Tick entry point used by the game loop; no external state snapshot is needed. */
    advanceTick(context?: any): void {
        this.advance({ includeState: false, context });
    }

    discardOnEntry(context?: any): AresAttachEffectRemovalResult {
        const previousInstances = this.instances;
        const result = discardAresAttachEffectsOnEntry(this.instances);
        this.instances = result.instances.map(instance => ({ ...instance }));
        this.reconcileAnimationDamageState(previousInstances, this.instances);
        if (result.removedEffectIds.length) this.presentationRevision++;
        if (this.automaticEffect &&
            result.removedEffectIds.includes(this.automaticEffect.effectId)) {
            this.automaticPhase = "disabled";
            this.automaticRemainingDelay = 0;
        }
        this.pruneDefinitions();
        this.syncDynamicCloak(context);
        return {
            instances: this.getState(),
            removedEffectIds: [...result.removedEffectIds],
        };
    }

    /** Current automatic TechnoType-effect schedule for deterministic callers. */
    getAutomaticSchedule(): AresAttachEffectAutomaticSchedule {
        return {
            phase: this.automaticPhase,
            remainingDelay: this.automaticRemainingDelay,
        };
    }

    /** Active animation definitions consumed by the shared render plugin. */
    getPresentationEffects(): readonly AresAttachEffectPresentation[] {
        return this.instances.flatMap((instance) => {
            const definition = this.definitions.get(instance.effectId);
            if (!definition || !definition.animation) return [];
            return [{
                effectId: instance.effectId,
                animation: definition.animation,
                temporalHidesAnim: definition.temporalHidesAnim,
            }];
        });
    }

    /** Changes whenever an effect is applied, refreshed, stacked, or removed. */
    getPresentationRevision(): number {
        return this.presentationRevision;
    }

    /** Changes only when Ares explicitly requests an animation reset. */
    getPresentationAnimationRevision(): number {
        return this.animationRevision;
    }

    /**
     * Start the automatic TechnoType-owned effect lifecycle. A negative
     * InitialDelay follows the Antares branch that never reaches attachment;
     * positive values count down, and zero applies immediately.
     */
    spawn(
        options: {
            protectedByIronCurtainOrForceShield?: boolean;
            context?: any;
            sourcePlayer?: any;
        } = {},
    ): AresAttachEffectApplyResult | undefined {
        if (!this.automaticEffect || this.hasAutomaticInstance()) {
            if (this.automaticEffect && this.hasAutomaticInstance()) this.automaticPhase = "active";
            return undefined;
        }

        // onSpawn also fires when a limboed object re-enters the map. The
        // pending InitialDelay/Delay and a disabled lifecycle must survive
        // that transport/re-entry boundary instead of restarting.
        if (this.automaticPhase === "disabled" ||
            this.automaticPhase === "waiting-initial" ||
            this.automaticPhase === "waiting-renewal") {
            return undefined;
        }

        const initialDelay = safeDelay(this.automaticEffect.definition.initialDelay);
        if (initialDelay < 0) {
            this.automaticPhase = "disabled";
            this.automaticRemainingDelay = 0;
            return undefined;
        }
        if (initialDelay > 0) {
            this.automaticPhase = "waiting-initial";
            this.automaticRemainingDelay = initialDelay;
            return undefined;
        }

        this.automaticPhase = "waiting-initial";
        this.automaticRemainingDelay = 0;
        return this.processAutomaticDelay(options);
    }

    /**
     * Ares multiplies each active effect's four numeric modifiers in authored
     * state order. Missing or non-finite definition values use neutral 1.0.
     */
    getAggregateMultipliers(): AresAttachEffectMultipliers {
        return this.instances.reduce<AresAttachEffectMultipliers>((aggregate, instance) => {
            const definition = this.definitions.get(instance.effectId);
            if (!definition) return aggregate;
            aggregate.speed *= finiteOrOne(definition.speedMultiplier);
            aggregate.armor *= finiteOrOne(definition.armorMultiplier);
            aggregate.firepower *= finiteOrOne(definition.firepowerMultiplier);
            aggregate.rof *= finiteOrOne(definition.rofMultiplier);
            return aggregate;
        }, {
            speed: 1,
            armor: 1,
            firepower: 1,
            rof: 1,
        });
    }

    [NotifySpawn.onSpawn](_gameObject?: any, context?: any): AresAttachEffectApplyResult | undefined {
        return this.spawn({ context });
    }

    [NotifyTick.onTick](_gameObject?: any, context?: any): void {
        this.advanceTick(context);
    }

    [NotifyUnspawn.onUnspawn](gameObject: { limboData?: unknown }, context?: any): void {
        // Game.limboObject sets limboData before dispatching onUnspawn. A
        // regular removal has no limboData and must not trigger
        // DiscardOnEntry.
        if (gameObject?.limboData !== undefined) {
            this.discardOnEntry(context);
        }
    }

    private processAutomaticDelay(
        options: {
            protectedByIronCurtainOrForceShield?: boolean;
            context?: any;
        } = {},
    ): AresAttachEffectApplyResult | undefined {
        if (!this.automaticEffect ||
            !["waiting-initial", "waiting-renewal"].includes(this.automaticPhase)) {
            return undefined;
        }
        if (this.automaticRemainingDelay > 0) {
            this.automaticRemainingDelay--;
            return undefined;
        }

        const result = this.apply(
            this.automaticEffect.effectId,
            this.automaticEffect.definition,
            options,
        );
        if (result.decision === "blocked-by-protection") {
            // Ares retries a blocked TechnoType effect on a later update.
            this.automaticRemainingDelay = 0;
        }
        return result;
    }

    private hasAutomaticInstance(): boolean {
        return this.automaticEffect !== undefined &&
            this.instances.some(instance => instance.effectId === this.automaticEffect!.effectId);
    }

    private pruneDefinitions(): void {
        const activeIds = new Set(this.instances.map(instance => instance.effectId));
        for (const effectId of this.definitions.keys()) {
            if (!activeIds.has(effectId)) this.definitions.delete(effectId);
        }
        for (const effectId of this.animationDamageState.keys()) {
            if (!activeIds.has(effectId)) this.animationDamageState.delete(effectId);
        }
    }

    private applyAnimationDamage(context?: any): void {
        const applyDamage = context?.applyAresAnimationDamage;
        const getAnimation = context?.art?.getAnimation;
        if (!this.gameObject || typeof applyDamage !== "function" || typeof getAnimation !== "function") {
            return;
        }
        if (this.gameObject.isDestroyed || this.gameObject.isCrashing) return;

        const hiddenByCloak = this.gameObject.cloakableTrait?.isCloaked?.() === true;
        const occurrenceById = new Map<AresAttachEffectId, number>();
        for (const instance of this.instances) {
            const occurrence = occurrenceById.get(instance.effectId) ?? 0;
            occurrenceById.set(instance.effectId, occurrence + 1);

            const definition = this.definitions.get(instance.effectId);
            if (!definition?.animation) continue;

            const states = this.animationDamageState.get(instance.effectId) ?? [];
            const state = states[occurrence] ?? { accumulator: 0, frameAccumulator: 0 };
            states[occurrence] = state;
            this.animationDamageState.set(instance.effectId, states);
            const animation = (() => {
                try {
                    return getAnimation.call(context.art, definition.animation);
                }
                catch {
                    return undefined;
                }
            })();
            const animationDamage = parseAresAnimationDamage(
                definition.animation,
                animation?.art,
            );
            if (!animationDamage || animationDamage.damage <= 0) continue;

            const hiddenByTemporal = definition.temporalHidesAnim &&
                this.gameObject.warpedOutTrait?.isActive?.() === true;
            if (hiddenByCloak || hiddenByTemporal) {
                // Cloaking/temporal removal recreates the attached animation,
                // so its animation accumulator starts from zero on re-entry.
                state.accumulator = 0;
                state.frameAccumulator = 0;
                continue;
            }

            state.frameAccumulator += animationDamage.rate / GameSpeed.BASE_TICKS_PER_SECOND;
            const framesToAdvance = Math.floor(state.frameAccumulator);
            state.frameAccumulator -= framesToAdvance;
            for (let frame = 0; frame < framesToAdvance; frame++) {
                const step = advanceAresAnimationDamage(animationDamage, state);
                state.accumulator = step.state.accumulator;
                if (step.damage > 0) {
                    applyDamage.call(context, {
                        target: this.gameObject,
                        animation: animationDamage,
                        damage: step.damage,
                        sourcePlayer: state.sourcePlayer,
                    });
                }
            }
        }
    }

    private reconcileAnimationDamageState(
        previousInstances: readonly AresAttachEffectInstance[],
        nextInstances: readonly AresAttachEffectInstance[],
        newEffectId?: AresAttachEffectId,
        decision?: AresAttachEffectApplyResult["decision"],
        newSourcePlayer?: any,
    ): void {
        const queues = new Map<AresAttachEffectId, AresAnimationDamageRuntimeState[]>();
        const previousOccurrences = new Map<AresAttachEffectId, number>();
        for (const instance of previousInstances) {
            const occurrence = previousOccurrences.get(instance.effectId) ?? 0;
            previousOccurrences.set(instance.effectId, occurrence + 1);
            const state = this.animationDamageState.get(instance.effectId)?.[occurrence];
            const queue = queues.get(instance.effectId) ?? [];
            queue.push(state ?? { accumulator: 0, frameAccumulator: 0 });
            queues.set(instance.effectId, queue);
        }

        const nextState = new Map<AresAttachEffectId, AresAnimationDamageRuntimeState[]>();
        const nextOccurrences = new Map<AresAttachEffectId, number>();
        for (const instance of nextInstances) {
            const occurrence = nextOccurrences.get(instance.effectId) ?? 0;
            nextOccurrences.set(instance.effectId, occurrence + 1);
            const queue = queues.get(instance.effectId) ?? [];
            const state = queue.shift() ?? {
                accumulator: 0,
                frameAccumulator: 0,
                sourcePlayer: instance.effectId === newEffectId &&
                    (decision === "applied" || decision === "stacked")
                    ? newSourcePlayer
                    : undefined,
            };
            const states = nextState.get(instance.effectId) ?? [];
            states.push(state);
            nextState.set(instance.effectId, states);
        }
        this.animationDamageState = nextState;
    }

    private syncDynamicCloak(context?: any): void {
        const hasCloakSource = this.instances.some((instance) =>
            this.definitions.get(instance.effectId)?.cloakable === true);
        this.gameObject?.cloakableTrait?.setAresAttachEffectSource?.(hasCloakSource, context);
    }

    private copyApplyResult(result: AresAttachEffectApplyResult): AresAttachEffectApplyResult {
        return {
            decision: result.decision,
            instances: this.getState(),
            forceDecloak: result.forceDecloak,
            resetAnimation: result.resetAnimation,
        };
    }
}

function finiteOrOne(value: number | undefined): number {
    return value !== undefined && Number.isFinite(value) ? value : 1;
}

function safeDelay(value: number | undefined): number {
    return value !== undefined && Number.isSafeInteger(value) ? value : 0;
}
