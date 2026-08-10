import { SuperWeaponEffect } from "@/game/superweapon/SuperWeaponEffect";
import {
    resolveAresSuperWeaponRange,
} from "@/game/superweapon/AresSuperWeaponRange";
import type { Game } from "@/game/Game";

// Retail hardcodes the reveal radius (no [General] key in rulesmd).
const REVEAL_RADIUS = 10;

/** Yuri's Psychic Reveal (Psychic Sensor): uncovers shroud around the target. */
export class PsychicRevealEffect extends SuperWeaponEffect {
    constructor(type: any, owner: any, tile: any, superWeaponRange?: readonly number[]) {
        super(type, owner, tile);
        this.superWeaponRange = superWeaponRange?.slice();
    }

    private readonly superWeaponRange?: readonly number[];

    onStart(game: Game): void {
        const shroud = (game as any).mapShroudTrait?.getPlayerShroud?.(this.owner);
        if (!shroud) return;

        const range = resolveAresSuperWeaponRange(this.superWeaponRange, {
            widthOrRange: REVEAL_RADIUS,
            height: -1,
        });
        if (typeof shroud.revealArea === "function") {
            shroud.revealArea(this.tile, range.widthOrRange, range.height);
        }
        else if (range.widthOrRange < 0) {
            shroud.revealAll?.();
        }
        else {
            // Compatibility with lightweight hosts that have not yet exposed
            // the rectangle-aware MapShroud API.
            shroud.revealAround?.(this.tile, range.widthOrRange);
        }
    }
}
