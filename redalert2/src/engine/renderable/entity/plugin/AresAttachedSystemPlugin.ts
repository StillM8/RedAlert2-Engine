import { DamageSmokeFx } from "@/engine/renderable/fx/DamageSmokeFx";
import { ObjectType } from "@/engine/type/ObjectType";
import type { AresParticleSystemRules } from "@/extensions/ares/AresParticleSystems";

interface Art {
    getAnimation(name: string): any;
    hasObject?(name: string, type: ObjectType): boolean;
}

interface Theater {
    getPalette(paletteType: string, customPaletteName?: string): any;
}

interface ImageFinder {
    findByObjectArt(art: any): any;
}

interface GameSpeed {
    value: number;
}

/**
 * Implements Ares [Projectile]AttachedSystem for its documented smoke-only
 * particle systems. The existing particle renderer already handles authored
 * ParticleSystem -> Particle -> Image definitions and updates an emitter's
 * position every frame, so projectiles can share that generic path without a
 * Mental Omega-specific renderer branch.
 */
export class AresAttachedSystemPlugin {
    private readonly gameObject: any;
    private readonly art: Art;
    private readonly theater: Theater;
    private readonly imageFinder: ImageFinder;
    private readonly gameSpeed: GameSpeed;
    private readonly system?: AresParticleSystemRules;
    private renderableManager?: any;
    private attachedFx?: DamageSmokeFx;

    constructor(
        gameObject: any,
        art: Art,
        theater: Theater,
        imageFinder: ImageFinder,
        gameSpeed: GameSpeed,
        system?: AresParticleSystemRules,
    ) {
        this.gameObject = gameObject;
        this.art = art;
        this.theater = theater;
        this.imageFinder = imageFinder;
        this.gameSpeed = gameSpeed;
        this.system = system;
    }

    onCreate(renderableManager: any): void {
        this.renderableManager = renderableManager;
    }

    update(time: number): void {
        if (!this.renderableManager || this.attachedFx || !this.system) {
            return;
        }
        if (this.gameObject.isDestroyed || this.gameObject.state !== undefined && this.gameObject.state !== 0) {
            return;
        }

        const behavesLike = (this.system.behavesLike ?? this.system.particle?.behavesLike)
            ?.trim()
            .toLocaleLowerCase("en-US");
        if (behavesLike !== "smoke") {
            return;
        }

        const imageName = this.system.particle?.image;
        if (!imageName || (this.art.hasObject && !this.art.hasObject(imageName, ObjectType.Animation))) {
            return;
        }
        const animation = this.art.getAnimation(imageName);
        const image = animation && this.imageFinder.findByObjectArt(animation);
        if (!animation || !image) {
            return;
        }

        const palette = this.theater.getPalette(
            animation.paletteType,
            animation.customPaletteName,
        );
        this.attachedFx = new DamageSmokeFx(
            this.gameObject,
            animation,
            image,
            palette,
            this.gameSpeed,
            {
                particleCap: this.system.particleCap,
                velocity: this.system.particle?.velocity,
                deacc: this.system.particle?.deacc,
            },
        );
        this.renderableManager.addEffect(this.attachedFx);
    }

    onRemove(): void {
        this.renderableManager = undefined;
        this.attachedFx?.finishAndRemove();
        this.attachedFx = undefined;
    }

    dispose(): void {
        this.attachedFx?.finishAndRemove();
        this.attachedFx = undefined;
    }
}
