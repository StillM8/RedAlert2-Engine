import { DeactivateSuperWeaponAction } from "@/game/action/DeactivateSuperWeaponAction";
import { Game } from "@/game/Game";

export class DeactivateSuperWeaponActionFactory {
    constructor(private readonly game: Game) {}

    create(): DeactivateSuperWeaponAction {
        return new DeactivateSuperWeaponAction(this.game);
    }
}
