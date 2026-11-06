import { ObjectType } from "@/engine/type/ObjectType";
import { SoundKey } from "@/engine/sound/SoundKey";
export class TntFxPlugin {
    private gameObject: any;
    private tntChargeTrait: any;
    private frameDurationTicks: number;
    private renderable: any;
    private imageFinder: any;
    private art: any;
    private alliances: any;
    private viewer: any;
    private worldSound: any;
    private animFactory: any;
    private bombImageName = "BOMBCURS";
    private lastHasCharge: boolean = false;
    private animStepCount?: number;
    private bombAnim?: any;
    private lastStartFrame?: number;
    private soundHandle?: any;
    constructor(gameObject: any, tntChargeTrait: any, frameDurationTicks: number, renderable: any, imageFinder: any, art: any, alliances: any, viewer: any, worldSound: any, animFactory: any) {
        this.gameObject = gameObject;
        this.tntChargeTrait = tntChargeTrait;
        this.frameDurationTicks = frameDurationTicks;
        this.renderable = renderable;
        this.imageFinder = imageFinder;
        this.art = art;
        this.alliances = alliances;
        this.viewer = viewer;
        this.worldSound = worldSound;
        this.animFactory = animFactory;
    }
    onCreate(): void {
        this.refreshBombArt();
    }
    update(_time: number): void {
        if (this.gameObject.isDestroyed || this.gameObject.isCrashing) {
            if (this.gameObject.rules.leaveRubble) {
                this.disposeBombAnim();
                this.soundHandle?.stop();
            }
            return;
        }
        const hasCharge = this.tntChargeTrait.hasCharge();
        const imageChanged = hasCharge ? this.refreshBombArt() : false;
        const chargeChanged = hasCharge !== this.lastHasCharge || imageChanged;
        const startFrame = hasCharge
            ? this.tntChargeTrait.getBombFrame?.(this.animStepCount ?? 1, this.frameDurationTicks) ?? 0
            : 0;
        const frameChanged = startFrame !== this.lastStartFrame;
        if (chargeChanged) {
            this.lastHasCharge = hasCharge;
            this.lastStartFrame = startFrame;
            this.disposeBombAnim();
            if (hasCharge) {
                this.soundHandle?.stop();
                this.soundHandle = this.worldSound?.playEffect(
                    this.tntChargeTrait.getTickingSound?.() ?? SoundKey.BombTickingSound,
                    this.gameObject,
                    this.gameObject.owner,
                );
                const chargeOwner = this.tntChargeTrait.getChargeOwner?.();
                if (!this.viewer.value || this.alliances.haveSharedIntel(chargeOwner, this.viewer.value)) {
                    const anim = this.animFactory(this.bombImageName);
                    this.bombAnim = anim;
                    anim.setRenderOrder(999995);
                    anim.create3DObject();
                    anim.setFrame?.(startFrame);
                    this.renderable.get3DObject()?.add(anim.get3DObject());
                }
            }
            else {
                this.soundHandle?.stop();
            }
        }
        else if (hasCharge && frameChanged) {
            this.lastStartFrame = startFrame;
            this.bombAnim?.setFrame?.(startFrame);
        }
    }
    private disposeBombAnim(): void {
        if (this.bombAnim?.get3DObject()) {
            this.renderable.get3DObject()?.remove(this.bombAnim.get3DObject());
        }
        this.bombAnim?.dispose();
        this.bombAnim = undefined;
    }
    onRemove(): void {
        this.disposeBombAnim();
        this.soundHandle?.stop();
    }
    dispose(): void {
        this.disposeBombAnim();
        this.soundHandle?.stop();
    }
    private refreshBombArt(): boolean {
        const requestedImage = this.tntChargeTrait.getBombImageName?.() || "BOMBCURS";
        const hasRequestedImage = requestedImage === "BOMBCURS" ||
            this.art.hasObject?.(requestedImage, ObjectType.Animation);
        const imageName = hasRequestedImage ? requestedImage : "BOMBCURS";
        if (this.bombImageName === imageName && this.animStepCount !== undefined) {
            return false;
        }
        this.bombImageName = imageName;
        const image = this.imageFinder.findByObjectArt(this.art.getObject(imageName, ObjectType.Animation));
        this.animStepCount = Math.max(1, Math.trunc(Number(image.numImages) || 0));
        return true;
    }
}
