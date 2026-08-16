import { RadarEventType } from "@/game/rules/general/RadarRules";
import { RadarTrait } from "@/game/trait/RadarTrait";

export interface AresSuperWeaponRadarGame {
    getCombatants(): any[];
    traits?: { find?(type: any): any };
}

/**
 * Emits the common Ares SW.CreateRadarEvent notification for every active
 * combatant. RadarTrait owns suppression, duration, and the host event bus;
 * this helper only translates the Ares launch flag into that existing API.
 */
export function createAresSuperWeaponRadarEvent(
    tile: any,
    game: AresSuperWeaponRadarGame,
    superWeaponRules?: any,
    superWeaponOwner?: any,
): number {
    const radarTrait = game.traits?.find?.(RadarTrait);
    if (!radarTrait?.addEventForPlayer) return 0;

    let recipients = 0;
    for (const player of game.getCombatants()) {
        radarTrait.addEventForPlayer(
            RadarEventType.SuperweaponActivated,
            player,
            tile,
            game,
            { superWeaponRules, superWeaponOwner },
        );
        recipients++;
    }
    return recipients;
}
