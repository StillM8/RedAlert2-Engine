import { DamageSmokeFx } from "@/engine/renderable/fx/DamageSmokeFx";
import { SparkFx } from "@/engine/renderable/fx/SparkFx";
import { ObjectType } from "@/engine/type/ObjectType";
import type { AresParticleSystemRules } from "@/extensions/ares/AresParticleSystems";
import * as THREE from "three";

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
 * use the shared colored movement-particle path and repeat while the techno
 * remains in the authored yellow/red health state.
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
    private conditionYellow: number;
    private damageSparkParticleSystems: readonly (AresParticleSystemRules | string)[];
    private damageSparksEnabled: boolean;
    private sparkFx?: SparkFx;
    private sparkStartTime?: number;
    private sparkNextTime?: number;
    private randomState = 0x9e3779b9;

    constructor(
        gameObject: any,
        art: Art,
        theater: Theater,
        imageFinder: ImageFinder,
        gameSpeed: GameSpeed,
        damageParticleSystems?: readonly (AresParticleSystemRules | string)[],
        conditionYellow = 0.5,
        damageSparkParticleSystems?: readonly (AresParticleSystemRules | string)[],
        damageSparksEnabled = false,
    ) {
        this.gameObject = gameObject;
        this.art = art;
        this.theater = theater;
        this.imageFinder = imageFinder;
        this.gameSpeed = gameSpeed;
        this.damageParticleSystems = damageParticleSystems ?? [];
        this.damageSparkParticleSystems = damageSparkParticleSystems ?? [];
        this.damageSparksEnabled = damageSparksEnabled;
        this.conditionYellow = conditionYellow > 0 && conditionYellow <= 1
            ? conditionYellow
            : 0.5;
    }

    onCreate(renderableManager: any): void {
        this.renderableManager = renderableManager;
    }

    update(time: number): void {
        if (this.damageParticleSystems.length === 0 &&
            (!this.damageSparksEnabled || this.damageSparkParticleSystems.length === 0)) {
            this.disposeSmokeFx();
            this.disposeSparkFx();
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
                this.sparkNextTime = time;
            }
            else {
                this.disposeSmokeFx();
                this.disposeSparkFx();
            }
        }
        if (this.smokeFx &&
            this.smokeStartTime !== undefined &&
            time - this.smokeStartTime >= 80000 / Math.max(0.01, this.gameSpeed.value)) {
            this.disposeSmokeFx();
        }
        if (isDamaged && !isDestroyed && this.damageSparksEnabled) {
            this.updateSparkFx(time);
        }
    }

    private updateSparkFx(time: number): void {
        if (!this.damageSparkParticleSystems.length) return;
        if (this.sparkFx &&
            this.sparkStartTime !== undefined &&
            time - this.sparkStartTime >= this.getSparkLifetimeMillis()) {
            this.sparkFx = undefined;
            this.sparkStartTime = undefined;
        }
        if (!this.sparkFx &&
            (this.sparkNextTime === undefined || time >= this.sparkNextTime)) {
            this.createSparkFx(time);
        }
    }

    private createSparkFx(time: number): void {
        const system = this.selectSparkSystem();
        const probability = system?.spawnSparkPercentage;
        if (probability !== undefined && !this.rollSparkProbability(probability)) {
            this.sparkNextTime = time + this.getSparkIntervalMillis(system);
            return;
        }
        const position = this.gameObject.position?.worldPosition?.clone?.();
        if (!position) return;
        const color = this.getSparkColor(system);
        const spawnFrames = Math.max(1, system?.spawnFrames ?? 1);
        const particle = system?.particle;
        this.sparkStartTime = time;
        this.sparkNextTime = time + this.getSparkIntervalMillis(system);
        this.sparkFx = new SparkFx(
            position,
            color,
            spawnFrames / 15,
            this.gameSpeed,
            {
                particleCount: system?.particleCap,
                spread: Math.max(5, system?.spawnRadius ?? 10),
                velocity: Math.max(10, particle?.minZVelocity ?? particle?.velocity ?? 30),
                velocitySpread: Math.max(
                    10,
                    particle?.xVelocity ?? 0,
                    particle?.yVelocity ?? 0,
                    particle?.zVelocityRange ?? 0,
                ),
                positionProvider: () => this.gameObject.position.worldPosition.clone(),
            },
        );
        this.renderableManager.addEffect(this.sparkFx);
    }

    private selectSparkSystem(): AresParticleSystemRules | undefined {
        if (!this.damageSparkParticleSystems.length) return undefined;
        const selected = this.damageSparkParticleSystems[
            Math.floor(this.nextRandom() * this.damageSparkParticleSystems.length)
        ];
        return typeof selected === "string" ? { id: selected } : selected;
    }

    private getSparkColor(system: AresParticleSystemRules | undefined): THREE.Color {
        const color = system?.particle?.colorList?.find(values =>
            values.length >= 3 && values.some(value => value > 0));
        return new THREE.Color(
            (color?.[0] ?? 255) / 255,
            (color?.[1] ?? 255) / 255,
            (color?.[2] ?? 255) / 255,
        );
    }

    private rollSparkProbability(probability: number): boolean {
        const normalized = Math.max(0, Math.min(1, probability));
        return this.nextRandom() < normalized;
    }

    private nextRandom(): number {
        this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
        return this.randomState / 0x100000000;
    }

    private getSparkIntervalMillis(system: AresParticleSystemRules | undefined): number {
        return (Math.max(1, system?.spawnFrames ?? 1) / 15) * 1000 /
            Math.max(0.01, this.gameSpeed.value);
    }

    private getSparkLifetimeMillis(): number {
        return (1000 / Math.max(0.01, this.gameSpeed.value)) +
            Math.max(0, (this.sparkNextTime ?? 0) - (this.sparkStartTime ?? 0));
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
            Math.floor(this.nextRandom() * this.damageParticleSystems.length)
        ];
        const system = typeof selected === "string" ? undefined : selected;
        const authoredImage = system?.particle?.image;
        // Keep the retail fallback for tests and older rule sets that only
        // expose the flat DamageParticleSystems ID list. A parsed system with
        // no Particle image is not silently replaced by grey smoke.
        const hasParticleMetadata = system?.particle !== undefined ||
            system?.holdsWhat !== undefined ||
            system?.behavesLike !== undefined ||
            system?.particleCap !== undefined ||
            system?.spawnFrames !== undefined ||
            system?.spawnRadius !== undefined;
        const imageName = authoredImage ?? (!hasParticleMetadata ? "SGRYSMK1" : undefined);
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

    private disposeSparkFx(): void {
        this.sparkFx?.finishAndRemove();
        this.sparkFx = undefined;
        this.sparkStartTime = undefined;
        this.sparkNextTime = undefined;
    }

    onRemove(): void {
        this.renderableManager = undefined;
        this.disposeSmokeFx();
        this.disposeSparkFx();
    }

    dispose(): void {
        this.disposeSmokeFx();
        this.disposeSparkFx();
    }
}
