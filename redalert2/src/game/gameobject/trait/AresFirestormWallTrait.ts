import { NotifySpawn } from "@/game/gameobject/trait/interface/NotifySpawn";
import { NotifyTick } from "@/game/gameobject/trait/interface/NotifyTick";
import { NotifyUnspawn } from "@/game/gameobject/trait/interface/NotifyUnspawn";
import {
    getAresFirestormConnectionMask,
    isAresActiveFirestormWall,
    isAresFirestormWall,
} from "@/extensions/ares/AresFirestorm";
import { Warhead } from "@/game/Warhead";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { AresFirestormWallStateChangeEvent } from "@/game/event/AresFirestormWallStateChangeEvent";
import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { fnv32aStrings } from "@/util/math";

export const ARES_FIRESTORM_WALL_STATE_VERSION = 1 as const;

/** Versioned state for the wall's active latch and flicker cooldown. */
export interface AresFirestormWallState {
    readonly version: typeof ARES_FIRESTORM_WALL_STATE_VERSION;
    /**
     * Last known active state. Derived from the charge-drain superweapon,
     * but the state-change event fires only on transitions, so the previous
     * value decides whether a dispatch happens after a snapshot restore.
     */
    readonly active: boolean;
    /**
     * Remaining frames before the wall may consume the game RNG again for a
     * wall-flicker roll. Because it gates `generateRandom` consumption, a
     * diverged cooldown desynchronizes the entire deterministic RNG stream.
     */
    readonly flickerCooldownTicks: number;
}

/**
 * Runtime state for a BuildingType with Firestorm.Wall=yes.
 *
 * This is deliberately a normal building trait: the standalone engine does
 * not need Antares' map hooks to connect walls, maintain contact effects, or
 * keep the presentation-facing connection mask up to date.
 */
export class AresFirestormWallTrait implements NotifySpawn, NotifyUnspawn, NotifyTick {
    private active = false;
    private flickerCooldownTicks = 0;

    [NotifySpawn.onSpawn](building: any, game: any): void {
        this.updateConnections(building, game.map);
    }

    [NotifyUnspawn.onUnspawn](building: any, game: any): void {
        const neighbours = this.getNeighbours(building, game.map);
        building.firestormConnectionMask = 0;
        for (const neighbour of neighbours) {
            this.updateConnections(neighbour, game.map);
        }
    }

    [NotifyTick.onTick](building: any, game: any): void {
        const active = isAresActiveFirestormWall(building);
        if (active !== this.active) {
            this.active = active;
            game.events.dispatch(new AresFirestormWallStateChangeEvent(building, active));
        }
        if (!active) return;
        this.immolateVictims(building, game);
        this.maybePlayWallFlicker(building, game);
    }

    /**
     * Ares documents FirestormActiveAnim/FirestormIdleAnim as randomly-played
     * animations on wall sections.  Keep the random decision in the simulation
     * so it uses the deterministic game RNG, and dispatch a transient
     * TriggerAnimEvent that the existing render-side FX handler consumes.
     */
    private maybePlayWallFlicker(building: any, game: any): void {
        if (this.flickerCooldownTicks > 0) {
            this.flickerCooldownTicks--;
            return;
        }
        const audioVisual = game.rules?.audioVisual;
        const animName = this.active
            ? audioVisual?.firestormActiveAnim
            : audioVisual?.firestormIdleAnim;
        if (!animName) return;
        const chance = 0.04;
        if (game.generateRandom?.() < chance) {
            game.events.dispatch(new TriggerAnimEvent(
                animName,
                building.tile,
                undefined,
                building.owner,
                building,
            ));
            this.flickerCooldownTicks = 15;
        }
    }

    getHash(): number {
        return fnv32aStrings([
            "AresFirestormWallTrait",
            this.active ? 1 : 0,
            this.flickerCooldownTicks,
        ]);
    }

    serializeState(): AresFirestormWallState {
        return {
            version: ARES_FIRESTORM_WALL_STATE_VERSION,
            active: this.active,
            flickerCooldownTicks: this.flickerCooldownTicks,
        };
    }

    /**
     * Replaces both fields only after the payload validates. An invalid
     * payload throws instead of mutating, so a corrupt snapshot cannot leave
     * the trait half-restored.
     */
    restoreState(state: unknown): void {
        if (typeof state !== "object" || state === null) {
            throw new Error("Invalid Ares Firestorm wall state: expected an object");
        }
        const candidate = state as Record<string, unknown>;
        if (candidate.version !== ARES_FIRESTORM_WALL_STATE_VERSION) {
            throw new Error(`Unsupported Ares Firestorm wall state version: ${String(candidate.version)}`);
        }
        if (typeof candidate.active !== "boolean") {
            throw new Error("Invalid Ares Firestorm wall state: active must be a boolean");
        }
        const cooldown = candidate.flickerCooldownTicks;
        if (!Number.isSafeInteger(cooldown) || (cooldown as number) < 0) {
            throw new Error("Invalid Ares Firestorm wall state: flickerCooldownTicks must be a non-negative integer");
        }
        this.active = candidate.active;
        this.flickerCooldownTicks = cooldown as number;
    }

    private updateConnections(building: any, map: any): void {
        if (!isAresFirestormWall(building)) {
            building.firestormConnectionMask = 0;
            return;
        }
        building.firestormConnectionMask = getAresFirestormConnectionMask(building, {
            getTileByMapCoords: (x: number, y: number) => map.tiles.getByMapCoords(x, y),
            getObjectsOnTile: (tile: any) => map.getObjectsOnTile(tile),
        });
        for (const neighbour of this.getNeighbours(building, map)) {
            if (isAresFirestormWall(neighbour) && neighbour.owner === building.owner) {
                neighbour.firestormConnectionMask = getAresFirestormConnectionMask(neighbour, {
                    getTileByMapCoords: (x: number, y: number) => map.tiles.getByMapCoords(x, y),
                    getObjectsOnTile: (tile: any) => map.getObjectsOnTile(tile),
                });
            }
        }
    }

    private getNeighbours(building: any, map: any): any[] {
        if (!building?.tile) return [];
        const neighbours: any[] = [];
        for (const direction of [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 },
        ]) {
            const tile = map.tiles.getByMapCoords(
                building.tile.rx + direction.x,
                building.tile.ry + direction.y,
            );
            if (!tile) continue;
            const neighbour = map.getObjectsOnTile(tile).find((object: any) =>
                object.isBuilding?.() &&
                isAresFirestormWall(object),
            );
            if (neighbour) neighbours.push(neighbour);
        }
        return neighbours;
    }

    private immolateVictims(building: any, game: any): void {
        const tiles = game.map.tileOccupation.calculateTilesForGameObject(
            building.tile,
            building,
        );
        const affected = new Set<any>();
        for (const tile of tiles) {
            for (const object of game.map.getObjectsOnTile(tile)) {
                if (affected.has(object) || !this.isVictim(object, building)) continue;
                affected.add(object);
                this.immolateVictim(building, object, tile, game);
            }
        }
    }

    private isVictim(object: any, wall: any): boolean {
        return object !== wall &&
            object.isUnit?.() === true &&
            object.isBuilding?.() !== true &&
            object.isDestroyed !== true &&
            object.isCrashing !== true &&
            object.isSpawned !== false &&
            object.rules?.ignoresFirestorm !== true &&
            !!object.healthTrait;
    }

    private immolateVictim(wall: any, victim: any, tile: any, game: any): void {
        const warheadName = game.rules.combatDamage.firestormWarhead ||
            game.rules.combatDamage.c4Warhead;
        let warheadRules: any;
        try {
            warheadRules = game.rules.getWarhead(warheadName);
        }
        catch {
            console.warn(`Firestorm wall references missing warhead "${warheadName}"; contact effect skipped.`);
            return;
        }
        const warhead = new Warhead(warheadRules);
        const zone = victim.zone ?? game.map.getTileZone(tile);
        if (!warhead.canDamage(victim, tile, zone)) return;
        const damage = warhead.computeDamage(victim.healthTrait.getHitPoints(), victim, game);
        if (damage <= 0) return;
        warhead.inflictDamage(damage, victim, {
            player: wall.owner,
            obj: wall,
        } as any, game, true);
        const animation = zone === ZoneType.Air
            ? game.rules.audioVisual.firestormAirAnim
            : game.rules.audioVisual.firestormGroundAnim;
        if (animation) {
            game.events.dispatch(new TriggerAnimEvent(
                animation,
                tile,
                undefined,
                wall.owner,
                wall,
            ));
        }
    }
}
