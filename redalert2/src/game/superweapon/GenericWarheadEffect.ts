import { Coords } from "@/game/Coords";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { Warhead } from "@/game/Warhead";
import { SuperWeaponEffect, type TileCoord } from "@/game/superweapon/SuperWeaponEffect";
import type { Game } from "@/game/Game";
import type { Player } from "@/game/Player";

/**
 * Ares Type=GenericWarhead. The configured warhead is detonated on the target
 * cell, not directly on a selected object. Ares-specific target filters are
 * intentionally kept in the parsed definition and are not silently treated
 * as implemented by this first runtime slice.
 */
export class GenericWarheadEffect extends SuperWeaponEffect {
    constructor(
        type: string,
        owner: Player,
        tile: TileCoord,
        private readonly damage: number,
        private readonly warheadName: string,
    ) {
        super(type, owner, tile);
    }

    onStart(game: Game): void {
        let warheadRules;
        try {
            warheadRules = game.rules.getWarhead(this.warheadName);
        }
        catch (error) {
            console.warn(`GenericWarhead superweapon references missing warhead "${this.warheadName}"; skipped.`);
            return;
        }
        const warhead = new Warhead(warheadRules);
        const tile = this.tile;
        const bridge = game.map.tileOccupation.getBridgeOnTile(tile);
        const elevation = bridge?.tileElevation ?? 0;
        const zone = game.map.getTileZone(tile);
        warhead.detonate(
            game as any,
            this.damage,
            tile,
            elevation,
            Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z + elevation),
            zone,
            bridge ? CollisionType.OnBridge : CollisionType.None,
            game.createTarget(bridge, tile),
            { player: this.owner, weapon: undefined } as any,
            false,
            undefined,
        );
    }
}
