import type { AresAttachEffectPresentation } from "@/game/gameobject/trait/AresAttachEffectTrait";

interface AttachedAnimation {
    animation: any;
}

/**
 * Renders Ares AttachEffect animations as children of the affected techno.
 * This keeps them attached while the object moves and removes/recreates them
 * for cloak and temporal visibility transitions as required by Ares.
 */
export class AresAttachEffectPlugin {
    private gameObject: any;
    private renderable: any;
    private renderableManager?: any;
    private attachedAnimations: AttachedAnimation[] = [];
    private lastRevision?: number;
    private lastAnimationRevision?: number;
    private lastHidden?: boolean;

    constructor(gameObject: any, renderable: any) {
        this.gameObject = gameObject;
        this.renderable = renderable;
    }

    onCreate(renderableManager: any): void {
        this.renderableManager = renderableManager;
    }

    update(time?: number): void {
        const trait = this.gameObject.aresAttachEffectTrait;
        if (!trait) {
            // Warhead-owned effects install the trait lazily.  The plugin is
            // registered up front so an effect can become visible later, but
            // ordinary technos must keep the vanilla idle path allocation-free.
            if (this.attachedAnimations.length) this.disposeAnimations();
            return;
        }
        if (this.gameObject.isDestroyed || this.gameObject.isCrashing) {
            if (this.attachedAnimations.length) this.disposeAnimations();
            return;
        }

        const effects: readonly AresAttachEffectPresentation[] = trait.getPresentationEffects?.() ?? [];
        const hiddenByCloak = this.gameObject.cloakableTrait?.isCloaked?.() === true;
        const hiddenByTemporal = effects.some((effect) =>
            effect.temporalHidesAnim && this.gameObject.warpedOutTrait?.isActive?.() === true);
        const hidden = hiddenByCloak || hiddenByTemporal;
        const revision = trait.getPresentationRevision?.() ?? 0;
        const animationRevision = trait.getPresentationAnimationRevision?.() ?? revision;
        const presentationChanged = revision !== this.lastRevision ||
            animationRevision !== this.lastAnimationRevision ||
            hidden !== this.lastHidden;

        if (presentationChanged) {
            this.lastRevision = revision;
            this.lastAnimationRevision = animationRevision;
            this.lastHidden = hidden;
            this.disposeAnimations();
            if (!hidden && effects.length && this.renderableManager) {
                this.createAnimations(effects);
            }
        }

        if (Number.isFinite(time)) {
            this.attachedAnimations.forEach(({ animation }) => animation.update?.(time));
        }
    }

    onRemove(): void {
        this.disposeAnimations();
        this.renderableManager = undefined;
    }

    dispose(): void {
        this.disposeAnimations();
    }

    private disposeAnimations(): void {
        if (!this.attachedAnimations.length) return;
        const parent = this.renderable?.get3DObject?.();
        for (const attached of this.attachedAnimations) {
            const object = attached.animation.get3DObject?.();
            if (object && parent) parent.remove(object);
            attached.animation.dispose?.();
        }
        this.attachedAnimations = [];
    }

    private createAnimations(effects: readonly AresAttachEffectPresentation[]): void {
        const parent = this.renderable.get3DObject?.();
        if (!parent || !this.renderableManager) return;
        effects.forEach((effect) => {
            if (!effect.animation) return;
            const animation = this.renderableManager!.createAnim(effect.animation, undefined, true);
            animation.create3DObject();
            const props = animation.getAnimProps?.();
            const object = animation.get3DObject?.();
            if (!props || !object) {
                animation.dispose?.();
                return;
            }
            props.loopCount = -1;
            parent.add(object);
            this.attachedAnimations.push({ animation });
        });
    }
}
