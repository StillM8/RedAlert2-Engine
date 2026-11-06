import { Palette } from "@/data/Palette";
import { ShpBuilder } from "@/engine/renderable/builder/ShpBuilder";
import { Color } from "@/util/Color";
import { Coords } from "@/game/Coords";
import * as THREE from "three";
export function resolveAlphaImageFacings(frameCount: number): { count: number; offset: number } {
    const normalized = Math.max(0, Math.trunc(frameCount));
    if (normalized <= 1) return { count: 1, offset: 0 };
    let count = 1;
    while (count * 2 <= normalized) count *= 2;
    return { count, offset: 0 };
}
export function resolveAlphaImageFacingFrame(direction: number, frameCount: number): number {
    const facings = resolveAlphaImageFacings(frameCount);
    const normalizedDirection = ((direction % 360) + 360) % 360;
    const facing = Math.floor((normalizedDirection / 360) * facings.count) % facings.count;
    return facings.offset + facing;
}
export class AlphaRenderable {
    private static alphaPalette?: Palette;
    private shpFile: any;
    private camera: THREE.Camera;
    private visible: boolean;
    private drawOffset: any;
    private shpSize?: number;
    private builder?: ShpBuilder;
    private object3d?: THREE.Object3D;
    private facingCount: number;
    private facingFrameOffset: number;
    static getOrCreateAlphaPalette(): Palette {
        let palette = AlphaRenderable.alphaPalette;
        if (!palette) {
            palette = new Palette(new Array(768).fill(0));
            const colors: Color[] = [];
            for (let i = 0; i < 256; i++) {
                const value = i > 127 ? 2 * (i - 127) : 0;
                colors.push(new Color(value, value, value));
            }
            palette.setColors(colors);
            AlphaRenderable.alphaPalette = palette;
        }
        return palette;
    }
    constructor(shpFile: any, camera: THREE.Camera, drawOffset: any) {
        this.shpFile = shpFile;
        this.camera = camera;
        this.visible = true;
        this.drawOffset = { ...drawOffset };
        const frameCount = Math.min(shpFile?.numImages ?? 0, shpFile?.images?.length ?? 0);
        const facings = resolveAlphaImageFacings(frameCount);
        this.facingCount = facings.count;
        this.facingFrameOffset = facings.offset;
    }
    setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.object3d) {
            this.object3d.visible = visible;
        }
    }
    setSize(size: number): void {
        this.shpSize = size;
        this.builder?.setSize(size);
    }
    setFrame(frame: number): void {
        this.builder?.setFrame(frame);
    }
    setFacing(direction: number): void {
        if (this.facingCount <= 1) return;
        const normalizedDirection = ((direction % 360) + 360) % 360;
        const facing = Math.floor((normalizedDirection / 360) * this.facingCount) % this.facingCount;
        this.builder?.setFrame(this.facingFrameOffset + facing);
    }
    getFacingCount(): number {
        return this.facingCount;
    }
    getFacingFrameOffset(): number {
        return this.facingFrameOffset;
    }
    create3DObject(): void {
        if (!this.object3d) {
            const palette = AlphaRenderable.getOrCreateAlphaPalette();
            const builder = new ShpBuilder(this.shpFile, palette, this.camera, Coords.ISO_WORLD_SCALE);
            if (this.shpSize) {
                builder.setSize(this.shpSize);
            }
            builder.setFrame(0);
            builder.setOffset(this.drawOffset);
            const object = builder.build();
            object.visible = this.visible;
            object.renderOrder = 999995;
            const material = object.material as THREE.Material;
            material.depthTest = false;
            material.depthWrite = true;
            material.transparent = true;
            material.blending = THREE.CustomBlending;
            material.blendEquation = THREE.AddEquation;
            material.blendSrc = THREE.DstColorFactor;
            material.blendDst = THREE.OneFactor;
            this.builder = builder;
            this.object3d = object;
        }
    }
    get3DObject(): THREE.Object3D | undefined {
        return this.object3d;
    }
    update(delta: number): void { }
    dispose(): void {
        this.builder?.dispose();
    }
}
