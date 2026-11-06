import { MapLighting } from '@/data/map/MapLighting';
import { GameSpeed } from '@/game/GameSpeed';
import { EventDispatcher } from '@/util/event';
import { NotifyTick } from '@/game/trait/interface/NotifyTick';
import { fnv32aStrings } from '@/util/math';
export class MapLightingTrait {
    private mapLighting: MapLighting;
    private _onChange: EventDispatcher;
    private ambientChangeRate: number;
    private ambientChangeStep: number;
    private targetAmbient?: number;
    private ambientUpdateTicks?: number;
    get onChange() {
        return this._onChange.asEvent();
    }
    constructor(config: {
        ambientChangeRate: number;
        ambientChangeStep: number;
    }, initialLighting?: MapLighting) {
        this.mapLighting = new MapLighting();
        this._onChange = new EventDispatcher();
        this.ambientChangeRate = config.ambientChangeRate;
        this.ambientChangeStep = config.ambientChangeStep;
        if (initialLighting) {
            this.mapLighting.copy(initialLighting);
        }
    }
    setAmbientChangeRate(rate: number): void {
        this.ambientChangeRate = rate;
    }
    setAmbientChangeStep(step: number): void {
        this.ambientChangeStep = step;
    }
    setTargetAmbientIntensity(intensity: number): void {
        this.targetAmbient = intensity;
    }
    getHash(): number {
        return fnv32aStrings([
            "MapLightingTrait",
            this.mapLighting.level,
            this.mapLighting.ambient,
            this.mapLighting.red,
            this.mapLighting.green,
            this.mapLighting.blue,
            this.mapLighting.ground,
            this.mapLighting.forceTint ? 1 : 0,
            this.targetAmbient ?? -1,
            this.ambientUpdateTicks ?? -1,
        ]);
    }
    captureState(): Record<string, unknown> {
        return {
            version: 1,
            level: this.mapLighting.level,
            ambient: this.mapLighting.ambient,
            red: this.mapLighting.red,
            green: this.mapLighting.green,
            blue: this.mapLighting.blue,
            ground: this.mapLighting.ground,
            forceTint: this.mapLighting.forceTint,
            targetAmbient: this.targetAmbient ?? null,
            ambientUpdateTicks: this.ambientUpdateTicks ?? null,
        };
    }
    restoreState(state: unknown): void {
        if (!state || typeof state !== "object" || (state as any).version !== 1) {
            throw new Error("Invalid map lighting state");
        }
        for (const key of ["level", "ambient", "red", "green", "blue", "ground"]) {
            if (!Number.isFinite((state as any)[key])) throw new Error("Invalid map lighting value");
            this.mapLighting[key] = (state as any)[key];
        }
        if (typeof (state as any).forceTint !== "boolean") throw new Error("Invalid map lighting tint");
        this.mapLighting.forceTint = (state as any).forceTint;
        this.targetAmbient = (state as any).targetAmbient === null ? undefined : (state as any).targetAmbient;
        this.ambientUpdateTicks = (state as any).ambientUpdateTicks === null ? undefined : (state as any).ambientUpdateTicks;
    }
    getAmbient(): MapLighting {
        return this.mapLighting;
    }
    [NotifyTick.onTick](): void {
        if (this.targetAmbient === undefined) {
            return;
        }
        if (this.ambientUpdateTicks === undefined) {
            this.ambientUpdateTicks = Math.floor(60 * GameSpeed.BASE_TICKS_PER_SECOND * this.ambientChangeRate);
        }
        if (this.ambientUpdateTicks <= 0) {
            this.ambientUpdateTicks = undefined;
            const currentAmbient = this.mapLighting.ambient;
            const diff = this.targetAmbient - currentAmbient;
            if (diff !== 0) {
                const step = Math.sign(diff) * Math.min(this.ambientChangeStep, Math.abs(diff));
                this.mapLighting.ambient += step;
                this._onChange.dispatch(this, this.mapLighting);
            }
            else {
                this.targetAmbient = undefined;
            }
        }
        else {
            this.ambientUpdateTicks--;
        }
    }
}
