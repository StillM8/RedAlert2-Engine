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
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";

export interface AresAttachEffectMultipliers {
    speed: number;
    armor: number;
    firepower: number;
    rof: number;
}

export interface AresAttachEffectTraitOptions {
    definitions?: ReadonlyMap<AresAttachEffectId, AresAttachEffectDefinition>;
    instances?: readonly AresAttachEffectInstance[];
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
export class AresAttachEffectTrait implements NotifyTick {
    private instances: AresAttachEffectInstance[];
    private definitions: Map<AresAttachEffectId, AresAttachEffectDefinition>;

    constructor(options: AresAttachEffectTraitOptions = {}) {
        this.instances = (options.instances ?? []).map(instance => ({ ...instance }));
        this.definitions = new Map(options.definitions ?? []);
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
        }
        this.pruneDefinitions();
        return this.copyApplyResult(result);
    }

    advance(): AresAttachEffectAdvanceResult {
        const result = advanceAresAttachEffects(this.instances);
        this.instances = result.instances.map(instance => ({ ...instance }));
        this.pruneDefinitions();
        return {
            instances: this.getState(),
            expiredEffectIds: [...result.expiredEffectIds],
        };
    }

    discardOnEntry(): AresAttachEffectRemovalResult {
        const result = discardAresAttachEffectsOnEntry(this.instances);
        this.instances = result.instances.map(instance => ({ ...instance }));
        this.pruneDefinitions();
        return {
            instances: this.getState(),
            removedEffectIds: [...result.removedEffectIds],
        };
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

    [NotifyTick.onTick](): void {
        this.advance();
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
