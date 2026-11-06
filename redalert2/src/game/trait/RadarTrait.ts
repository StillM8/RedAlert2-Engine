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
import { fnv32aStrings } from "@/util/math";

type LightningRadarRelation = "owner" | "allies" | "enemies";

interface LightningRadarOutageSettings {
    readonly duration?: number;
    readonly deferment?: number;
    readonly affects?: string;
}

interface ActiveLightningRadarOutage {
    readonly owner: any;
    readonly startTick: number;
    readonly endTick: number;
    readonly affects: ReadonlySet<LightningRadarRelation>;
    active: boolean;
}

function normalizeLightningFrames(value: number | undefined): number {
    return Number.isFinite(value) ? Math.trunc(value!) : 0;
}

function parseLightningRadarRelations(value: string | undefined): ReadonlySet<LightningRadarRelation> {
    const relations = new Set<LightningRadarRelation>();
    for (const token of String(value ?? "enemies").toLocaleLowerCase("en-US").split(/[\s,|]+/)) {
        if (token === "owner") relations.add("owner");
        if (token === "allies") relations.add("allies");
        if (token === "enemies") relations.add("enemies");
        if (token === "team") {
            relations.add("owner");
            relations.add("allies");
        }
        if (token === "others" || token === "notowner") {
            relations.add("allies");
            relations.add("enemies");
        }
        if (token === "all") {
            relations.add("owner");
            relations.add("allies");
            relations.add("enemies");
        }
    }
    return relations;
}

export class RadarTrait {
    private activeLightningRadarOutages: Map<any, ActiveLightningRadarOutage>;
    /** Moving RadarJamRadius technos require range re-evaluation. */
    private nextJammerRefreshTick = 0;
    constructor() {
        this.activeLightningRadarOutages = new Map();
    }
    getHash(): number {
        return fnv32aStrings([
            "RadarTrait",
            this.nextJammerRefreshTick,
            ...[...this.activeLightningRadarOutages.values()]
                .map(outage => [outage.owner?.playerListIndex ?? -1, outage.startTick, outage.endTick,
                    [...outage.affects].sort().join(","), outage.active ? 1 : 0] as const)
                .sort((a, b) => a[0] - b[0] || a[1] - b[1])
                .flat(),
        ]);
    }
    /**
     * Active lightning outages are keyed by the firing effect object, which
     * the superweapon effect codec already restores positionally in the owner's
     * effect list. Persisting the (owner, effect index) pair therefore rebinds
     * the outage to the reconstructed effect without duplicating effect state.
     */
    captureState(): Record<string, unknown> {
        return {
            version: 1,
            nextJammerRefreshTick: this.nextJammerRefreshTick,
            outages: [...this.activeLightningRadarOutages.entries()]
                .map(([effect, outage]) => ({
                    ownerIndex: outage.owner?.playerListIndex ?? -1,
                    effectIndex: outage.owner?.superWeaponsTrait?.getEffectIndex?.(effect) ?? -1,
                    startTick: outage.startTick,
                    endTick: outage.endTick,
                    affects: [...outage.affects].sort(),
                    active: outage.active,
                }))
                .filter(outage => outage.ownerIndex >= 0 && outage.effectIndex >= 0)
                .sort((a, b) => a.ownerIndex - b.ownerIndex || a.effectIndex - b.effectIndex),
        };
    }
    restoreState(
        state: unknown,
        context: { resolvePlayerByIndex?: (index: number) => any; strict?: boolean } = {},
    ): void {
        if (!state || typeof state !== "object" || (state as any).version !== 1 ||
            !Number.isSafeInteger((state as any).nextJammerRefreshTick) ||
            (state as any).nextJammerRefreshTick < 0 || !Array.isArray((state as any).outages)) {
            throw new Error("Invalid radar trait state");
        }
        const seen = new Set<string>();
        const outages = new Map<any, ActiveLightningRadarOutage>();
        for (const entry of (state as any).outages as any[]) {
            if (!entry || !Number.isSafeInteger(entry.ownerIndex) || entry.ownerIndex < 0 ||
                !Number.isSafeInteger(entry.effectIndex) || entry.effectIndex < 0 ||
                !Number.isSafeInteger(entry.startTick) || entry.startTick < 0 ||
                !Number.isSafeInteger(entry.endTick) || entry.endTick < entry.startTick ||
                !Array.isArray(entry.affects) || typeof entry.active !== "boolean") {
                throw new Error("Invalid radar outage state");
            }
            const key = `${entry.ownerIndex}:${entry.effectIndex}`;
            if (seen.has(key)) {
                throw new Error("Duplicate radar outage state");
            }
            seen.add(key);
            const owner = context.resolvePlayerByIndex?.(entry.ownerIndex);
            const effect = owner?.superWeaponsTrait?.getEffectAt?.(entry.effectIndex);
            if (!effect && context.strict) {
                throw new Error(`Cannot restore radar outage ${key}: unresolved effect`);
            }
            if (!effect) continue;
            outages.set(effect, {
                owner,
                startTick: entry.startTick,
                endTick: entry.endTick,
                affects: new Set(entry.affects.filter((relation: string) =>
                    relation === "owner" || relation === "allies" || relation === "enemies")),
                active: entry.active,
            });
        }
        this.nextJammerRefreshTick = (state as any).nextJammerRefreshTick;
        this.activeLightningRadarOutages = outages;
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
        this.updateLightningRadarOutages(game);
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
    [NotifySuperWeaponActivate.onActivate](
        type: SuperWeaponType,
        player: any,
        game: any,
        _tile?: any,
        _tile2?: any,
        outageSettings?: LightningRadarOutageSettings,
        effect?: any,
    ): void {
        if (type !== SuperWeaponType.LightningStorm) return;
        const duration = normalizeLightningFrames(
            outageSettings?.duration ?? game.rules?.general?.lightningStorm?.duration,
        );
        if (duration <= 0) return;
        const deferment = Math.max(0, normalizeLightningFrames(
            outageSettings?.deferment ?? game.rules?.general?.lightningStorm?.deferment,
        ));
        const currentTick = normalizeLightningFrames(game.currentTick);
        const outage: ActiveLightningRadarOutage = {
            owner: player,
            startTick: currentTick + deferment,
            endTick: currentTick + deferment + duration,
            affects: parseLightningRadarRelations(outageSettings?.affects),
            active: false,
        };
        if (outage.affects.size === 0) return;
        this.activeLightningRadarOutages.set(effect ?? {}, outage);
        this.updateLightningRadarOutages(game);
    }
    [NotifySuperWeaponDeactivate.onDeactivate](
        type: SuperWeaponType,
        player: any,
        game: any,
        effect?: any,
    ): void {
        if (type !== SuperWeaponType.LightningStorm) return;
        const entries = effect
            ? [[effect, this.activeLightningRadarOutages.get(effect)] as const]
            : [...this.activeLightningRadarOutages.entries()].filter(([, outage]) => outage.owner === player);
        for (const [key, outage] of entries) {
            if (!outage) continue;
            this.activeLightningRadarOutages.delete(key);
            if (outage.active) {
                for (const combatant of game.getCombatants()) {
                    if (this.isLightningRadarOutageAffected(outage, combatant, game)) {
                        this.updateRadarForPlayer(combatant, game);
                    }
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
    private updateLightningRadarOutages(game: any): void {
        const currentTick = normalizeLightningFrames(game.currentTick);
        for (const outage of this.activeLightningRadarOutages.values()) {
            const active = currentTick >= outage.startTick && currentTick < outage.endTick;
            if (active === outage.active) continue;
            outage.active = active;
            for (const combatant of game.getCombatants()) {
                if (this.isLightningRadarOutageAffected(outage, combatant, game)) {
                    this.updateRadarForPlayer(combatant, game);
                }
            }
        }
    }
    private isLightningRadarOutageAffected(
        outage: ActiveLightningRadarOutage,
        player: any,
        game: any,
    ): boolean {
        if (!outage.active || player?.defeated === true) return false;
        const relation: LightningRadarRelation = player === outage.owner
            ? "owner"
            : game.alliances.areAllied(player, outage.owner) ? "allies" : "enemies";
        return outage.affects.has(relation);
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
            [...this.activeLightningRadarOutages.values()].some(outage =>
                this.isLightningRadarOutageAffected(outage, player, game));
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
