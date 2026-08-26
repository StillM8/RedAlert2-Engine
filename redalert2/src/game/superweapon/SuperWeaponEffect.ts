import type { Game } from "@/game/Game";
import type { Player } from "@/game/Player";
import { fnv32aStrings } from "@/util/math";
export type TileCoord = any;
export enum EffectStatus {
    NotStarted = 0,
    Running = 1,
    Finished = 2
}
export abstract class SuperWeaponEffect {
    public type: any;
    public owner: Player;
    public tile: any;
    public status: EffectStatus;
    constructor(type: any, owner: Player, tile: any) {
        this.type = type;
        this.owner = owner;
        this.tile = tile;
        this.status = EffectStatus.NotStarted;
    }
    abstract onStart(game: Game): void;
    onTick(game: Game): boolean {
        return true;
    }
    /**
     * Canonical state fingerprint for the active-effect list. The base covers
     * identity (type/owner/target/status); every subclass holding mutable
     * tick state MUST override and mix it in — an active effect whose
     * internal phase/timers differ between peers changes future ticks.
     */
    getHash(): number {
        return fnv32aStrings([
            "SuperWeaponEffect",
            String(this.type),
            this.owner?.playerListIndex ?? -1,
            this.tile?.rx ?? -1,
            this.tile?.ry ?? -1,
            this.status,
        ]);
    }
}
