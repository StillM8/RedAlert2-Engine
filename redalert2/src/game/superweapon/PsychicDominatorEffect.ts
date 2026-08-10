import { Coords } from "@/game/Coords";
import { CollisionType } from "@/game/gameobject/unit/CollisionType";
import { RadialTileFinder } from "@/game/map/tileFinder/RadialTileFinder";
import { TriggerAnimEvent } from "@/game/event/TriggerAnimEvent";
import { Warhead } from "@/game/Warhead";
import { SuperWeaponEffect } from "@/game/superweapon/SuperWeaponEffect";
import { Game } from "@/game/Game";

// The psychic storm builds above the target for a moment before the blast
// lands (~3s at the base 15 ticks/s).
const DEFERMENT_TICKS = 45;
// Dominated units shrug off the accompanying blast.
const BLAST_SHIELD_TICKS = 30;

function normalizeDeferment(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
}

/**
 * Yuri's Psychic Dominator: a warhead blast at the epicenter plus permanent
 * capture of every non-psionic-immune unit around it. Tuning comes from the
 * retail [General] Dominator* keys.
 */
export class PsychicDominatorEffect extends SuperWeaponEffect {
    private ticksLeft = DEFERMENT_TICKS;
    private initialDeferment: number;

    constructor(
        type: any,
        owner: any,
        tile: any,
        superWeaponDeferment?: number,
    ) {
        super(type, owner, tile);
        this.initialDeferment = normalizeDeferment(superWeaponDeferment);
    }

    onStart(game: Game): void {
        if (this.initialDeferment <= 0) {
            game.events.dispatch(new TriggerAnimEvent("PDFXCLD", this.tile));
        }
    }

    onTick(game: Game): boolean {
        if (this.initialDeferment > 0) {
            this.initialDeferment--;
            if (this.initialDeferment > 0) {
                return false;
            }
            // The Ares deferment is before the first Dominator animation; the
            // existing 45-tick counter remains the retail animation/build-up
            // timing after that animation has been created.
            game.events.dispatch(new TriggerAnimEvent("PDFXCLD", this.tile));
        }
        if (this.ticksLeft-- > 0) {
            return false;
        }
        game.events.dispatch(new TriggerAnimEvent("PDFXLOC", this.tile));
        // Retail dominates first: the newly captured units visibly survive
        // the blast that levels everything else around them.
        const captured = this.captureUnits(game);
        for (const object of captured) {
            object.invulnerableTrait?.setActiveFor(BLAST_SHIELD_TICKS, game.currentTick);
        }
        this.detonate(game);
        return true;
    }

    private detonate(game: Game): void {
        const general = (game.rules as any).ini.getSection("General");
        const warheadName = general?.getString("DominatorWarhead") || "DominatorWH";
        const damage = general?.getNumber("DominatorDamage", 1000) ?? 1000;
        let warheadRules;
        try {
            warheadRules = game.rules.getWarhead(warheadName);
        }
        catch (error) {
            console.warn(`Dominator warhead "${warheadName}" not found, skipping blast.`);
            return;
        }
        const warhead = new Warhead(warheadRules);
        const tile = this.tile;
        const bridge = game.map.tileOccupation.getBridgeOnTile(tile);
        const elevation = bridge?.tileElevation ?? 0;
        const zone = game.map.getTileZone(tile);
        warhead.detonate(game as any, damage, tile, elevation, Coords.tile3dToWorld(tile.rx + 0.5, tile.ry + 0.5, tile.z + elevation), zone, bridge ? CollisionType.OnBridge : CollisionType.None, game.createTarget(bridge, tile), { player: this.owner, weapon: undefined } as any, false, undefined, undefined, true);
    }

    private captureUnits(game: Game): any[] {
        const general = (game.rules as any).ini.getSection("General");
        const captureRange = general?.getNumber("DominatorCaptureRange", 1) ?? 1;
        const captured: any[] = [];
        const tileFinder = new RadialTileFinder(game.map.tiles, game.map.mapBounds, this.tile, { width: 1, height: 1 }, 0, Math.max(0, Math.ceil(captureRange)), () => true);
        let tile;
        while ((tile = tileFinder.getNextTile())) {
            for (const object of game.map.getGroundObjectsOnTile(tile)) {
                if (!object.isUnit() ||
                    object.tile !== tile ||
                    object.isDestroyed ||
                    object.owner === this.owner ||
                    object.rules.immuneToPsionics ||
                    object.rules.slaved ||
                    object.rules.missileSpawn) {
                    continue;
                }
                const controllable = object.mindControllableTrait;
                if (controllable?.isActive()) {
                    controllable.getController()?.mindControllerTrait?.cleanTarget(object);
                }
                controllable?.makePermanent();
                game.changeObjectOwner(object, this.owner);
                captured.push(object);
            }
        }
        return captured;
    }
}
