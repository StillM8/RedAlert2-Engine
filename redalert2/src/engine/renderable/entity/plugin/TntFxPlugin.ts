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
    update(time: number): void {
        if (this.gameObject.isDestroyed || this.gameObject.isCrashing) {
            if (this.gameObject.rules.leaveRubble) {
                this.disposeBombAnim();
                this.soundHandle?.stop();
            }
            return;
        }
        const hasCharge = this.tntChargeTrait.hasCharge();
        if (hasCharge) {
            this.refreshBombArt();
        }
        const chargeChanged = hasCharge !== this.lastHasCharge;
        let startFrame: number;
        if (hasCharge) {
            const progress = 1 - this.tntChargeTrait.getTicksLeft() / this.tntChargeTrait.getInitialTicks();
            startFrame = Math.floor(2 * progress * (this.animStepCount! - 1));
        }
        else {
            startFrame = 0;
        }
        const frameChanged = startFrame !== this.lastStartFrame;
        this.bombAnim?.update(time);
        if (chargeChanged || frameChanged) {
            this.lastHasCharge = hasCharge;
            this.lastStartFrame = startFrame;
            if (hasCharge) {
                if (chargeChanged) {
                    this.soundHandle?.stop();
                    this.soundHandle = this.worldSound?.playEffect(
                        this.tntChargeTrait.getTickingSound?.() ?? SoundKey.BombTickingSound,
                        this.gameObject,
                        this.gameObject.owner,
                    );
                }
                this.disposeBombAnim();
                const chargeOwner = this.gameObject.tntChargeTrait.getChargeOwner();
                if (!this.viewer.value || this.alliances.haveSharedIntel(chargeOwner, this.viewer.value)) {
                    const anim = this.bombAnim = this.animFactory(this.bombImageName);
                    anim.setRenderOrder(999995);
                    anim.create3DObject();
                    const props = anim.getAnimProps();
                    props.loopCount = -1;
                    props.start = props.loopStart = startFrame;
                    props.end = startFrame + 2 - 1;
                    props.loopEnd = props.end;
                    const flickerRate = Math.max(1, this.tntChargeTrait.getFlickerRate?.(this.frameDurationTicks) ?? this.frameDurationTicks);
                    props.rate /= flickerRate;
                    this.renderable.get3DObject()?.add(anim.get3DObject());
                }
            }
            else {
                this.disposeBombAnim();
                this.soundHandle?.stop();
            }
        }
    }
    private disposeBombAnim(): void {
        if (this.bombAnim?.get3DObject()) {
            this.renderable.get3DObject()?.remove(this.bombAnim.get3DObject());
        }
        this.bombAnim?.dispose();
    }
    onRemove(): void {
        this.disposeBombAnim();
        this.soundHandle?.stop();
    }
    dispose(): void {
        this.disposeBombAnim();
        this.soundHandle?.stop();
    }
    private refreshBombArt(): void {
        const requestedImage = this.tntChargeTrait.getBombImageName?.() || "BOMBCURS";
        const hasRequestedImage = requestedImage === "BOMBCURS" ||
            this.art.hasObject?.(requestedImage, ObjectType.Animation);
        const imageName = hasRequestedImage ? requestedImage : "BOMBCURS";
        if (this.bombImageName === imageName && this.animStepCount !== undefined) {
            return;
        }
        this.bombImageName = imageName;
        const image = this.imageFinder.findByObjectArt(this.art.getObject(imageName, ObjectType.Animation));
        this.animStepCount = Math.max(1, Math.floor(image.numImages / 2));
    }
}
