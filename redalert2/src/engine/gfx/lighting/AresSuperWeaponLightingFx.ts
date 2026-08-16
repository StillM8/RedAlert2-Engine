import { LightingFx, LightingFxPriority } from "@/engine/gfx/lighting/LightingFx";

export interface AresSuperWeaponLightingRules {
    lightEnabled?: boolean;
    lightAmbient?: number;
    lightRed?: number;
    lightGreen?: number;
    lightBlue?: number;
}

function authoredLightValue(value: number | undefined): number | undefined {
    // Ares uses -1 to request the scenario's corresponding default value.
    return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Applies one temporary, data-driven Ares Light.* override to the map. */
export class AresSuperWeaponLightingFx extends LightingFx {
    private readonly durationGameSeconds: number;

    constructor(
        private readonly rules: AresSuperWeaponLightingRules,
        durationGameSeconds: number,
    ) {
        super();
        this.priority = LightingFxPriority.High;
        this.durationGameSeconds = Math.max(0, Number.isFinite(durationGameSeconds) ? durationGameSeconds : 0);
    }

    update(time: number, gameSpeed: number): { done: boolean; updated: boolean } {
        const elapsedGameSeconds = this.startTime === undefined
            ? 0
            : ((time - this.startTime) / 1000) * gameSpeed;
        if (time === this.startTime) {
            const ambient = authoredLightValue(this.rules.lightAmbient);
            const red = authoredLightValue(this.rules.lightRed);
            const green = authoredLightValue(this.rules.lightGreen);
            const blue = authoredLightValue(this.rules.lightBlue);
            if (ambient !== undefined) this.mapLighting.ambient = ambient;
            if (red !== undefined) this.mapLighting.red = red;
            if (green !== undefined) this.mapLighting.green = green;
            if (blue !== undefined) this.mapLighting.blue = blue;
            return {
                done: this.durationGameSeconds <= 0,
                updated: true,
            };
        }
        return {
            done: elapsedGameSeconds >= this.durationGameSeconds,
            updated: false,
        };
    }
}
