import { DataStream } from "@/data/DataStream";
import { Action } from "@/game/action/Action";
import { ActionType } from "@/game/action/ActionType";
import { Game } from "@/game/Game";
import { SuperWeaponsTrait } from "@/game/trait/SuperWeaponsTrait";

export class DeactivateSuperWeaponAction extends Action {
    private superWeaponType = 0;

    constructor(private readonly game: Game) {
        super(ActionType.DeactivateSuperWeapon);
    }

    unserialize(data: Uint8Array): void {
        this.superWeaponType = new DataStream(data).readUint32();
    }

    serialize(): Uint8Array {
        const stream = new DataStream(4);
        stream.dynamicSize = false;
        stream.writeUint32(this.superWeaponType);
        return stream.toUint8Array();
    }

    print(): string {
        return `Deactivate SuperW ${this.superWeaponType}`;
    }

    process(): void {
        const player = this.player;
        if (!player || player.isObserver) return;
        const rules = this.game.rules?.getSuperWeaponByIndex?.(this.superWeaponType);
        if (!rules) return;
        const weapon = player.superWeaponsTrait?.getAll?.()
            .find((candidate: any) => candidate.rules?.index === this.superWeaponType);
        if (!weapon || (weapon.owner && weapon.owner !== player)) return;
        const trait = this.game.traits?.get?.(SuperWeaponsTrait);
        if (typeof trait?.deactivateSuperWeapon !== "function") return;
        trait.deactivateSuperWeapon(this.superWeaponType, player, this.game);
    }
}
