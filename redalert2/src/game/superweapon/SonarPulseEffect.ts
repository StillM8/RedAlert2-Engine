import { createAresSuperWeaponTargetFilter } from "@/extensions/ares/AresSuperWeaponFilters";
import { RadarEvent } from "@/game/event/RadarEvent";
import { RadarEventType } from "@/game/rules/general/RadarRules";
import { RadarTrait } from "@/game/trait/RadarTrait";
import { SuperWeaponEffect, type TileCoord } from "@/game/superweapon/SuperWeaponEffect";
import type { Game } from "@/game/Game";
import type { Player } from "@/game/Player";

export interface SonarPulseRange {
    widthOrRange: number;
    height: number;
}

/**
 * Antares defaults SonarPulse to a radius of ten cells.  The second value is
 * a rectangle height; an omitted/zero value selects the CellRange path.
 */
export function resolveSonarPulseRange(range?: readonly number[]): SonarPulseRange {
    const configuredWidth = range?.[0];
    const configuredHeight = range?.[1];
    const widthOrRange = typeof configuredWidth === "number" && Number.isFinite(configuredWidth)
        ? configuredWidth
        : 10;
    const height = typeof configuredHeight === "number" && Number.isFinite(configuredHeight)
        ? configuredHeight
        : -1;
    return { widthOrRange, height };
}

function objectTiles(object: any, tileOccupation?: any): any[] {
    if (object?.tile && tileOccupation?.calculateTilesForGameObject) {
        try {
            const tiles = tileOccupation.calculateTilesForGameObject(object.tile, object);
            if (Array.isArray(tiles) && tiles.length) return tiles;
        }
        catch {
            // A diagnostic/test double may not implement full foundation data.
        }
    }
    const tile = object?.centerTile ?? object?.tile;
    return tile ? [tile] : [];
}

/**
 * Equivalent of Antares' for_each_in_rect_or_range selection.  Occupied
 * cells are considered for multi-cell technos, so a building/object is
 * selected when any of its cells intersects the effect area.
 */
export function isSonarPulseInRange(
    center: TileCoord | undefined,
    object: any,
    range: SonarPulseRange,
    tileOccupation?: any,
): boolean {
    if (range.widthOrRange < 0) return true;
    if (!center) return false;

    const tiles = objectTiles(object, tileOccupation);
    if (!tiles.length) return false;

    if (range.height > 0) {
        const width = Math.max(0, Math.trunc(range.widthOrRange));
        const height = Math.max(0, Math.trunc(range.height));
        if (width <= 0 || height <= 0) return false;
        const left = center.rx - Math.trunc(width / 2);
        const top = center.ry - Math.trunc(height / 2);
        const right = left + width;
        const bottom = top + height;
        return tiles.some(tile => tile.rx >= left && tile.rx < right && tile.ry >= top && tile.ry < bottom);
    }

    const radiusSquared = range.widthOrRange * range.widthOrRange;
    return tiles.some(tile => {
        const dx = tile.rx - center.rx;
        const dy = tile.ry - center.ry;
        return dx * dx + dy * dy <= radiusSquared;
    });
}

interface SonarPulseGame {
    alliances: { areAllied(player1: any, player2: any): boolean };
    map: {
        getTileZone(tile: any): any;
        tileOccupation?: any;
    };
    getWorld(): { getAllObjects(): any[] };
    events: { dispatch(event: any): void };
    traits?: { find?(type: any): any; get?(type: any): any };
}

/**
 * Ares Type=SonarPulse.  This is deliberately a standalone effect instead
 * of a unit/profile special case: any content-defined superweapon with this
 * type receives the same house, terrain, range, and cloak semantics.
 */
export class SonarPulseEffect extends SuperWeaponEffect {
    private readonly range: SonarPulseRange;
    private readonly delay: number;
    private readonly affectsHouse: string;
    private readonly affectsTarget: string;
    private readonly createRadarEvent: boolean;

    constructor(
        type: string,
        owner: Player,
        tile: TileCoord,
        swRange?: readonly number[],
        affectsHouse: string = "Enemies",
        affectsTarget: string = "Water",
        delay: number = 60,
        createRadarEvent: boolean = false,
    ) {
        super(type, owner, tile);
        this.range = resolveSonarPulseRange(swRange);
        this.affectsHouse = affectsHouse || "Enemies";
        this.affectsTarget = affectsTarget || "Water";
        this.delay = Math.max(0, Math.floor(Number.isFinite(delay) ? delay : 60));
        this.createRadarEvent = createRadarEvent;
    }

    onStart(game: Game): void {
        const runtime = game as unknown as SonarPulseGame;
        const filter = createAresSuperWeaponTargetFilter(
            this.affectsHouse,
            this.affectsTarget,
            this.owner,
            runtime,
        );
        const center = this.tile;

        for (const object of runtime.getWorld().getAllObjects()) {
            if (object?.isTechno?.() !== true) continue;
            const targetTile = object.centerTile ?? object.tile;
            if (!filter(object, targetTile)) continue;
            if (!isSonarPulseInRange(center, object, this.range, runtime.map.tileOccupation)) continue;

            const cloakable = object.cloakableTrait;
            if (!cloakable) continue;

            // Antares starts CloakSkipTimer for every eligible techno, not
            // only for currently cloaked objects. This prevents an eligible
            // unit that was already visible from recloaking immediately.
            if (typeof cloakable.forceUncloak === "function") {
                const existing = cloakable.getCloakSkipTimeLeft?.() ?? 0;
                cloakable.forceUncloak(runtime, Math.max(existing, this.delay));
            }
            else {
                // Compatibility for older runtime objects created before the
                // generic CloakableTrait method existed.
                cloakable.uncloak?.(runtime);
            }
        }

        // Antares suppresses this event for full-map sonar. The local radar
        // trait may not yet have a slot for the Ares event type, so prefer its
        // normal deduplicating path and retain a safe event-bus fallback.
        if (this.createRadarEvent && this.range.widthOrRange >= 0) {
            // Traits.get throws when a lightweight host/test does not mount
            // the radar trait; find() preserves the safe optional behavior.
            const radarTrait = runtime.traits?.find?.(RadarTrait);
            if (radarTrait?.addEventForPlayer) {
                try {
                    radarTrait.addEventForPlayer(RadarEventType.SuperweaponActivated, this.owner, this.tile, runtime);
                    return;
                }
                catch {
                    // Continue with a visible event when vanilla radar tables
                    // do not define the extension event slot.
                }
            }
            runtime.events.dispatch(new RadarEvent(this.owner, RadarEventType.SuperweaponActivated, this.tile));
        }
    }
}
