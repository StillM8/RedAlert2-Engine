import { WithPosition } from "@/engine/renderable/WithPosition";
import { ShpRenderable } from "@/engine/renderable/ShpRenderable";
import { Projectile as GameProjectile, ProjectileState } from "@/game/gameobject/Projectile";
import { Coords } from "@/game/Coords";
import { LaserFx } from "@/engine/renderable/fx/LaserFx";
import { WeaponType } from "@/game/WeaponType";
import { TeslaFx } from "@/engine/renderable/fx/TeslaFx";
import { GameSpeed } from "@/game/GameSpeed";
import { LineTrailFx } from "@/engine/renderable/fx/LineTrailFx";
import { SparkFx } from "@/engine/renderable/fx/SparkFx";
import { RadBeamFx } from "@/engine/renderable/fx/RadBeamFx";
import { BlobShadow } from "@/engine/renderable/entity/unit/BlobShadow";
import { NukeLightingFx } from "@/engine/gfx/lighting/NukeLightingFx";
import { BatchedMesh } from "@/engine/gfx/batch/BatchedMesh";
import { ObjectRules } from "@/game/rules/ObjectRules";
import { quaternionFromVec3 } from "@/game/math/geometry";
import { PaletteType } from "@/engine/type/PaletteType";
import { resolveAresProjectileAnimationFrame } from "@/extensions/ares/AresProjectileExtensions";
import * as THREE from "three";
export class Projectile {
    private static waveGeometries = new Map<number, THREE.PlaneGeometry>();
    public gameObject: any;
    public rules: any;
    public imageFinder: any;
    public voxels: any;
    public voxelAnims: any;
    public theater: any;
    public palette: any;
    public specialPalette: any;
    public camera: any;
    public gameSpeed: any;
    public lighting: any;
    public lightingDirector: any;
    public vxlBuilderFactory: any;
    public useSpriteBatching: boolean;
    public useMeshInstancing: boolean;
    public plugins: any[] = [];
    public objectArt: any;
    public label: string;
    public withPosition: WithPosition;
    public extraLight: THREE.Vector3;
    public paletteRemaps: any[];
    public target?: THREE.Object3D;
    public blobShadow?: BlobShadow;
    public vxlRotWrapper?: THREE.Object3D;
    public lastDirection?: number;
    public shpRenderable?: ShpRenderable;
    public sonicWaveMesh?: THREE.Mesh | BatchedMesh;
    private waveAgeFrames = 0;
    public lastState?: any;
    public renderableManager?: any;
    public vxlBuilder?: any;
    public lineTrailFx?: LineTrailFx;
    private waveReversed = false;
    constructor(gameObject: any, rules: any, imageFinder: any, voxels: any, voxelAnims: any, theater: any, palette: any, specialPalette: any, camera: any, gameSpeed: any, lighting: any, lightingDirector: any, vxlBuilderFactory: any, useSpriteBatching: boolean, useMeshInstancing: boolean) {
        this.gameObject = gameObject;
        this.rules = rules;
        this.imageFinder = imageFinder;
        this.voxels = voxels;
        this.voxelAnims = voxelAnims;
        this.theater = theater;
        this.palette = palette;
        this.specialPalette = specialPalette;
        this.camera = camera;
        this.gameSpeed = gameSpeed;
        this.lighting = lighting;
        this.lightingDirector = lightingDirector;
        this.vxlBuilderFactory = vxlBuilderFactory;
        this.useSpriteBatching = useSpriteBatching;
        this.useMeshInstancing = useMeshInstancing;
        this.plugins = [];
        this.objectArt = gameObject.art;
        this.label = "projectile_" + gameObject.rules.name;
        this.withPosition = new WithPosition();
        this.extraLight = new THREE.Vector3();
        this.updateLighting();
        if (this.gameObject.rules.firersPalette) {
            const paletteType = this.gameObject.fromObject?.art.paletteType ?? PaletteType.Unit;
            const customPaletteName = this.gameObject.fromObject?.art.customPaletteName;
            this.palette = this.theater.getPalette(paletteType, customPaletteName);
            if (this.gameObject.art.remapable) {
                this.palette = this.palette.clone();
                this.palette.remap(this.gameObject.fromPlayer.color);
            }
        }
        if (this.gameObject.rules.firersPalette && this.objectArt.remapable) {
            this.paletteRemaps = [...this.rules.colors.values()].map((color: any) => this.palette.clone().remap(color));
        }
        else {
            this.paletteRemaps = [this.palette];
        }
    }
    registerPlugin(plugin: any): void {
        this.plugins.push(plugin);
    }
    updateLighting(): void {
        this.plugins.forEach((plugin) => plugin.updateLighting?.());
        if (this.objectArt.isVoxel) {
            // Voxel cell light: see paletteFullLightFragment.
            this.extraLight.copy(this.lighting.compute(this.objectArt.lightingType, this.gameObject.tile, this.gameObject.tileElevation));
        }
        else {
            this.extraLight
                .copy(this.lighting.compute(this.objectArt.lightingType, this.gameObject.tile, this.gameObject.tileElevation))
                .addScalar(-1);
        }
    }
    getIntersectTarget(): any { }
    get3DObject(): THREE.Object3D | undefined {
        return this.target;
    }
    create3DObject(): void {
        let obj = this.get3DObject();
        if (!obj) {
            obj = new THREE.Object3D();
            obj.name = this.label;
            this.target = obj;
            obj.matrixAutoUpdate = false;
            this.withPosition.matrixUpdate = true;
            this.withPosition.applyTo(this);
            this.createObjects(obj);
        }
    }
    setPosition(position: {
        x: number;
        y: number;
        z: number;
    }): void {
        this.withPosition.setPosition(position.x, position.y, position.z);
    }
    getPosition(): THREE.Vector3 {
        return this.withPosition.getPosition();
    }
    update(time: number, deltaTime: number): void {
        this.plugins.forEach((plugin) => plugin.update(time));
        if (deltaTime > 0 && !this.gameObject.isDestroyed) {
            const velocity = this.gameObject.velocity.clone();
            const movement = velocity.multiplyScalar(deltaTime);
            const newPosition = movement.add(this.gameObject.position.worldPosition);
            this.setPosition(newPosition);
        }
        this.blobShadow?.update(time, deltaTime);
        const direction = this.gameObject.direction;
        const animatedRotatingShape = !!this.shpRenderable &&
            this.objectArt.rotates &&
            (this.gameObject.rules.animLength ?? 1) > 1;
        if (!this.vxlRotWrapper &&
            !animatedRotatingShape &&
            this.lastDirection !== undefined &&
            this.lastDirection === direction) {
        }
        else {
            if (this.shpRenderable && this.shpRenderable.frameCount > 2) {
                this.lastDirection = direction;
                this.updateShapeFrame(direction);
            }
            else if (this.vxlRotWrapper) {
                const quaternion = quaternionFromVec3(this.gameObject.velocity.clone().negate());
                this.vxlRotWrapper.rotation.setFromQuaternion(quaternion, "YXZ");
                if (this.gameObject.rules.vertical) {
                    this.vxlRotWrapper.rotation.y = THREE.MathUtils.degToRad(180 + direction);
                }
                this.vxlRotWrapper.updateMatrix();
            }
            else if (this.sonicWaveMesh) {
                this.sonicWaveMesh.rotation.y = THREE.MathUtils.degToRad(direction + (this.waveReversed ? 180 : 0));
                this.sonicWaveMesh.updateMatrix();
                // Native wave lifecycle: the sonic wave expands as it
                // travels. Scale the mesh outward over the projectile's
                // lifetime, matching the original expanding-ring behavior.
                this.waveAgeFrames++;
                const expansion = 1 + Math.min(2.5, this.waveAgeFrames * 0.02);
                this.sonicWaveMesh.scale.setScalar(expansion);
                this.sonicWaveMesh.updateMatrix();
            }
        }
        if (this.gameObject.state !== this.lastState) {
            this.lastState = this.gameObject.state;
            if (this.gameObject.state === ProjectileState.Impact) {
                this.target!.visible = false;
                this.renderableManager.createTransientAnim(this.gameObject.impactAnim, (anim: any) => {
                    anim.setPosition(this.withPosition.getPosition());
                });
                if (this.gameObject.isNuke) {
                    this.lightingDirector.addEffect(new NukeLightingFx());
                }
            }
        }
    }
    updateShapeFrame(direction: number): void {
        const frame = resolveAresProjectileAnimationFrame({
            direction,
            rotates: !!this.objectArt.rotates,
            animLength: this.gameObject.rules.animLength ?? 1,
            animRate: this.gameObject.rules.animRate ?? 1,
            ageTicks: this.gameObject.ageTicks ?? 0,
            frameCount: this.shpRenderable!.frameCount,
        });
        this.shpRenderable!.setFrame(frame);
    }
    createObjects(parent: THREE.Object3D): void {
        const weaponRules = this.gameObject.fromWeapon.rules;
        const weaponVisuals = weaponRules.aresWeaponVisuals;
        const isWave = weaponRules.isSonic ||
            weaponRules.isMagBeam ||
            weaponVisuals?.waveIsLaser ||
            weaponVisuals?.waveIsBigLaser;
        if (isWave) {
            // Ares deliberately preserves the old engine's counter-intuitive
            // naming: Wave.IsLaser is the wider mesh, while Wave.IsBigLaser is
            // the narrower one (see Antares' WaveType mapping).
            const widthScale = weaponVisuals?.waveIsLaser
                ? 1.35
                : weaponVisuals?.waveIsBigLaser
                    ? 0.72
                    : 1;
            const geometryKey = Math.round(widthScale * 100);
            this.waveReversed = this.shouldReverseWave(weaponRules);
            let geometry = Projectile.waveGeometries.get(geometryKey);
            if (!geometry) {
                geometry = this.createSonicWaveGeometry(widthScale);
                Projectile.waveGeometries.set(geometryKey, geometry);
            }
            const material = new THREE.MeshBasicMaterial({
                color: this.getWaveColor(weaponRules),
                blending: THREE.CustomBlending,
                blendEquation: THREE.AddEquation,
                blendSrc: THREE.DstColorFactor,
                blendDst: THREE.OneFactor,
                transparent: true,
                opacity: weaponRules.isSonic ? 0.25 : 0.45,
                alphaTest: 0.01,
                depthTest: false,
                depthWrite: false,
            });
            const mesh = new (this.useMeshInstancing ? BatchedMesh : THREE.Mesh)(geometry, material);
            mesh.rotation.order = "YXZ";
            mesh.rotation.x = -Math.PI / 2;
            mesh.rotation.y = THREE.MathUtils.degToRad(this.gameObject.direction + (this.waveReversed ? 180 : 0));
            mesh.updateMatrix();
            mesh.matrixAutoUpdate = false;
            parent.add(mesh);
            this.sonicWaveMesh = mesh;
            return;
        }
        if (!this.gameObject.rules.inviso &&
            this.gameObject.rules.imageName !== ObjectRules.IMAGE_NONE) {
            if (this.gameObject.art.isVoxel) {
                const imageName = this.objectArt.imageName.toLowerCase();
                const vxlFile = imageName + ".vxl";
                const vxlData = this.voxels.get(vxlFile);
                if (!vxlData) {
                    throw new Error(`VXL missing for projectile ${this.gameObject.rules.name}. Vxl file ${vxlFile} not found.`);
                }
                const hvaData = this.objectArt.noHva
                    ? undefined
                    : this.voxelAnims.get(imageName + ".hva");
                const builder = this.vxlBuilder = this.vxlBuilderFactory.create(vxlData, hvaData, this.paletteRemaps, this.palette);
                builder.setExtraLight(this.extraLight);
                const vxlObject = builder.build();
                const rotWrapper = this.vxlRotWrapper = new THREE.Object3D();
                rotWrapper.rotation.order = "YXZ";
                rotWrapper.matrixAutoUpdate = false;
                rotWrapper.add(vxlObject);
                parent.add(rotWrapper);
            }
            else {
                const imageData = this.imageFinder.findByObjectArt(this.objectArt);
                const drawOffset = this.objectArt.getDrawOffset();
                const isArcing = this.gameObject.rules.arcing;
                const hasShadow = this.gameObject.rules.shadow && !isArcing && imageData.numImages > 1;
                const renderable = ShpRenderable.factory(imageData, this.palette, this.camera, drawOffset, hasShadow);
                renderable.setBatched(this.useSpriteBatching);
                if (this.useSpriteBatching) {
                    renderable.setBatchPalettes(this.paletteRemaps);
                }
                renderable.setExtraLight(this.extraLight);
                renderable.create3DObject();
                this.shpRenderable = renderable;
                parent.add(renderable.get3DObject());
                if (isArcing) {
                    this.blobShadow = new BlobShadow(this.gameObject, 1.5, this.useMeshInstancing);
                    this.blobShadow.create3DObject();
                    parent.add(this.blobShadow.get3DObject());
                }
            }
            if (this.gameObject.fromWeapon.type === WeaponType.DeathWeapon) {
                parent.visible = false;
            }
        }
    }
    createSonicWaveGeometry(widthScale = 1): THREE.PlaneGeometry {
        const geometry = new THREE.PlaneGeometry(Coords.LEPTONS_PER_TILE, (Coords.LEPTONS_PER_TILE / 3) * widthScale, 10, 10);
        const positionAttribute = geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < positionAttribute.count; i++) {
            const x = positionAttribute.getX(i);
            const y = positionAttribute.getY(i);
            const newY = y + Math.cos((x * Math.PI) / Coords.LEPTONS_PER_TILE) * Coords.ISO_WORLD_SCALE;
            positionAttribute.setY(i, newY);
        }
        return geometry;
    }
    private getWaveColor(weaponRules: any): THREE.Color {
        const visuals = weaponRules.aresWeaponVisuals;
        const ownerColor = this.gameObject.fromPlayer?.color?.asHex?.();
        if (visuals?.waveIsHouseColor && ownerColor !== undefined) {
            return new THREE.Color(ownerColor);
        }
        if (visuals?.waveColor) {
            const [r, g, b] = visuals.waveColor;
            return new THREE.Color(r / 255, g / 255, b / 255);
        }
        // This retains the existing YR sonic tint. Ares' enabled laser waves
        // use the documented purple default when no Wave.Color is authored.
        return new THREE.Color(weaponRules.isSonic || weaponRules.isMagBeam ? 0xbcbc : 0x400060);
    }
    private shouldReverseWave(weaponRules: any): boolean {
        const visuals = weaponRules.aresWeaponVisuals;
        const target = this.gameObject.target?.obj;
        if (target?.isVehicle?.()) return !!visuals?.waveReverseAgainstVehicles;
        if (target?.isAircraft?.()) return !!visuals?.waveReverseAgainstAircraft;
        if (target?.isBuilding?.()) return !!visuals?.waveReverseAgainstBuildings;
        if (target?.isInfantry?.()) return !!visuals?.waveReverseAgainstInfantry;
        return !!visuals?.waveReverseAgainstOthers;
    }
    onCreate(renderableManager: any): void {
        this.renderableManager = renderableManager;
        this.plugins.forEach((plugin) => plugin.onCreate(renderableManager));
        const isPrismSecondary = this.gameObject.fromObject?.name === this.rules.general.prism.type &&
            this.gameObject.fromWeapon.type === WeaponType.Secondary;
        let fireOffset: number[];
        if (this.gameObject.fromObject) {
            if (this.gameObject.fromWeapon.type === WeaponType.Primary ||
                this.gameObject.fromWeapon.type === WeaponType.DeathWeapon ||
                isPrismSecondary) {
                fireOffset = this.gameObject.fromObject.art.primaryFirePixelOffset;
            }
            else {
                fireOffset = this.gameObject.fromObject.art.secondaryFirePixelOffset;
            }
        }
        else {
            fireOffset = [];
        }
        const weaponRules = this.gameObject.fromWeapon.rules;
        if (this.gameObject.fromWeapon.type !== WeaponType.DeathWeapon &&
            !weaponRules.limboLaunch) {
            const animList = this.gameObject.fromWeapon.rules.anim;
            let animName: string | undefined;
            if (animList.length) {
                if (animList.length === 1) {
                    animName = animList[0];
                }
                else {
                    const direction = this.gameObject.direction;
                    const index = Math.round((((45 - direction + 360) % 360) / 360) * 8) % 8;
                    animName = animList[index];
                }
            }
            else if (this.gameObject.fromWeapon.warhead.rules.nukeMaker) {
                animName = this.rules.audioVisual.nukeTakeOff;
            }
            if (animName) {
                renderableManager.createTransientAnim(animName, (anim: any) => {
                    anim.setPosition(this.gameObject.position.worldPosition);
                    if (fireOffset.length) {
                        anim.extraOffset = { x: fireOffset[0], y: -fireOffset[1] / 2 };
                    }
                });
            }
        }
        if (weaponRules.isLaser) {
            const startPos = this.gameObject.position.worldPosition.clone();
            const offsetVector = new THREE.Vector3();
            if (fireOffset.length) {
                const screenDistance = Coords.screenDistanceToWorld(fireOffset[0], 0);
                offsetVector.x = 4 * screenDistance.x;
                offsetVector.z = 4 * screenDistance.y;
                offsetVector.y = 4 * Coords.tileHeightToWorld(-fireOffset[1] / (Coords.ISO_TILE_SIZE / 2));
            }
            const endPos = this.gameObject.target.getWorldCoords().clone();
            if (this.gameObject.fromObject?.name === this.rules.general.prism.type &&
                this.gameObject.fromWeapon.type === WeaponType.Secondary) {
                offsetVector.y += this.gameObject.fromObject.art.primaryFireFlh.vertical;
                endPos.add(offsetVector);
            }
            startPos.add(offsetVector);
            const color = new THREE.Color(weaponRules.isHouseColor
                ? this.gameObject.fromPlayer.color.asHex()
                : 0xff0000);
            const duration = weaponRules.laserDuration /
                GameSpeed.BASE_TICKS_PER_SECOND /
                this.gameSpeed.value;
            const thickness = 2 * (this.gameObject.baseDamageMultiplier > 1 ? 2 : 1);
            const laserFx = new LaserFx(this.camera, startPos, endPos, color, duration, thickness);
            renderableManager.addEffect(laserFx);
        }
        if (weaponRules.isElectricBolt) {
            const startPos = this.gameObject.position.worldPosition.clone();
            if (this.gameObject.fromObject?.isBuilding()) {
                startPos.y += Coords.tileHeightToWorld(1);
            }
            const endPos = this.gameObject.target.getWorldCoords();
            const palette = this.specialPalette;
            const defaultColors = [
                new THREE.Color(palette.getColorAsHex(weaponRules.isAlternateColor ? 5 : 10)),
                new THREE.Color(palette.getColorAsHex(weaponRules.isAlternateColor ? 5 : 10)),
                new THREE.Color(palette.getColorAsHex(15)),
            ];
            const boltColors = (weaponRules.aresWeaponVisuals?.boltColors ?? []).map((color: any, index: number) => {
                if (!color) return defaultColors[index];
                const [r, g, b] = color;
                return new THREE.Color(r / 255, g / 255, b / 255);
            });
            const innerColor = boltColors[0] ?? defaultColors[0];
            const outerColor = boltColors[2] ?? defaultColors[2];
            const duration = 1 / this.gameSpeed.value;
            const teslaFx = new TeslaFx(startPos, endPos, innerColor, outerColor, duration, boltColors);
            renderableManager.addEffect(teslaFx);
        }
        if (weaponRules.isRadBeam) {
            const startPos = this.gameObject.position.worldPosition.clone();
            const endPos = this.gameObject.target.getWorldCoords().clone();
            const visuals = weaponRules.aresWeaponVisuals;
            const vanillaColor = this.gameObject.fromWeapon.warhead.rules.temporal
                ? new THREE.Color(...this.rules.audioVisual.chronoBeamColor.map((c: number) => c / 255))
                : new THREE.Color(...this.rules.radiation.radColor.map((c: number) => c / 255));
            const ownerColor = this.gameObject.fromPlayer?.color?.asHex?.();
            let color = vanillaColor;
            if (visuals?.beamIsHouseColor && ownerColor !== undefined) {
                color = new THREE.Color(ownerColor);
            }
            else if (visuals?.beamColor) {
                const [r, g, b] = visuals.beamColor;
                color = new THREE.Color(r / 255, g / 255, b / 255);
            }
            const durationFrames = Math.max(1, visuals?.beamDuration ?? 15);
            const duration = durationFrames /
                GameSpeed.BASE_TICKS_PER_SECOND /
                this.gameSpeed.value;
            const amplitude = Math.max(0, visuals?.beamAmplitude ?? Coords.LEPTONS_PER_TILE / 6);
            const radBeamFx = new RadBeamFx(this.camera, startPos, endPos, color, duration, 1, amplitude);
            renderableManager.addEffect(radBeamFx);
        }
        if (this.objectArt.useLineTrail) {
            const color = new THREE.Color().fromArray(this.objectArt.lineTrailColor.map((c: number) => c / 255));
            const colorDecrement = this.objectArt.lineTrailColorDecrement;
            const lineTrailFx = new LineTrailFx(() => this.target, color, colorDecrement, this.gameSpeed, this.camera);
            renderableManager.addEffect(lineTrailFx);
            this.lineTrailFx = lineTrailFx;
        }
        if (weaponRules.useSparkParticles) {
            const position = this.gameObject.position.worldPosition.clone();
            const duration = 20 / GameSpeed.BASE_TICKS_PER_SECOND;
            const sparkFx = new SparkFx(position, new THREE.Color(1, 1, 1), duration, this.gameSpeed);
            renderableManager.addEffect(sparkFx);
        }
    }
    onRemove(renderableManager: any): void {
        this.renderableManager = undefined;
        this.plugins.forEach((plugin) => plugin.onRemove(renderableManager));
        if (this.gameObject.overshootTiles) {
            this.lineTrailFx?.stopTracking();
        }
        this.lineTrailFx?.requestFinishAndDispose();
    }
    dispose(): void {
        this.plugins.forEach((plugin) => plugin.dispose());
        this.shpRenderable?.dispose();
        this.vxlBuilder?.dispose();
        this.blobShadow?.dispose();
    }
}
