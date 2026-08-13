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
    private lastHidden?: boolean;

    constructor(gameObject: any, renderable: any) {
        this.gameObject = gameObject;
        this.renderable = renderable;
    }

    onCreate(renderableManager: any): void {
        this.renderableManager = renderableManager;
    }

    update(): void {
        const trait = this.gameObject.aresAttachEffectTrait;
        if (!trait || this.gameObject.isDestroyed || this.gameObject.isCrashing) {
            this.disposeAnimations();
            return;
        }

        const effects: readonly AresAttachEffectPresentation[] = trait.getPresentationEffects?.() ?? [];
        const hiddenByCloak = this.gameObject.cloakableTrait?.isCloaked?.() === true;
        const hiddenByTemporal = effects.some((effect) =>
            effect.temporalHidesAnim && this.gameObject.warpedOutTrait?.isActive?.() === true);
        const hidden = hiddenByCloak || hiddenByTemporal;
        const revision = trait.getPresentationRevision?.() ?? 0;
        if (revision === this.lastRevision && hidden === this.lastHidden) return;

        this.lastRevision = revision;
        this.lastHidden = hidden;
        this.disposeAnimations();
        if (hidden || !effects.length || !this.renderableManager) return;

        const parent = this.renderable.get3DObject?.();
        if (!parent) return;
        effects.forEach((effect) => {
            if (!effect.animation) return;
            const animation = this.renderableManager.createAnim(effect.animation, undefined, true);
            animation.create3DObject();
            animation.getAnimProps().loopCount = -1;
            parent.add(animation.get3DObject());
            this.attachedAnimations.push({ animation });
        });
    }

    onRemove(): void {
        this.disposeAnimations();
        this.renderableManager = undefined;
    }

    dispose(): void {
        this.disposeAnimations();
    }

    private disposeAnimations(): void {
        const parent = this.renderable?.get3DObject?.();
        for (const attached of this.attachedAnimations) {
            const object = attached.animation.get3DObject?.();
            if (object && parent) parent.remove(object);
            attached.animation.dispose?.();
        }
        this.attachedAnimations = [];
    }
}
