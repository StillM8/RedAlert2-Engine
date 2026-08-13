import { Coords } from '@/game/Coords';
import * as THREE from 'three';
import SPE from './speRuntime';
import { patchSpeGroup } from './speCompat';
export interface SparkFxOptions {
    particleCount?: number;
    spread?: number;
    velocity?: number;
    velocitySpread?: number;
    acceleration?: number;
    positionProvider?: () => THREE.Vector3;
}
export class SparkFx {
    private static readonly PARTICLE_LIFETIME = 1;
    private static readonly MAX_PARTICLE_COUNT = 100;
    private static sparkTex?: THREE.DataTexture;
    private pos: THREE.Vector3;
    private color: THREE.Color;
    private spawnDurationSeconds: number;
    private gameSpeed: {
        value: number;
    };
    private totalDurationSeconds: number;
    private container?: any;
    private particleGroup?: SPE.Group;
    private particleEmitter?: SPE.Emitter;
    private firstUpdateMillis?: number;
    private lastUpdateMillis?: number;
    private timeLeft: number = 1;
    private finishRequested = false;
    private options: SparkFxOptions;
    constructor(pos: THREE.Vector3, color: THREE.Color, spawnDurationSeconds: number, gameSpeed: {
        value: number;
    }, options: SparkFxOptions = {}) {
        this.pos = pos;
        this.color = color;
        this.spawnDurationSeconds = spawnDurationSeconds;
        this.gameSpeed = gameSpeed;
        this.options = options;
        this.totalDurationSeconds = spawnDurationSeconds + SparkFx.PARTICLE_LIFETIME;
    }
    setContainer(container: any): void {
        this.container = container;
    }
    create3DObject(): void {
        if (!this.particleGroup) {
            if (!SparkFx.sparkTex) {
                SparkFx.sparkTex = new THREE.DataTexture(new Uint8Array(4).fill(255), 1, 1, THREE.RGBAFormat);
                SparkFx.sparkTex.needsUpdate = true;
            }
            this.particleGroup = new SPE.Group({
                texture: { value: SparkFx.sparkTex },
                maxParticleCount: this.getParticleCount(),
            });
            patchSpeGroup(this.particleGroup);
            this.particleGroup.mesh.name = "fx_spark";
            this.particleGroup.mesh.frustumCulled = false;
            this.particleEmitter = new SPE.Emitter({
                maxAge: { value: SparkFx.PARTICLE_LIFETIME },
                position: {
                    value: this.pos,
                    spread: new THREE.Vector3(
                        this.options.spread ?? 10,
                        0,
                        this.options.spread ?? 10,
                    ).multiplyScalar(Coords.ISO_WORLD_SCALE),
                },
                acceleration: {
                    value: new THREE.Vector3(0, -(this.options.acceleration ?? 50), 0).multiplyScalar(Coords.ISO_WORLD_SCALE),
                    spread: new THREE.Vector3(0, 0, 0),
                },
                velocity: {
                    value: new THREE.Vector3(0, this.options.velocity ?? 30, 0).multiplyScalar(Coords.ISO_WORLD_SCALE),
                    spread: new THREE.Vector3(
                        this.options.velocitySpread ?? 40,
                        5,
                        this.options.velocitySpread ?? 40,
                    ).multiplyScalar(Coords.ISO_WORLD_SCALE),
                },
                color: { value: [this.color] },
                opacity: { value: [1, 0.5] },
                size: { value: 1 },
                particleCount: this.getParticleCount(),
            });
            this.particleGroup.addEmitter(this.particleEmitter);
        }
    }
    private getParticleCount(): number {
        return Math.min(
            SparkFx.MAX_PARTICLE_COUNT,
            Math.max(1, Math.floor(this.options.particleCount ?? SparkFx.MAX_PARTICLE_COUNT)),
        );
    }
    get3DObject(): THREE.Object3D | undefined {
        return this.particleGroup?.mesh;
    }
    update(timeMillis: number): void {
        if (this.particleEmitter && this.options.positionProvider) {
            this.particleEmitter.position.value.copy(this.options.positionProvider());
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
                const elapsedSeconds = (timeMillis - (this.firstUpdateMillis || 0)) / 1000 * this.gameSpeed.value;
                this.totalDurationSeconds = elapsedSeconds + SparkFx.PARTICLE_LIFETIME;
                this.particleEmitter.disable();
            }
        }
        if (this.particleEmitter?.alive &&
            timeMillis - this.firstUpdateMillis! >=
                (1000 * this.spawnDurationSeconds) / this.gameSpeed.value) {
            this.particleEmitter.disable();
        }
        this.timeLeft = Math.max(0, 1 -
            (timeMillis - this.firstUpdateMillis!) /
                ((1000 * this.totalDurationSeconds) / this.gameSpeed.value));
        if (!this.timeLeft) {
            this.container?.remove(this);
            this.dispose();
        }
    }
    finishAndRemove(): void {
        this.finishRequested = true;
    }
    dispose(): void {
        this.particleGroup?.mesh.geometry.dispose();
        this.particleGroup?.mesh.material.dispose();
    }
}
