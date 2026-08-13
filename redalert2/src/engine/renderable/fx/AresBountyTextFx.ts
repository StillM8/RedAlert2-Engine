import { DebugLabel } from "@/engine/renderable/entity/unit/DebugLabel";
import { Coords } from "@/game/Coords";
import * as THREE from "three";

interface Container {
    remove(item: AresBountyTextFx): void;
}

interface GameSpeed {
    value: number;
}

/**
 * The shared world text used by Ares credit displays. Ares uses a signed
 * amount with green positive and red negative text; the text rises briefly
 * above the affected object and then removes itself from the world scene.
 */
export class AresBountyTextFx {
    private static readonly DURATION_MILLIS = 1000;
    private readonly position: THREE.Vector3;
    private readonly startHeight: number;
    private readonly text: string;
    private readonly color: string;
    private readonly camera: THREE.Camera;
    private readonly gameSpeed: GameSpeed;
    private container?: Container;
    private label?: DebugLabel;
    private firstUpdateMillis?: number;
    private removed = false;

    constructor(position: THREE.Vector3, amount: number, camera: THREE.Camera, gameSpeed: GameSpeed) {
        this.position = position.clone();
        this.startHeight = Coords.tileHeightToWorld(1);
        this.text = amount >= 0 ? `+${amount}` : `${amount}`;
        this.color = amount >= 0 ? "#00ff00" : "#ff0000";
        this.camera = camera;
        this.gameSpeed = gameSpeed;
    }

    setContainer(container: Container): void {
        this.container = container;
    }

    create3DObject(): void {
        if (this.label) {
            return;
        }
        this.label = new DebugLabel(this.text, this.color, this.camera);
        this.label.create3DObject();
        const object = this.label.get3DObject();
        if (!object) {
            return;
        }
        object.renderOrder = 999999;
        object.position.copy(this.position);
        object.position.y += this.startHeight;
        object.updateMatrix();
    }

    get3DObject(): THREE.Object3D | undefined {
        return this.label?.get3DObject();
    }

    update(timeMillis: number): void {
        if (this.firstUpdateMillis === undefined) {
            this.firstUpdateMillis = timeMillis;
        }
        const speed = Math.max(0.01, this.gameSpeed.value || 1);
        const duration = AresBountyTextFx.DURATION_MILLIS / speed;
        const progress = Math.min(1, Math.max(0, (timeMillis - this.firstUpdateMillis) / duration));
        const object = this.label?.get3DObject();
        if (object) {
            object.position.y = this.position.y + this.startHeight + Coords.tileHeightToWorld(progress * 0.5);
            object.updateMatrix();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material: THREE.Material | undefined) => {
                if (material) {
                    material.transparent = true;
                    material.opacity = 1 - progress;
                }
            });
        }
        if (progress >= 1 && !this.removed) {
            this.removed = true;
            this.container?.remove(this);
            this.dispose();
        }
    }

    dispose(): void {
        this.label?.dispose();
    }
}
