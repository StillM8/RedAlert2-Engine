import { MapShroud, ShroudFlag } from "@/game/map/MapShroud";
import { NotifyTick } from "@/game/trait/interface/NotifyTick";
import { NotifyOwnerChange } from "@/game/trait/interface/NotifyOwnerChange";
import { NotifyAllianceChange } from "@/game/trait/interface/NotifyAllianceChange";
import { isNotNullOrUndefined } from "@/util/typeGuard";
import { NotifySpawn } from "@/game/trait/interface/NotifySpawn";
import { NotifyUnspawn } from "@/game/trait/interface/NotifyUnspawn";
import { RadarTrait } from "@/game/trait/RadarTrait";
import { getAvailableBuildingSuperWeapon } from "@/game/gameobject/trait/SuperWeaponTrait";
import { RadarEventType } from "@/game/rules/general/RadarRules";
import { ObjectType } from "@/engine/type/ObjectType";
import { NotifyPower } from "@/game/trait/interface/NotifyPower";
import { NotifyElevationChange } from "@/game/trait/interface/NotifyElevationChange";
import { hasOperationalAresRadarProvider } from "@/extensions/ares/AresRadarJammer";
import { HouseDiscoveredEvent } from "@/game/event/HouseDiscoveredEvent";
import { ObjectDiscoveredEvent } from "@/game/event/ObjectDiscoveredEvent";
import { fnv32aStrings } from "@/util/math";
export interface MapShroudTraitState {
    version: 1;
    players: {
        index: number;
        shroud: unknown;
        visibleObjectIds: number[];
        discoveredHouseIndexes: number[];
        spySatOnline?: boolean;
    }[];
    revealedToAllIds: number[];
    gapGeneratorIds: number[];
}

export class MapShroudTrait implements NotifyTick, NotifyOwnerChange, NotifyAllianceChange, NotifySpawn, NotifyUnspawn, NotifyPower, NotifyElevationChange {
    private map: any;
    private alliances: any;
    private shroudByPlayer: Map<any, any>;
    private revealedToAll: Set<any>;
    private gapGenerators: Set<any>;
    private visibleObjectsByPlayer: Map<any, Set<any>>;
    private discoveredHousesByPlayer: Map<any, Set<any>>;
    /** Last effective SpySat state, including Ares RadarJamRadius. */
    private spySatOnline: Map<any, boolean>;
    private gameState?: any;
    private handleTileOccupationUpdate: (params: {
        object: any;
        type: string;
    }) => void;
    constructor(map: any, alliances: any) {
        this.map = map;
        this.alliances = alliances;
        this.shroudByPlayer = new Map();
        this.revealedToAll = new Set();
        this.gapGenerators = new Set();
        this.visibleObjectsByPlayer = new Map();
        this.discoveredHousesByPlayer = new Map();
        this.spySatOnline = new Map();
        this.handleTileOccupationUpdate = ({ object: e, type: t }) => {
            if ("removed" !== t && e.isTechno()) {
                const r = e.owner;
                for (const i of [r, ...this.alliances.getAllies(r)]) {
                    this.shroudByPlayer.get(i)?.revealFrom(e);
                }
            }
        };
    }
    getPlayerShroud(player: any) {
        return this.shroudByPlayer.get(player);
    }
    init(gameState: any) {
        this.gameState = gameState;
        gameState.map.tileOccupation.onChange.subscribe(this.handleTileOccupationUpdate);
        const baseShroud = new MapShroud().fromTiles(this.map.tiles);
        for (const combatant of gameState.getCombatants()) {
            const playerShroud = baseShroud.clone();
            this.shroudByPlayer.set(combatant, playerShroud);
            this.revealObjects(playerShroud, combatant, gameState);
            playerShroud.update();
            const initialVisible = this.collectVisibleObjects(combatant, playerShroud, gameState);
            this.visibleObjectsByPlayer.set(combatant, initialVisible);
            this.discoveredHousesByPlayer.set(combatant, new Set(
                [...initialVisible]
                    .map((object) => object.owner)
                    .filter((house) => !!house),
            ));
        }
    }
    getHash(): number {
        const values: (string | number)[] = ["MapShroudTrait"];
        for (const [player, shroud] of [...this.shroudByPlayer.entries()].sort((a, b) =>
            (a[0]?.playerListIndex ?? -1) - (b[0]?.playerListIndex ?? -1))) {
            values.push(player?.playerListIndex ?? -1, shroud.getHash());
            values.push(this.spySatOnline.get(player) ? 1 : 0);
        }
        values.push("revealed", ...[...this.revealedToAll].map(object => object.id).sort((a, b) => a - b));
        values.push("gaps", ...[...this.gapGenerators].map(object => object.id).sort((a, b) => a - b));
        return fnv32aStrings(values);
    }
    captureState(): MapShroudTraitState {
        const game = this.gameState;
        const players = game?.playerList?.getAll?.() ?? [];
        const resolveIndex = (player: any) => player?.playerListIndex;
        const resolveObjectId = (object: any) => object?.id;
        return {
            version: 1,
            players: [...this.shroudByPlayer.entries()]
                .map(([player, shroud]) => ({
                    index: resolveIndex(player),
                    shroud: shroud.captureState(),
                    visibleObjectIds: [...(this.visibleObjectsByPlayer.get(player) ?? [])]
                        .map(resolveObjectId).filter((id: any) => Number.isSafeInteger(id)).sort((a: any, b: any) => a - b),
                    discoveredHouseIndexes: [...(this.discoveredHousesByPlayer.get(player) ?? [])]
                        .map(resolveIndex).filter((id: any) => Number.isSafeInteger(id)).sort((a: any, b: any) => a - b),
                    ...(this.spySatOnline.has(player) ? { spySatOnline: this.spySatOnline.get(player) === true } : {}),
                }))
                .filter((entry: any) => Number.isSafeInteger(entry.index))
                .sort((a: any, b: any) => a.index - b.index),
            revealedToAllIds: [...this.revealedToAll].map(resolveObjectId).filter((id: any) => Number.isSafeInteger(id)).sort((a: any, b: any) => a - b),
            gapGeneratorIds: [...this.gapGenerators].map(resolveObjectId).filter((id: any) => Number.isSafeInteger(id)).sort((a: any, b: any) => a - b),
        };
    }
    validateState(state: unknown): MapShroudTraitState {
        if (!state || typeof state !== "object" || (state as any).version !== 1 ||
            !Array.isArray((state as any).players) || !Array.isArray((state as any).revealedToAllIds) ||
            !Array.isArray((state as any).gapGeneratorIds)) {
            throw new Error("Invalid map shroud trait state");
        }
        const seenPlayers = new Set<number>();
        for (const entry of (state as any).players) {
            if (!entry || !Number.isSafeInteger(entry.index) || entry.index < 0 || seenPlayers.has(entry.index) ||
                !entry.shroud || !Array.isArray(entry.visibleObjectIds) || !Array.isArray(entry.discoveredHouseIndexes)) {
                throw new Error("Invalid map shroud player state");
            }
            seenPlayers.add(entry.index);
        }
        return state as MapShroudTraitState;
    }
    restoreState(state: unknown, options: { strict?: boolean; resolveObjectById?: (id: number) => any; resolvePlayerByIndex?: (index: number) => any } = {}): void {
        const parsed = this.validateState(state);
        const game = this.gameState;
        const players = game?.playerList?.getAll?.() ?? [];
        const resolvePlayer = options.resolvePlayerByIndex ?? ((index: number) => players[index]);
        const resolveObject = options.resolveObjectById ?? ((id: number) => game?.world?.getObjectById?.(id));
        const shrouds = new Map<any, MapShroud>();
        const visible = new Map<any, Set<any>>();
        const discovered = new Map<any, Set<any>>();
        const spySat = new Map<any, boolean>();
        for (const entry of parsed.players) {
            const player = resolvePlayer(entry.index);
            if (!player) {
                if (options.strict) throw new Error(`Cannot restore shroud player ${entry.index}: unresolved`);
                continue;
            }
            const shroud = new MapShroud();
            shroud.restoreState(entry.shroud);
            shrouds.set(player, shroud);
            const visibleSet = new Set<any>();
            for (const id of entry.visibleObjectIds) {
                const object = resolveObject(id);
                if (!object && options.strict) throw new Error(`Cannot restore visible object ${id}: unresolved`);
                if (object) visibleSet.add(object);
            }
            visible.set(player, visibleSet);
            const houseSet = new Set<any>();
            for (const index of entry.discoveredHouseIndexes) {
                const house = resolvePlayer(index);
                if (!house && options.strict) throw new Error(`Cannot restore discovered house ${index}: unresolved`);
                if (house) houseSet.add(house);
            }
            discovered.set(player, houseSet);
            if (entry.spySatOnline !== undefined) spySat.set(player, entry.spySatOnline === true);
        }
        const revealed = new Set<any>();
        for (const id of parsed.revealedToAllIds) {
            const object = resolveObject(id);
            if (!object && options.strict) throw new Error(`Cannot restore reveal object ${id}: unresolved`);
            if (object) revealed.add(object);
        }
        const gaps = new Set<any>();
        for (const id of parsed.gapGeneratorIds) {
            const object = resolveObject(id);
            if (!object && options.strict) throw new Error(`Cannot restore gap generator ${id}: unresolved`);
            if (object) gaps.add(object);
        }
        this.shroudByPlayer = shrouds;
        this.visibleObjectsByPlayer = visible;
        this.discoveredHousesByPlayer = discovered;
        this.spySatOnline = spySat;
        this.revealedToAll = revealed;
        this.gapGenerators = gaps;
    }
    [NotifyElevationChange.onElevationChange](object: any, gameState: any, previousElevation: number) {
        if (Math.floor(object.tileElevation) !== Math.floor(previousElevation)) {
            const owner = object.owner;
            for (const ally of [owner, ...this.alliances.getAllies(owner)]) {
                this.shroudByPlayer.get(ally)?.revealFrom(object);
            }
        }
    }
    [NotifyTick.onTick](gameState: any) {
        for (const [player, shroud] of this.shroudByPlayer) {
            if (player.defeated && !player.isObserver) {
                this.shroudByPlayer.delete(player);
                this.visibleObjectsByPlayer.delete(player);
                this.discoveredHousesByPlayer.delete(player);
                this.spySatOnline.delete(player);
            }
            else {
                this.updateSpySatState(player, gameState);
                shroud.update();
                this.emitDiscoveryEvents(player, shroud, gameState);
            }
        }
    }
    [NotifyOwnerChange.onChange](object: any, previousOwner: any, gameState: any) {
        if (object.isBuilding() && object.rules.spySat) {
            this.updateSpySatState(previousOwner, gameState, true);
            this.updateSpySatState(object.owner, gameState, true);
        }
        if (object.isSpawned) {
            for (const ally of [object.owner, ...gameState.alliances.getAllies(object.owner)]) {
                this.shroudByPlayer.get(ally)?.revealFrom(object);
            }
        }
    }
    [NotifyAllianceChange.onChange](alliance: any, isFormed: boolean, gameState: any) {
        if (isFormed) {
            const firstPlayerShroud = this.getPlayerShroud(alliance.players.first);
            const alliedShrouds = gameState.alliances
                .getAllies(alliance.players.first)
                .map((player: any) => this.getPlayerShroud(player))
                .filter(isNotNullOrUndefined);
            for (const alliedShroud of alliedShrouds) {
                firstPlayerShroud.merge(alliedShroud);
            }
            firstPlayerShroud.invalidateFull();
            for (const alliedShroud of alliedShrouds) {
                alliedShroud.copy(firstPlayerShroud);
                alliedShroud.invalidateFull();
            }
        }
    }
    [NotifySpawn.onSpawn](object: any, gameState: any) {
        if (object.isBuilding()) {
            if (object.rules.spySat) {
                this.updateSpySatState(object.owner, gameState, true);
            }
            if (object.rules.revealToAll) {
                this.revealedToAll.add(object);
                for (const combatant of gameState.getCombatants()) {
                    if (combatant === object.owner || gameState.alliances.areAllied(object.owner, combatant)) {
                        continue;
                    }
                    this.shroudByPlayer.get(combatant)?.revealObject(object);
                    gameState.traits
                        .get(RadarTrait)
                        .addEventForPlayer(
                            RadarEventType.EnemyObjectSensed,
                            combatant,
                            object.centerTile,
                            gameState,
                            {
                                superWeaponRules: getAvailableBuildingSuperWeapon(object)?.superWeapon?.rules,
                                superWeaponOwner: object.owner,
                            },
                        );
                }
            }
            if (object.gapGeneratorTrait) {
                this.gapGenerators.add(object);
            }
        }
    }
    [NotifyUnspawn.onUnspawn](object: any, gameState: any) {
        if (object.isBuilding()) {
            if (object.rules.spySat) {
                this.updateSpySatState(object.owner, gameState, true);
            }
            if (object.rules.revealToAll) {
                this.revealedToAll.delete(object);
            }
            if (object.gapGeneratorTrait) {
                this.gapGenerators.delete(object);
            }
        }
    }
    [NotifyPower.onPowerLow](player: any, gameState: any) {
        this.updateGaps(gameState, player);
    }
    [NotifyPower.onPowerRestore](player: any, gameState: any) {
        this.updateGaps(gameState, player);
    }
    [NotifyPower.onPowerChange](player: any, gameState: any) { }
    private updateSpySatState(player: any, gameState: any, force: boolean = false): void {
        if (!player || !this.shroudByPlayer.has(player)) return;
        const ownsSpySat = [...(player.buildings ?? [])].some((building: any) =>
            building?.isSpawned && !building.isDestroyed && building.rules.spySat);
        if (!ownsSpySat) {
            if (this.spySatOnline.get(player)) {
                this.spySatOnline.delete(player);
                this.resetShroud(player, gameState);
            }
            else {
                this.spySatOnline.delete(player);
            }
            return;
        }
        const online = hasOperationalAresRadarProvider(
            player,
            gameState,
            (building: any) => building.rules.spySat,
        );
        const previous = this.spySatOnline.get(player);
        if (!force && previous === online) return;
        this.spySatOnline.set(player, online);
        if (online) {
            this.revealMap(player, gameState);
        }
        else if (previous !== false || force) {
            this.resetShroud(player, gameState);
        }
    }
    revealMap(player: any, gameState: any) {
        this.shroudByPlayer.get(player)?.revealAll();
        this.markOwnGapTiles(gameState, player);
        this.updateGaps(gameState);
    }
    resetShroud(player: any, gameState: any) {
        const shroud = this.shroudByPlayer.get(player);
        if (shroud) {
            shroud.reset();
            this.markOwnGapTiles(gameState, player);
            this.revealObjects(shroud, player, gameState);
        }
    }
    revealObjects(shroud: any, player: any, gameState: any) {
        const objectsToReveal = [
            ...player.getOwnedObjects(),
            ...gameState.alliances
                .getAllies(player)
                .map((ally: any) => ally.getOwnedObjects())
                .flat(),
        ];
        for (const object of objectsToReveal) {
            shroud.revealFrom(object);
        }
        this.revealedToAll.forEach((object) => shroud.revealObject(object));
    }
    updateGaps(gameState: any, specificPlayer?: any) {
        for (const gapGenerator of this.gapGenerators) {
            if (!specificPlayer || gapGenerator.owner === specificPlayer) {
                gapGenerator.gapGeneratorTrait.update(gapGenerator, gameState);
            }
        }
    }
    markOwnGapTiles(gameState: any, player: any) {
        for (const gapGenerator of this.gapGenerators) {
            if (gapGenerator.owner === player || gameState.alliances.areAllied(gapGenerator.owner, player)) {
                this.getPlayerShroud(player)?.toggleFlagsAround(gapGenerator.tile, gapGenerator.gapGeneratorTrait.radiusTiles, ShroudFlag.Darken, true);
            }
        }
    }
    private getWorldObjects(gameState: any): any[] {
        const world = gameState?.getWorld?.() ?? gameState?.world;
        return world?.getAllObjects?.() ?? [];
    }
    private isObjectVisible(object: any, shroud: any, gameState: any): boolean {
        if (!object?.isTechno?.() || object.isDestroyed || object.isDisposed || object.isSpawned === false || !object.tile) {
            return false;
        }
        const tiles = gameState?.map?.tileOccupation?.calculateTilesForGameObject?.(object.tile, object) ?? [object.tile];
        return tiles.some((tile: any) => tile && !shroud.isShrouded(tile, object.tileElevation ?? 0));
    }
    private collectVisibleObjects(player: any, shroud: any, gameState: any): Set<any> {
        const visible = new Set<any>();
        for (const object of this.getWorldObjects(gameState)) {
            if (object?.owner !== player && this.isObjectVisible(object, shroud, gameState)) {
                visible.add(object);
            }
        }
        return visible;
    }
    private emitDiscoveryEvents(player: any, shroud: any, gameState: any): void {
        if (player?.isAi === true || player?.isObserver === true) {
            this.visibleObjectsByPlayer.set(player, this.collectVisibleObjects(player, shroud, gameState));
            return;
        }
        const current = this.collectVisibleObjects(player, shroud, gameState);
        const previous = this.visibleObjectsByPlayer.get(player) ?? new Set<any>();
        const discoveredHouses = this.discoveredHousesByPlayer.get(player) ?? new Set<any>();
        for (const object of current) {
            if (previous.has(object)) {
                continue;
            }
            const house = object.owner;
            if (!house) {
                continue;
            }
            gameState.events?.dispatch(new ObjectDiscoveredEvent(object, player));
            if (!discoveredHouses.has(house)) {
                discoveredHouses.add(house);
                gameState.events?.dispatch(new HouseDiscoveredEvent(house, player));
            }
        }
        this.visibleObjectsByPlayer.set(player, current);
        this.discoveredHousesByPlayer.set(player, discoveredHouses);
    }
    dispose() {
        this.map.tileOccupation.onChange.unsubscribe(this.handleTileOccupationUpdate);
        this.visibleObjectsByPlayer.clear();
        this.discoveredHousesByPlayer.clear();
    }
}
