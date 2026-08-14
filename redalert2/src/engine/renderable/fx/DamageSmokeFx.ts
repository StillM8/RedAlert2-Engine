import { AnimProps } from '@/engine/AnimProps';
import { ImageUtils } from '@/engine/gfx/ImageUtils';
import * as THREE from 'three';
import SPE from './speRuntime';
import { patchSpeGroup } from './speCompat';
const PARTICLE_COUNT = 1000;
export interface DamageSmokeFxOptions {
    /** Ares ParticleSystem cap; prevents the legacy 1000-particle fallback. */
    particleCap?: number;
    /** Authored Particle velocity, when present. */
    velocity?: number;
    /** Authored Particle deacceleration, when present. */
    deacc?: number;
}
export class DamageSmokeFx {
    private static textureCache = new Map<any, THREE.Texture>();
    private gameObject: any;
    private smokeArt: any;
    private shpFile: any;
    private palette: any;
    private gameSpeed: any;
    private lifetimeSeconds: number;
    private finishRequested: boolean;
    private container?: any;
    private particleGroup?: SPE.Group;
    private particleEmitter?: SPE.Emitter;
    private particleMaxAge?: number;
    private lastUpdateMillis?: number;
    private firstUpdateMillis?: number;
    private timeLeft?: number;
    private options: DamageSmokeFxOptions;
    static clearTextureCache() {
        this.textureCache.forEach(texture => texture.dispose());
        this.textureCache.clear();
    }
    constructor(gameObject: any, smokeArt: any, shpFile: any, palette: any, gameSpeed: any, options: DamageSmokeFxOptions = {}) {
        this.gameObject = gameObject;
        this.smokeArt = smokeArt;
        this.shpFile = shpFile;
        this.palette = palette;
        this.gameSpeed = gameSpeed;
        this.options = options;
        this.lifetimeSeconds = Number.POSITIVE_INFINITY;
        this.finishRequested = false;
    }
    setContainer(container: any) {
        this.container = container;
    }
    create3DObject() {
        if (!this.particleGroup) {
            let texture = DamageSmokeFx.textureCache.get(this.shpFile);
            if (!texture) {
                const canvas = ImageUtils.convertShpToCanvas(this.shpFile, this.palette, true);
                texture = new THREE.Texture(canvas);
                texture.minFilter = THREE.NearestFilter;
                texture.magFilter = THREE.NearestFilter;
                texture.needsUpdate = true;
                texture.flipY = false;
                DamageSmokeFx.textureCache.set(this.shpFile, texture);
            }
            this.particleGroup = new SPE.Group({
                texture: {
                    value: texture,
                    frames: new THREE.Vector2(this.shpFile.numImages, 1),
                    frameCount: this.shpFile.numImages,
                    loop: 1
                },
                maxParticleCount: this.getParticleCount(),
                hasPerspective: false,
                transparent: true,
                alphaTest: 0,
                blending: THREE.NormalBlending
            });
            patchSpeGroup(this.particleGroup);
            this.particleGroup.mesh.name = "fx_damage_smoke";
            this.particleGroup.mesh.frustumCulled = false;
            const animProps = new AnimProps(this.smokeArt.art, this.shpFile);
            const rate = (this.smokeArt.art.getBool("Normalized") ? 2 : 1) * animProps.rate;
            const activeMultiplier = rate / 10;
            this.particleMaxAge = (2 * this.shpFile.numImages) / animProps.rate;
            const particleCount = this.getParticleCount();
            const velocity = (this.options.velocity ?? 9) * rate;
            const acceleration = (this.options.deacc ?? 0.05) * rate;
            this.particleEmitter = new SPE.Emitter({
                particleCount,
                maxAge: { value: this.particleMaxAge },
                activeMultiplier: activeMultiplier / (particleCount / this.particleMaxAge),
                position: { value: this.computeEmitterPosition() },
                acceleration: {
                    value: new THREE.Vector3(0, -acceleration, 0),
                    spread: new THREE.Vector3(2, 0, 2)
                },
                velocity: {
                    value: new THREE.Vector3(0, velocity, 0),
                    spread: new THREE.Vector3(0.1 * velocity, 0, 0.1 * velocity)
                },
                opacity: { value: 0.5 },
                size: {
                    value: Math.max(this.shpFile.height, this.shpFile.width)
                }
            });
            this.particleGroup.addEmitter(this.particleEmitter);
        }
    }
    private getParticleCount(): number {
        const cap = this.options.particleCap;
        if (cap === undefined || !Number.isFinite(cap) || cap <= 0) {
            return 128;
        }
        return Math.min(PARTICLE_COUNT, Math.max(8, Math.ceil(cap * 8)));
    }
    computeEmitterPosition() {
        const offset = this.gameObject.rules?.damageSmokeOffset;
        return this.gameObject.position.worldPosition
            .clone()
            .add(offset instanceof THREE.Vector3 ? offset : new THREE.Vector3());
    }
    get3DObject() {
        return this.particleGroup?.mesh;
    }
    update(timeMillis: number) {
        if (this.particleEmitter) {
            this.particleEmitter.position.value = this.computeEmitterPosition();
        }
        if (this.lastUpdateMillis !== undefined) {
            const deltaTime = timeMillis - this.lastUpdateMillis;
            this.particleGroup?.tick((deltaTime / 1000) * this.gameSpeed.value);
        }
        else {
            this.firstUpdateMillis = timeMillis;
            this.particleGroup?.tick(0);
        }
        this.lastUpdateMillis = timeMillis;
        if (this.finishRequested) {
            this.finishRequested = false;
            if (this.particleEmitter?.alive) {
                const elapsedTime = ((timeMillis - (this.firstUpdateMillis || 0)) / 1000) * this.gameSpeed.value;
                this.lifetimeSeconds = elapsedTime + (this.particleMaxAge || 0);
                this.particleEmitter.disable();
            }
        }
        this.timeLeft = Math.max(0, 1 - (timeMillis - (this.firstUpdateMillis || 0)) / ((1000 * this.lifetimeSeconds) / this.gameSpeed.value));
        if (!this.timeLeft) {
            this.container?.remove(this);
            this.dispose();
        }
    }
    finishAndRemove() {
        this.finishRequested = true;
    }
    dispose() {
        this.particleGroup?.mesh.geometry.dispose();
        this.particleGroup?.mesh.material.dispose();
    }
}
