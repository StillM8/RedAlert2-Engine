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
 * Renders the smoke half of Ares damage particle systems.
 *
 * The old renderer ignored the authored ParticleSystem -> Particle -> Image
 * chain and always emitted SGRYSMK1. This plugin resolves that chain at the
 * render boundary while keeping the simulation rules data-only. Spark systems
 * are intentionally kept as a separate follow-up because they use Ares'
 * colored movement-particle path rather than an SHP smoke emitter.
 */
export class DamageSmokePlugin {
    private gameObject: any;
    private art: Art;
    private theater: Theater;
    private imageFinder: ImageFinder;
    private gameSpeed: GameSpeed;
    private damageParticleSystems: readonly (AresParticleSystemRules | string)[];
    private renderableManager?: any;
    private smokeFx?: DamageSmokeFx;
    private lastDamaged?: boolean;
    private smokeStartTime?: number;
    private spawnCount = 0;
    private conditionYellow: number;

    constructor(
        gameObject: any,
        art: Art,
        theater: Theater,
        imageFinder: ImageFinder,
        gameSpeed: GameSpeed,
        damageParticleSystems?: readonly (AresParticleSystemRules | string)[],
        conditionYellow = 0.5,
    ) {
        this.gameObject = gameObject;
        this.art = art;
        this.theater = theater;
        this.imageFinder = imageFinder;
        this.gameSpeed = gameSpeed;
        this.damageParticleSystems = damageParticleSystems ?? [];
        this.conditionYellow = conditionYellow > 0 && conditionYellow <= 1
            ? conditionYellow
            : 0.5;
    }

    onCreate(renderableManager: any): void {
        this.renderableManager = renderableManager;
    }

    update(time: number): void {
        if (this.damageParticleSystems.length === 0) {
            this.disposeSmokeFx();
            return;
        }
        if (!this.renderableManager) return;

        const health = Number(this.gameObject.healthTrait?.health ?? 100);
        const isDamaged = health > 0 && health <= this.conditionYellow * 100;
        const isDamagedChanged = isDamaged !== this.lastDamaged;
        const isDestroyed = !!this.gameObject.isDestroyed;
        if (isDamagedChanged || isDestroyed) {
            this.lastDamaged = isDamaged;
            if (isDamaged && !isDestroyed) {
                this.createSmokeFx(time);
            }
            else {
                this.disposeSmokeFx();
            }
        }
        if (this.smokeFx &&
            this.smokeStartTime !== undefined &&
            time - this.smokeStartTime >= 80000 / Math.max(0.01, this.gameSpeed.value)) {
            this.disposeSmokeFx();
        }
    }

    private createSmokeFx(time: number): void {
        if (this.smokeFx) return;
        const resolved = this.resolveSmokeAnimation();
        if (!resolved) return;

        const image = this.imageFinder.findByObjectArt(resolved.animation);
        if (!image) return;
        const palette = this.theater.getPalette(
            resolved.animation.paletteType,
            resolved.animation.customPaletteName,
        );
        this.smokeStartTime = time;
        this.smokeFx = new DamageSmokeFx(
            this.gameObject,
            resolved.animation,
            image,
            palette,
            this.gameSpeed,
            {
                particleCap: resolved.system?.particleCap,
                velocity: resolved.system?.particle?.velocity,
                deacc: resolved.system?.particle?.deacc,
            },
        );
        this.renderableManager.addEffect(this.smokeFx);
    }

    private resolveSmokeAnimation(): {
        system?: AresParticleSystemRules;
        animation: any;
    } | undefined {
        if (!this.damageParticleSystems.length) return undefined;
        const selected = this.damageParticleSystems[
            this.spawnCount++ % this.damageParticleSystems.length
        ];
        const system = typeof selected === "string" ? undefined : selected;
        const authoredImage = system?.particle?.image;
        // Keep the retail fallback for tests and older rule sets that only
        // expose the flat DamageParticleSystems ID list. A parsed system with
        // no Particle image is not silently replaced by grey smoke.
        const imageName = authoredImage ?? (!system ? "SGRYSMK1" : undefined);
        if (!imageName) return undefined;
        if (this.art.hasObject && !this.art.hasObject(imageName, ObjectType.Animation)) {
            return undefined;
        }
        const animation = this.art.getAnimation(imageName);
        return animation ? { system, animation } : undefined;
    }

    private disposeSmokeFx(): void {
        if (this.smokeFx) {
            this.smokeFx.finishAndRemove();
            this.smokeFx = undefined;
        }
        this.smokeStartTime = undefined;
    }

    onRemove(): void {
        this.renderableManager = undefined;
        this.disposeSmokeFx();
    }

    dispose(): void {
        this.disposeSmokeFx();
    }
}
