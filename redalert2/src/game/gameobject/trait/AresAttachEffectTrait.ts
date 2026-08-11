import type { AresAttachEffectDefinition } from "@/extensions/ares/AresAttachEffect";
import {
    advanceAresAttachEffects,
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

export interface AresAttachEffectMultipliers {
    speed: number;
    armor: number;
    firepower: number;
    rof: number;
}

export interface AresAttachEffectTraitOptions {
    definitions?: ReadonlyMap<AresAttachEffectId, AresAttachEffectDefinition>;
    instances?: readonly AresAttachEffectInstance[];
    /** Optional TechnoType-owned effect that is scheduled from spawn onward. */
    automaticEffect?: AresAttachEffectBinding;
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

/**
 * Generic gameplay bridge for Ares AttachEffect state.
 *
 * The trait owns only effect instances and their aggregate numeric modifiers.
 * It deliberately does not mutate movement, armor, weapon, cloak, animation,
 * save, or network services. A later ObjectFactory/runtime integration can
 * register this trait and consume its state and decisions at the appropriate
 * shared hooks.
 */
export class AresAttachEffectTrait implements NotifySpawn, NotifyTick, NotifyUnspawn {
    private instances: AresAttachEffectInstance[];
    private definitions: Map<AresAttachEffectId, AresAttachEffectDefinition>;
    private automaticEffect?: AresAttachEffectBinding;
    private automaticPhase: AresAttachEffectAutomaticPhase = "inactive";
    private automaticRemainingDelay = 0;

    constructor(options: AresAttachEffectTraitOptions = {}) {
        this.instances = (options.instances ?? []).map(instance => ({ ...instance }));
        this.definitions = new Map(options.definitions ?? []);
        this.automaticEffect = options.automaticEffect;
        if (this.automaticEffect) {
            this.definitions.set(this.automaticEffect.effectId, this.automaticEffect.definition);
            this.automaticPhase = this.hasAutomaticInstance() ? "active" : "inactive";
        }
    }

    getState(): readonly AresAttachEffectInstance[] {
        return this.instances.map(instance => ({ ...instance }));
    }

    apply(
        effectId: AresAttachEffectId,
        definition: AresAttachEffectDefinition,
        options: { protectedByIronCurtainOrForceShield?: boolean } = {},
    ): AresAttachEffectApplyResult {
        const result = applyAresAttachEffect(definition, effectId, this.instances, options);
        this.instances = result.instances.map(instance => ({ ...instance }));

        if (["applied", "reapplied", "stacked"].includes(result.decision)) {
            this.definitions.set(effectId, definition);
            if (effectId === this.automaticEffect?.effectId) {
                this.automaticPhase = "active";
                this.automaticRemainingDelay = 0;
            }
        }
        else if (effectId === this.automaticEffect?.effectId && result.decision === "ignored-zero-duration") {
            this.automaticPhase = "disabled";
            this.automaticRemainingDelay = 0;
        }
        this.pruneDefinitions();
        return this.copyApplyResult(result);
    }

    advance(): AresAttachEffectTraitAdvanceResult {
        const result = advanceAresAttachEffects(this.instances);
        this.instances = result.instances.map(instance => ({ ...instance }));
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

        automaticApply = this.processAutomaticDelay();
        this.pruneDefinitions();
        return {
            instances: this.getState(),
            expiredEffectIds: [...result.expiredEffectIds],
            automaticApply,
        };
    }

    discardOnEntry(): AresAttachEffectRemovalResult {
        const result = discardAresAttachEffectsOnEntry(this.instances);
        this.instances = result.instances.map(instance => ({ ...instance }));
        if (this.automaticEffect &&
            result.removedEffectIds.includes(this.automaticEffect.effectId)) {
            this.automaticPhase = "disabled";
            this.automaticRemainingDelay = 0;
        }
        this.pruneDefinitions();
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

    /**
     * Start the automatic TechnoType-owned effect lifecycle. A negative
     * InitialDelay follows the Antares branch that never reaches attachment;
     * positive values count down, and zero applies immediately.
     */
    spawn(
        options: { protectedByIronCurtainOrForceShield?: boolean } = {},
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

    [NotifySpawn.onSpawn](): AresAttachEffectApplyResult | undefined {
        return this.spawn();
    }

    [NotifyTick.onTick](): void {
        this.advance();
    }

    [NotifyUnspawn.onUnspawn](gameObject: { limboData?: unknown }): void {
        // Game.limboObject sets limboData before dispatching onUnspawn. A
        // regular removal has no limboData and must not trigger
        // DiscardOnEntry.
        if (gameObject?.limboData !== undefined) {
            this.discardOnEntry();
        }
    }

    private processAutomaticDelay(
        options: { protectedByIronCurtainOrForceShield?: boolean } = {},
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
