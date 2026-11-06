import { EventType } from "@/game/event/EventType";
import type { PrismSupportBeamEvent } from "@/game/event/PrismSupportBeamEvent";
import { LaserFx } from "@/engine/renderable/fx/LaserFx";
import { TeslaFx } from "@/engine/renderable/fx/TeslaFx";
import { RadBeamFx } from "@/engine/renderable/fx/RadBeamFx";
import { GameSpeed } from "@/game/GameSpeed";
import { Vector2 } from "@/game/math/Vector2";
import * as geometry from "@/game/math/geometry";
import * as THREE from "three";
import { CompositeDisposable } from "@/util/disposable/CompositeDisposable";
import {
    MAX_ARES_LASER_THICKNESS,
    resolveAresLaserThickness,
} from "@/extensions/ares/AresWeaponVisuals";

export class PrismSupportFxHandler {
    private readonly disposables = new CompositeDisposable();

    constructor(
        private readonly game: any,
        private readonly renderableManager: any,
        private readonly camera: any,
    ) {}

    init(): void {
        this.disposables.add(this.game.events.subscribe(
            EventType.PrismSupportBeam,
            (event: PrismSupportBeamEvent) => this.handle(event),
        ));
    }

    dispose(): void {
        this.disposables.dispose();
    }

    private handle(event: PrismSupportBeamEvent): void {
        const profile = event.profile;
        const start = event.source.position.worldPosition.clone();
        const offset = geometry.rotateVec2(
            new Vector2(event.sourceFlh.lateral, event.sourceFlh.forward),
            event.source.turretTrait?.facing ?? event.source.direction ?? 0,
        );
        start.x += offset.x;
        start.z -= offset.y;
        start.y += event.sourceFlh.vertical;
        const end = event.target.position.worldPosition.clone();
        end.y += event.target.rules?.prismForwarding?.myHeight ?? 0;
        const speed = Math.max(0.01, this.game.speed?.value ?? 1);
        const duration = frames => Math.max(1, frames) / GameSpeed.BASE_TICKS_PER_SECOND / speed;
        const intensity = event.source.rules?.prismForwarding?.intensity ?? 0;
        const adjustment = event.downstreamCount <= 0 || intensity === 0
            ? 0
            : intensity < 0
                ? -intensity
                : intensity * event.downstreamCount;
        if (profile.isLaser) {
            const houseColor = event.source.owner?.color?.asHex?.() ?? 0xff0000;
            const innerColor = profile.isHouseColor
                ? new THREE.Color(houseColor)
                : color(profile.laserInnerColor ?? profile.laserOuterColor, 0xff0000);
            const outerColor = color(profile.laserOuterColor, innerColor.getHex());
            const thickness = Math.min(MAX_ARES_LASER_THICKNESS, Math.max(0, resolveAresLaserThickness(event.profile.laserThickness) + adjustment));
            if (!profile.isHouseColor && profile.laserOuterColor && profile.laserOuterSpread > 0) {
                this.renderableManager.addEffect(new LaserFx(
                    this.camera,
                    start,
                    end,
                    outerColor,
                    duration(profile.laserDuration),
                    thickness * (1 + profile.laserOuterSpread),
                ));
            }
            this.renderableManager.addEffect(new LaserFx(
                this.camera,
                start,
                end,
                innerColor,
                duration(profile.laserDuration),
                thickness,
            ));
        }
        if (profile.isElectricBolt) {
            const fallback = profile.isAlternateColor ? 0xffc000 : 0x00d8ff;
            const boltColors = profile.boltColors.map(value => color(value, fallback)) as THREE.Color[];
            this.renderableManager.addEffect(new TeslaFx(
                start,
                end,
                boltColors[0] ?? new THREE.Color(fallback),
                boltColors[2] ?? new THREE.Color(0xffffff),
                duration(1),
                boltColors,
            ));
        }
        if (profile.isRadBeam) {
            const colorValue = profile.beamIsHouseColor
                ? event.source.owner?.color?.asHex?.() ?? 0x40ff40
                : color(profile.beamColor, 0x40ff40).getHex();
            this.renderableManager.addEffect(new RadBeamFx(
                this.camera,
                start,
                end,
                new THREE.Color(colorValue),
                duration(profile.beamDuration),
                Math.min(MAX_ARES_LASER_THICKNESS, Math.max(0, resolveAresLaserThickness(profile.laserThickness) + adjustment)),
                profile.beamAmplitude,
            ));
        }
    }
}

function color(value: readonly [number, number, number] | undefined, fallback: number): THREE.Color {
    return value
        ? new THREE.Color(value[0] / 255, value[1] / 255, value[2] / 255)
        : new THREE.Color(fallback);
}
