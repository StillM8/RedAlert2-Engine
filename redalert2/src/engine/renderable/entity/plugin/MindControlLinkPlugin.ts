import { MindControlLinkFx } from "@/engine/renderable/fx/MindControlLinkFx";
import * as THREE from "three";
export class MindControlLinkPlugin {
    private source: any;
    private selectionModel: any;
    private alliances: any;
    private viewer: any;
    private links: Map<any, MindControlLinkFx>;
    private renderableManager?: any;
    constructor(source: any, selectionModel: any, alliances: any, viewer: any) {
        this.source = source;
        this.selectionModel = selectionModel;
        this.alliances = alliances;
        this.viewer = viewer;
        this.links = new Map();
    }
    onCreate(renderableManager: any): void {
        this.renderableManager = renderableManager;
    }
    update(): void {
        const parasiteWeapon = [this.source.primaryWeapon, this.source.secondaryWeapon]
            .some(weapon => weapon?.warhead?.rules?.parasite === true);
        if (parasiteWeapon) {
            this.disposeLinks();
            return;
        }
        if (!this.source.isDestroyed &&
            !this.source.isCrashing &&
            this.source.mindControllerTrait) {
            if (!this.selectionModel.isSelected() ||
                (this.viewer.value &&
                    !this.alliances.haveSharedIntel(this.source.owner, this.viewer.value))) {
                this.disposeLinks();
            }
            else {
                const targets = this.source.mindControllerTrait.getTargets();
                for (const [target, link] of this.links.entries()) {
                    if (!targets.includes(target)) {
                        link.removeAndDispose();
                        this.links.delete(target);
                    }
                }
                const color = new THREE.Color(this.source.owner.color.asHex());
                const sourcePos = this.source.position.worldPosition.clone();
                for (const target of targets) {
                    const targetPos = target.position.worldPosition.clone();
                    let link = this.links.get(target);
                    if (!link) {
                        link = new MindControlLinkFx(sourcePos, targetPos, color, 2);
                        this.links.set(target, link);
                        this.renderableManager?.addEffect(link);
                    }
                    link.updateEndpoints(sourcePos, targetPos);
                }
            }
        }
    }
    onRemove(): void {
        this.renderableManager = undefined;
        this.disposeLinks();
    }
    dispose(): void {
        this.disposeLinks();
    }
    private disposeLinks(): void {
        this.links.forEach((link) => link.removeAndDispose());
        this.links.clear();
    }
}

export class DominatorControlAnimationPlugin {
    private readonly gameObject: any;
    private readonly renderable: any;
    private renderableManager?: any;
    private animation?: any;
    private animationName?: string;

    constructor(gameObject: any, renderable: any) {
        this.gameObject = gameObject;
        this.renderable = renderable;
    }

    onCreate(renderableManager: any): void {
        this.renderableManager = renderableManager;
    }

    update(time?: number): void {
        const permanent = this.gameObject.mindControllableTrait?.isPermanent?.() === true;
        const name = permanent ? animationName(this.gameObject.dominatorControlAnimation) : undefined;
        if (name !== this.animationName) {
            this.animationName = name;
            this.disposeAnimation();
        }
        if (name && !this.animation) this.createAnimation(name);
        if (Number.isFinite(time)) this.animation?.update?.(time);
    }

    onRemove(): void {
        this.disposeAnimation();
        this.renderableManager = undefined;
    }

    dispose(): void {
        this.disposeAnimation();
    }

    private createAnimation(name: string): void {
        const parent = this.renderable?.get3DObject?.();
        if (!parent || !this.renderableManager) return;
        const animation = this.renderableManager.createAnim(name, undefined, true);
        animation.create3DObject();
        const props = animation.getAnimProps?.();
        const object = animation.get3DObject?.();
        if (!props || !object) {
            animation.dispose?.();
            return;
        }
        props.loopCount = -1;
        parent.add(object);
        this.animation = animation;
    }

    private disposeAnimation(): void {
        const parent = this.renderable?.get3DObject?.();
        const object = this.animation?.get3DObject?.();
        if (object && parent) parent.remove(object);
        this.animation?.dispose?.();
        this.animation = undefined;
    }
}

function animationName(value: any): string | undefined {
    const name = typeof value === "string" ? value.trim() : "";
    return name && !/^(?:none|null)$/i.test(name) ? name : undefined;
}
