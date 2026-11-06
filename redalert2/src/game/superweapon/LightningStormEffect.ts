import { Coords } from "@/game/Coords";
import { fnv32aStrings } from "@/util/math";
import { LightningStormCloudEvent } from "@/game/event/LightningStormCloudEvent";
import { LightningStormManifestEvent } from "@/game/event/LightningStormManifestEvent";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { GameSpeed } from "@/game/GameSpeed";
import { Warhead } from "@/game/Warhead";
import { SuperWeaponEffect, TileCoord } from "@/game/superweapon/SuperWeaponEffect";
import { Game } from "@/game/Game";
import { resolveAresSuperWeaponRange } from "@/game/superweapon/AresSuperWeaponRange";
import { isLightningStormTileInRange } from "@/game/superweapon/LightningStormRange";
import { resolveAresLightningRodCloudTile } from "@/extensions/ares/AresLightningRods";
import type { AresLightningStormSettings } from "@/extensions/ares/AresSuperWeapons";
enum LightningStormState {
    Approaching,
    Manifesting
}
interface Cloud {
    tile: TileCoord;
    durationTicks: number;
    ticksLeft: number;
}

interface ResolvedLightningStormSettings {
    readonly duration: number;
    readonly hitDelay: number;
    readonly scatterDelay: number;
    readonly separation: number;
    readonly scatterCount: number;
    readonly damage: number;
    readonly warhead: string;
}

const EMPTY_LIGHTNING_STORM_SETTINGS: Readonly<AresLightningStormSettings> = Object.freeze({});

function normalizeDeferment(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
}

function normalizeDuration(value: number | undefined): number {
    return value === -1 ? -1 : normalizeDeferment(value);
}

function normalizePositiveDelay(value: number | undefined): number {
    return Number.isFinite(value) && value! > 0 ? Math.max(1, Math.trunc(value!)) : 0;
}

function normalizeNonnegativeInteger(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value!)) : 0;
}

export class LightningStormEffect extends SuperWeaponEffect {
    private state: LightningStormState = LightningStormState.Approaching;
    private clouds: Cloud[] = [];
    private manifestStartTimer: number = 0;
    private manifestEndTimer: number = 0;
    private nextDirectHitTimer: number = 0;
    private nextRandomHitTimer: number = 0;
    constructor(
        type: any,
        owner: any,
        tile: TileCoord,
        private readonly superWeaponDeferment?: number,
        superWeaponRange?: readonly number[],
        private readonly ignoreLightningRod: boolean = false,
        settings: Readonly<AresLightningStormSettings> = EMPTY_LIGHTNING_STORM_SETTINGS,
    ) {
        super(type, owner, tile);
        this.superWeaponRange = superWeaponRange ? Object.freeze(superWeaponRange.slice()) : undefined;
        this.settings = Object.freeze({ ...settings });
    }
    private readonly superWeaponRange?: readonly number[];
    private readonly settings: Readonly<AresLightningStormSettings>;
    getHash(): number {
        // Phase and the four timers decide every future strike; cloud
        // positions/lifetimes decide where bolts land.
        return fnv32aStrings([
            "LightningStormEffect",
            super.getHash(),
            this.state,
            this.manifestStartTimer,
            this.manifestEndTimer,
            this.nextDirectHitTimer,
            this.nextRandomHitTimer,
            ...this.clouds.flatMap((cloud) => [
                cloud.tile?.rx ?? -1,
                cloud.tile?.ry ?? -1,
                cloud.durationTicks,
                cloud.ticksLeft,
            ]),
        ]);
    }
    private resolveSettings(game: Game): ResolvedLightningStormSettings {
        const lightningStorm = game.rules.general.lightningStorm;
        const damage = this.settings.damage ?? lightningStorm.damage;
        return {
            duration: normalizeDuration(this.settings.duration ?? lightningStorm.duration),
            hitDelay: normalizePositiveDelay(this.settings.hitDelay ?? lightningStorm.hitDelay),
            scatterDelay: normalizePositiveDelay(this.settings.scatterDelay ?? lightningStorm.scatterDelay),
            separation: normalizeNonnegativeInteger(this.settings.separation ?? lightningStorm.separation),
            scatterCount: normalizeNonnegativeInteger(this.settings.scatterCount ?? 1),
            damage: Number.isFinite(damage) ? damage : 0,
            warhead: this.settings.warhead ?? lightningStorm.warhead,
        };
    }
    onStart(game: Game): void {
        const lightningStorm = game.rules.general.lightningStorm;
        // Antares resolves SW.Deferment per superweapon and falls back to
        // General.LightningDeferment for Lightning Storm. A zero override is
        // meaningful, so use nullish rather than truthy fallback semantics.
        this.manifestStartTimer = normalizeDeferment(
            this.superWeaponDeferment ?? lightningStorm.deferment,
        );
        this.manifestEndTimer = this.resolveSettings(game).duration;
        this.nextDirectHitTimer = 0;
        this.nextRandomHitTimer = 0;
    }
    onTick(game: Game): boolean {
        const settings = this.resolveSettings(game);
        if (this.state === LightningStormState.Approaching) {
            if (this.manifestStartTimer > 0) {
                this.manifestStartTimer--;
            }
            else {
                this.state = LightningStormState.Manifesting;
                game.events.dispatch(new LightningStormManifestEvent(this.tile));
            }
        }
        if (this.state === LightningStormState.Manifesting) {
            const durationActive = this.manifestEndTimer === -1 || this.manifestEndTimer > 0;
            if (this.manifestEndTimer > 0) {
                this.manifestEndTimer--;
            }
            if (durationActive && settings.hitDelay > 0) {
                if (this.nextDirectHitTimer > 0) {
                    this.nextDirectHitTimer--;
                }
                if (this.nextDirectHitTimer <= 0) {
                    this.nextDirectHitTimer = settings.hitDelay;
                    this.spawnCloudAt(this.tile, game);
                }
            }
            if (durationActive && settings.scatterDelay > 0 && settings.scatterCount > 0) {
                if (this.nextRandomHitTimer > 0) {
                    this.nextRandomHitTimer--;
                }
                if (this.nextRandomHitTimer <= 0) {
                    this.nextRandomHitTimer = settings.scatterDelay;
                    this.trySpawnScatterHit(settings, game);
                }
            }
            for (const cloud of this.clouds.slice()) {
                if (cloud.ticksLeft > 0) {
                    cloud.ticksLeft--;
                    if (cloud.ticksLeft === Math.floor(cloud.durationTicks / 2)) {
                        const warhead = new Warhead(game.rules.getWarhead(settings.warhead));
                        const tile = cloud.tile;
                        const bridge = game.map.tileOccupation.getBridgeOnTile(tile);
                        const elevation = bridge?.tileElevation ?? 0;
                        const zone = game.map.getTileZone(tile);
                        warhead.detonate(game as any, settings.damage, tile, elevation, Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z + elevation), zone, bridge ? CollisionType.OnBridge : CollisionType.None, game.createTarget(bridge, tile), { player: this.owner, weapon: undefined, aresIgnoreLightningRod: this.ignoreLightningRod } as any, false, undefined, undefined, true);
                    }
                }
                else {
                    this.clouds.splice(this.clouds.indexOf(cloud), 1);
                }
            }
            if (!this.clouds.length && this.manifestEndTimer === 0) {
                return true;
            }
        }
        return false;
    }
    private trySpawnScatterHit(settings: ResolvedLightningStormSettings, game: Game): void {
        const lightningStorm = game.rules.general.lightningStorm;
        const range = resolveAresSuperWeaponRange(this.superWeaponRange, {
            widthOrRange: lightningStorm.cellSpread,
            height: -1,
        });
        const width = Math.trunc(range.widthOrRange);
        const height = range.height > 0 ? Math.trunc(range.height) : width;
        if (width <= 0 || height <= 0) return;
        const halfWidth = Math.max(0, Math.trunc(width / 2));
        const halfHeight = Math.max(0, Math.trunc(height / 2));
        for (let attempt = 0; attempt < settings.scatterCount; attempt++) {
            const offsetX = game.generateRandomInt(-halfWidth, halfWidth);
            const offsetY = game.generateRandomInt(-halfHeight, halfHeight);
            const candidate = game.map.tiles.getByMapCoords(this.tile.rx + offsetX, this.tile.ry + offsetY);
            if (!candidate || game.map.mapBounds?.isWithinBounds?.(candidate) === false ||
                !isLightningStormTileInRange(this.tile, candidate, range)) {
                continue;
            }
            const attractedTile = resolveAresLightningRodCloudTile(
                candidate,
                game.updatableObjects,
                this.ignoreLightningRod,
            );
            const redirected = attractedTile.rx !== candidate.rx || attractedTile.ry !== candidate.ry;
            if (!redirected && settings.separation > 0 && this.clouds.some(cloud =>
                Math.abs(cloud.tile.rx - candidate.rx) + Math.abs(cloud.tile.ry - candidate.ry) < settings.separation)) {
                continue;
            }
            this.spawnCloudAt(attractedTile, game);
            return;
        }
    }
    private spawnCloudAt(tile: TileCoord, game: Game): void {
        const clouds = game.rules.audioVisual.weatherConClouds;
        const cloudIndex = game.generateRandomInt(0, clouds.length - 1);
        const animation = game.art.getAnimation(clouds[cloudIndex]);
        const rate = animation.art.getNumber("Rate", 60 * GameSpeed.BASE_TICKS_PER_SECOND) / 60;
        const durationTicks = Math.floor((GameSpeed.BASE_TICKS_PER_SECOND / rate) * 60);
        this.clouds.push({
            tile,
            durationTicks,
            ticksLeft: durationTicks
        });
        const elevation = (game.map.tileOccupation.getBridgeOnTile(tile)?.tileElevation ?? 0) +
            Coords.worldToTileHeight(game.rules.general.flightLevel);
        const position = Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z + elevation);
        game.events.dispatch(new LightningStormCloudEvent(position));
    }
}
