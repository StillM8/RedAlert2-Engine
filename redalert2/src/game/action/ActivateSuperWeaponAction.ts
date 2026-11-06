import { DataStream } from '@/data/DataStream';
import { Action } from '@/game/action/Action';
import { ActionType } from '@/game/action/ActionType';
import { SuperWeaponType } from '@/game/type/SuperWeaponType';
import { SuperWeaponsTrait } from '@/game/trait/SuperWeaponsTrait';
import { Game } from '@/game/Game';
import {
    isAresSuperWeaponActivationAllowed,
    isAresSuperWeaponFireIntoShroudAllowed,
    isAresSuperWeaponManualActivationAllowed,
} from '@/extensions/ares/AresSuperWeaponFilters';
import { isAresSuperWeaponLaunchAllowed } from '@/extensions/ares/AresSuperWeaponLaunch';
import {
    planAresSuperWeaponTargetFromWorld,
    resolveAresSuperWeaponTargetingProfile,
} from '@/extensions/ares/AresSuperWeaponAutoFire';
import { AresSuperWeaponMessageEvent } from '@/game/event/AresSuperWeaponMessageEvent';

/** Escape byte marking an extended uint16 superweapon action index. */
const EXTENDED_INDEX_ESCAPE = 0xff;
export class ActivateSuperWeaponAction extends Action {
    private game: Game;
    private superWeaponType: number;
    private tile: {
        x: number;
        y: number;
    };
    private tile2?: {
        x: number;
        y: number;
    };
    constructor(game: Game) {
        super(ActionType.ActivateSuperWeapon);
        this.game = game;
    }
    unserialize(data: Uint8Array): void {
        const stream = new DataStream(data);
        // 0xFF is the extended-index escape: legacy single-byte records encode
        // indexes 0-254 directly, so old records parse unchanged while mods
        // with 255+ superweapons round-trip instead of wrapping onto the wrong
        // weapon. (Legacy records for exactly index 255 predate the escape and
        // are the one documented edge case.)
        const first = stream.readUint8();
        this.superWeaponType = first === EXTENDED_INDEX_ESCAPE
            ? stream.readUint16()
            : first;
        const tileCount = stream.readUint8();
        this.tile = {
            x: stream.readUint16(),
            y: stream.readUint16()
        };
        if (tileCount > 2) {
            this.tile2 = {
                x: stream.readUint16(),
                y: stream.readUint16()
            };
        }
    }
    serialize(): Uint8Array {
        const wide = this.superWeaponType > 254;
        const stream = new DataStream((wide ? 8 : 6) + (this.tile2 ? 4 : 0));
        stream.dynamicSize = false;
        if (wide) {
            stream.writeUint8(EXTENDED_INDEX_ESCAPE);
            stream.writeUint16(this.superWeaponType);
        }
        else {
            stream.writeUint8(this.superWeaponType);
        }
        stream.writeUint8(this.tile2 ? 4 : 2);
        stream.writeUint16(this.tile.x);
        stream.writeUint16(this.tile.y);
        if (this.tile2) {
            stream.writeUint16(this.tile2.x);
            stream.writeUint16(this.tile2.y);
        }
        return stream.toUint8Array();
    }
    print(): string {
        const rules = this.game.rules.getSuperWeaponByIndex(this.superWeaponType);
        const typeName = rules?.typeId ?? (rules?.type !== undefined ? SuperWeaponType[rules.type] : `index ${this.superWeaponType}`);
        return `Activate SuperW ${typeName} at tile (${this.tile.x}, ${this.tile.y})` +
            (this.tile2 ? `, (${this.tile2.x}, ${this.tile2.y})` : '');
    }
    process(): void {
        const player = this.player;
        let tile = this.game.map.tiles.getByMapCoords(this.tile.x, this.tile.y);
        if (!tile) {
            console.warn(`Tile ${this.tile.x},${this.tile.y} doesn't exist`);
            return;
        }
        const tile2 = this.tile2
            ? this.game.map.tiles.getByMapCoords(this.tile2.x, this.tile2.y)
            : undefined;
        // ChronoSphere requires a destination: a stale/off-map tile2 would
        // throw inside deterministic tick processing (crash/desync) — drop
        // the malformed action instead.
        const rules = this.game.rules.getSuperWeaponByIndex(this.superWeaponType);
        if (!rules) {
            console.warn(`Superweapon index ${this.superWeaponType} doesn't exist; ignored`);
            return;
        }
        if (rules.ares?.swUseAITargeting === true && !this.tile2) {
            const profile = resolveAresSuperWeaponTargetingProfile(rules);
            const superWeapons = this.game.traits?.get?.(SuperWeaponsTrait);
            const underAttack = typeof (player as any)?.isUnderAttack === "function"
                ? (player as any).isUnderAttack()
                : (player as any)?.isUnderAttack === true || (player as any)?.underAttack === true;
            const selected = profile.supported
                ? planAresSuperWeaponTargetFromWorld(this.game, player, rules, {
                    underAttack,
                    lightningStormActive: superWeapons?.hasActiveEffect?.(SuperWeaponType.LightningStorm),
                    psychicDominatorActive: superWeapons?.hasActiveEffect?.(SuperWeaponType.PsychicDominator),
                })
                : undefined;
            const selectedTile = selected
                ? this.game.map.tiles.getByMapCoords(selected.x, selected.y)
                : undefined;
            if (!selectedTile) {
                console.warn(`Superweapon ${rules.name} has no AI-selected target; ignored`);
                this.notifyAresCannotFire(rules, tile);
                return;
            }
            tile = selectedTile;
        }
        if (rules.ares && !isAresSuperWeaponManualActivationAllowed(
            rules.ares.swAutoFire,
            rules.ares.swManualFire,
            this.player,
        )) {
            console.warn(`Superweapon ${rules.name} is auto-fire only; manual activation ignored`);
            return;
        }
        if (rules.type === SuperWeaponType.ChronoSphere && !tile2) {
            console.warn(`ChronoSphere activation without a valid destination tile; ignored`);
            this.notifyAresCannotFire(rules, tile);
            return;
        }
        if (rules.ares && !isAresSuperWeaponLaunchAllowed(
            { name: rules.name, ...rules.ares },
            this.player,
            tile,
            this.game as any,
        )) {
            console.warn(`Superweapon ${rules.name} is outside its Ares launch range, lacks a designator, or is inhibited; ignored`);
            this.notifyAresCannotFire(rules, tile);
            return;
        }
        if (rules.ares && !isAresSuperWeaponActivationAllowed(
            rules.ares.swRequiresHouse,
            rules.ares.swRequiresTarget,
            this.player,
            tile,
            this.game as any,
        )) {
            console.warn(`Superweapon ${rules.name} target does not satisfy Ares SW.RequiresTarget/SW.RequiresHouse; ignored`);
            this.notifyAresCannotFire(rules, tile);
            return;
        }
        if (rules.ares && !isAresSuperWeaponFireIntoShroudAllowed(
            rules.ares.swFireIntoShroud,
            this.player,
            tile,
            this.game as any,
        )) {
            console.warn(`Superweapon ${rules.name} cannot fire into unexplored shroud; ignored`);
            this.notifyAresCannotFire(rules, tile);
            return;
        }
        this.game.traits
            .get(SuperWeaponsTrait)
            .activateSuperWeapon(this.superWeaponType, player, this.game, tile, tile2);
    }
    private notifyAresCannotFire(rules: any, tile: any): void {
        if (!rules?.ares || !this.game.events?.dispatch) return;
        this.game.events.dispatch(new AresSuperWeaponMessageEvent(
            "cannotFire",
            this.player,
            rules,
            tile,
        ));
    }
}
