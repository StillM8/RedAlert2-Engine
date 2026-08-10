import { ObjectType } from "@/engine/type/ObjectType";
import { RadialTileFinder } from "@/game/map/tileFinder/RadialTileFinder";
import { SuperWeaponEffect, TileCoord } from "@/game/superweapon/SuperWeaponEffect";
import { Game } from "@/game/Game";
import { Player } from "@/game/Player";
import {
    isAresSuperWeaponInRange,
    resolveAresSuperWeaponRange,
} from "@/game/superweapon/AresSuperWeaponRange";

// Retail hardcodes the mutation product in the exe: every infantry in the
// area becomes a Brute owned by the player who fired.
const MUTATION_PRODUCT = "BRUTE";
const DEFAULT_RANGE = 4;

/** Yuri's Genetic Mutator. */
export class GeneticConverterEffect extends SuperWeaponEffect {
    private readonly range: number;
    private readonly superWeaponRange?: readonly number[];

    constructor(
        type: any,
        owner: Player,
        tile: TileCoord,
        range?: number,
        superWeaponRange?: readonly number[],
    ) {
        super(type, owner, tile);
        this.range = range && range > 0 ? range : DEFAULT_RANGE;
        this.superWeaponRange = superWeaponRange?.slice();
    }

    onStart(game: Game): void {
        if (!game.rules.hasObject(MUTATION_PRODUCT, ObjectType.Infantry)) {
            console.warn(`Mutation product "${MUTATION_PRODUCT}" missing from rules, skipping.`);
            return;
        }
        const bruteRules = game.rules.getObject(MUTATION_PRODUCT, ObjectType.Infantry);
        const victims: any[] = [];
        if (this.superWeaponRange !== undefined) {
            const range = resolveAresSuperWeaponRange(this.superWeaponRange, {
                widthOrRange: 3,
                height: 3,
            });
            for (const object of (game as any).getWorld().getAllObjects()) {
                if (object.isInfantry() &&
                    !object.isDestroyed &&
                    !object.rules.missileSpawn &&
                    object.name !== MUTATION_PRODUCT &&
                    isAresSuperWeaponInRange(this.tile, object, range, (game as any).map.tileOccupation)) {
                    victims.push(object);
                }
            }
        }
        else {
            const tileFinder = new RadialTileFinder(game.map.tiles, game.map.mapBounds, this.tile, { width: 1, height: 1 }, 0, Math.max(0, Math.ceil(this.range)), () => true);
            let tile;
            while ((tile = tileFinder.getNextTile())) {
                for (const object of game.map.getGroundObjectsOnTile(tile)) {
                    if (object.isInfantry() &&
                        object.tile === tile &&
                        !object.isDestroyed &&
                        !object.rules.missileSpawn &&
                        object.name !== MUTATION_PRODUCT) {
                        victims.push(object);
                    }
                }
            }
        }
        for (const victim of victims) {
            const homeTile = victim.tile;
            // Immediate destroy: mutation vaporizes the body without death
            // weapons or chain explosions.
            game.destroyObject(victim, { player: this.owner }, true);
            const brute = (game as any).createUnitForPlayer(bruteRules, this.owner);
            let fallbackTile: any;
            const spawnTile = new RadialTileFinder(game.map.tiles, game.map.mapBounds, homeTile, { width: 1, height: 1 }, 0, 2, (candidate: any) => {
                const isValid = game.map.terrain.getPassableSpeed(candidate, brute.rules.speedType, true, false) > 0 &&
                    Math.abs(candidate.z - homeTile.z) < 2 &&
                    !game.map.terrain.findObstacles({ tile: candidate, onBridge: undefined }, brute).length;
                if (!fallbackTile && isValid) {
                    fallbackTile = candidate;
                }
                return isValid;
            }).getNextTile() ?? fallbackTile ?? homeTile;
            game.spawnObject(brute, spawnTile);
        }
    }
}
