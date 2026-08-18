import { NotifySpawn } from "@/game/trait/interface/NotifySpawn";
import { NotifyUnspawn } from "@/game/trait/interface/NotifyUnspawn";
import { NotifyPower } from "@/game/trait/interface/NotifyPower";
import { NotifyTick } from "@/game/trait/interface/NotifyTick";
import { PowerTrait, PowerLevel } from "@/game/player/trait/PowerTrait";
import { RadarOnOffEvent } from "@/game/event/RadarOnOffEvent";
import { NotifyOwnerChange } from "@/game/trait/interface/NotifyOwnerChange";
import { RangeHelper } from "@/game/gameobject/unit/RangeHelper";
import { RadarRules, RadarEventType } from "@/game/rules/general/RadarRules";
import { RadarEvent } from "@/game/event/RadarEvent";
import { NotifyAttack } from "@/game/trait/interface/NotifyAttack";
import { NotifyWarpChange } from "@/game/trait/interface/NotifyWarpChange";
import { NotifySuperWeaponActivate } from "@/game/trait/interface/NotifySuperWeaponActivate";
import { SuperWeaponType } from "@/game/type/SuperWeaponType";
import { NotifySuperWeaponDeactivate } from "@/game/trait/interface/NotifySuperWeaponDeactivate";
import {
    getAresRadarJamRadius,
    hasOperationalAresRadarProvider,
} from "@/extensions/ares/AresRadarJammer";
export class RadarTrait {
    private activeLightningStrikes: Map<any, number>;
    /** Moving RadarJamRadius technos require range re-evaluation. */
    private nextJammerRefreshTick = 0;
    constructor() {
        this.activeLightningStrikes = new Map();
    }
    [NotifySpawn.onSpawn](entity: any, game: any): void {
        if (entity.isBuilding() && entity.rules.radar) {
            this.updateRadarForPlayer(entity.owner, game);
        }
        if (getAresRadarJamRadius(entity) > 0) {
            this.updateHostileRadars(entity.owner, game);
        }
    }
    [NotifyUnspawn.onUnspawn](entity: any, game: any): void {
        if (entity.isBuilding() && entity.rules.radar) {
            this.updateRadarForPlayer(entity.owner, game);
        }
        if (getAresRadarJamRadius(entity) > 0) {
            this.updateHostileRadars(entity.owner, game);
        }
    }
    [NotifyPower.onPowerLow](player: any, game: any): void {
        this.updateRadarForPlayer(player, game);
    }
    [NotifyPower.onPowerRestore](player: any, game: any): void {
        this.updateRadarForPlayer(player, game);
    }
    [NotifyPower.onPowerChange](): void { }
    [NotifyOwnerChange.onChange](entity: any, oldOwner: any, game: any): void {
        if (entity.rules.radar) {
            this.updateRadarForPlayer(oldOwner, game);
            this.updateRadarForPlayer(entity.owner, game);
        }
        if (getAresRadarJamRadius(entity) > 0) {
            this.updateHostileRadars(oldOwner, game);
            this.updateHostileRadars(entity.owner, game);
        }
    }
    [NotifyWarpChange.onChange](entity: any, game: any): void {
        if (entity.rules.radar) {
            this.updateRadarForPlayer(entity.owner, game);
        }
        if (getAresRadarJamRadius(entity) > 0) {
            this.updateHostileRadars(entity.owner, game);
        }
    }
    [NotifyTick.onTick](game: any): void {
        // Radar jammers can move. Recompute at a bounded deterministic cadence
        // instead of doing an O(radars * technos) scan from every movement
        // sub-step. Five simulation ticks is short enough that the UI change is
        // effectively immediate while remaining cheap in large battles.
        if (game.currentTick < this.nextJammerRefreshTick) return;
        this.nextJammerRefreshTick = game.currentTick + 5;
        for (const player of game.getCombatants()) {
            this.updateRadarForPlayer(player, game);
        }
    }
    [NotifySuperWeaponActivate.onActivate](type: SuperWeaponType, player: any, game: any): void {
        if (type === SuperWeaponType.LightningStorm) {
            this.activeLightningStrikes.set(player, (this.activeLightningStrikes.get(player) ?? 0) + 1);
            for (const combatant of game.getCombatants()) {
                if (combatant !== player && !game.alliances.areAllied(combatant, player)) {
                    this.updateRadarForPlayer(combatant, game);
                }
            }
        }
    }
    [NotifySuperWeaponDeactivate.onDeactivate](type: SuperWeaponType, player: any, game: any): void {
        if (type === SuperWeaponType.LightningStorm) {
            const count = (this.activeLightningStrikes.get(player) ?? 0) - 1;
            if (count > 0) {
                this.activeLightningStrikes.set(player, count);
            }
            else {
                this.activeLightningStrikes.delete(player);
            }
            if (count <= 0) {
                for (const combatant of game.getCombatants()) {
                    this.updateRadarForPlayer(combatant, game);
                }
            }
        }
    }
    private updateHostileRadars(owner: any, game: any): void {
        for (const combatant of game.getCombatants()) {
            if (combatant !== owner && !game.alliances.areAllied(combatant, owner)) {
                this.updateRadarForPlayer(combatant, game);
            }
        }
    }
    private updateRadarForPlayer(player: any, game: any): void {
        if (!player.radarTrait)
            return;
        const wasDisabled = player.radarTrait.isDisabled();
        const batteryKeepsRadarOnline = player.powerTrait?.isAresBatteryActive?.() === true;
        const hasUnjammedRadar = hasOperationalAresRadarProvider(
            player,
            game,
            (building: any) => building.rules.radar,
        );
        const shouldDisable = !hasUnjammedRadar ||
            (player.powerTrait.level === PowerLevel.Low && !batteryKeepsRadarOnline) ||
            [...this.activeLightningStrikes.entries()].some(([strikePlayer, count]) => count && strikePlayer !== player && !game.alliances.areAllied(strikePlayer, player));
        player.radarTrait.setDisabled(shouldDisable);
        if (wasDisabled !== shouldDisable) {
            game.events.dispatch(new RadarOnOffEvent(player, !shouldDisable));
        }
    }
    [NotifyAttack.onAttack](attacker: any, target: any, game: any, warheadRules?: any): void {
        if (!attacker.isTechno())
            return;
        // Ares Malicious=no suppresses the harvester EVA attack warning
        // (ore miner attacks from non-malicious warheads stay silent).
        if (warheadRules?.malicious === false && attacker.isVehicle() && attacker.harvesterTrait) {
            return;
        }
        if (!attacker.isBuilding() || attacker.rules.canBeOccupied || attacker.rules.needsEngineer) {
            if (attacker.isVehicle() && attacker.harvesterTrait) {
                this.addEventForPlayer(RadarEventType.HarvesterUnderAttack, attacker.owner, attacker.tile, game);
            }
        }
        else {
            this.addEventForPlayer(RadarEventType.BaseUnderAttack, attacker.owner, attacker.tile, game);
        }
    }
    public addEventForPlayer(
        eventType: RadarEventType,
        player: any,
        tile: any,
        game: any,
        metadata?: {
            superWeaponRules?: any;
            superWeaponOwner?: any;
        },
    ): void {
        const radarTrait = player.radarTrait;
        if (!radarTrait)
            return;
        const radarRules = game.rules.general.radar;
        radarTrait.activeEvents = radarTrait.activeEvents.filter((event: any) => game.currentTick - event.startTick < radarRules.getEventDuration(event.type));
        const rangeHelper = new RangeHelper(game.map.tileOccupation);
        const hasExistingEvent = radarTrait.activeEvents.find((event: any) => event.type === eventType &&
            rangeHelper.isInTileRange(tile, event.tile, 0, radarRules.getEventSuppresionDistance(event.type)));
        if (!hasExistingEvent) {
            radarTrait.activeEvents.push({
                startTick: game.currentTick,
                tile: tile,
                type: eventType,
                ...metadata,
            });
            game.events.dispatch(new RadarEvent(player, eventType, tile, metadata));
        }
    }
}
