import { ConstructionWorker } from "./ConstructionWorker";
import { GameOpts, getCampaignSession, isCampaignGameOpts, isHumanPlayerInfo } from "./gameopts/GameOpts";
import type { CampaignSession } from "./gameopts/GameOpts";
import { ObjectType } from "../engine/type/ObjectType";
import { EventDispatcher } from "../util/event";
import { OreSpread } from "./map/OreSpread";
import { Infantry } from "./gameobject/Infantry";
import { AllianceStatus } from "./Alliances";
import { BoxedVar } from "../util/BoxedVar";
import { StartingUnitsGenerator } from "./StartingUnitsGenerator";
import { CardinalTileFinder } from "./map/tileFinder/CardinalTileFinder";
import { SpeedType } from "./type/SpeedType";
import { Target, TargetBridgeMode } from "./Target";
import { BridgeOverlayTypes } from "./map/BridgeOverlayTypes";
import { fnv32a, isBetween } from "../util/math";
import { GameEventBus } from "./GameEventBus";
import { ObjectDestroyEvent } from "./event/ObjectDestroyEvent";
import { PlayerDefeatedEvent } from "./event/PlayerDefeatedEvent";
import { GameModeType } from "./ini/GameModeType";
import { Traits } from "./Traits";
import { NotifyTick } from "./trait/interface/NotifyTick";
import { NotifyDestroy } from "./trait/interface/NotifyDestroy";
import { NotifySpawn } from "./trait/interface/NotifySpawn";
import { NotifyUnspawn } from "./trait/interface/NotifyUnspawn";
import { NotifyOwnerChange } from "./trait/interface/NotifyOwnerChange";
import { ObjectOwnerChangeEvent } from "./event/ObjectOwnerChangeEvent";
import { ObjectDiscoveredEvent } from "./event/ObjectDiscoveredEvent";
import { ObjectSelectedEvent } from "./event/ObjectSelectedEvent";
import { ObjectUnspawnEvent } from "./event/ObjectUnspawnEvent";
import { NotifyTargetDestroy } from "./trait/interface/NotifyTargetDestroy";
import { createAresKillAttribution, resolveAresVeterancyRecipients } from "@/extensions/ares/AresVeterancy";
import { VeteranLevel } from "./gameobject/unit/VeteranLevel";
import { ObjectSpawnEvent } from "./event/ObjectSpawnEvent";
import { OverlayTibType } from "../engine/type/OverlayTibType";
import { OreOverlayTypes } from "./map/OreOverlayTypes";
import { Weapon } from "./Weapon";
import { GameSpeed } from "./GameSpeed";
import { DeathType } from "./gameobject/common/DeathType";
import { CollisionType } from "./gameobject/unit/CollisionType";
import { ZoneType } from "./gameobject/unit/ZoneType";
import { BridgeHeadType } from "./map/Bridges";
import { SuperWeapon } from "./SuperWeapon";
import { AllianceChangeEvent, AllianceEventType } from "./event/AllianceChangeEvent";
import { NotifyAllianceChange } from "./trait/interface/NotifyAllianceChange";
import { OBS_COUNTRY_ID } from "./gameopts/constants";
import { getZoneType } from "./gameobject/unit/ZoneType";
import { Prng } from "./Prng";
import { TriggerManager } from "./trigger/TriggerManager";
import { TeamRuntime } from "./trigger/TeamRuntime";
import { AresSecretLabService } from "@/extensions/ares/AresSecretLabRuntime";
import { BuildingCaptureEvent } from "@/game/event/BuildingCaptureEvent";
import { CountdownTimer } from "./CountdownTimer";
import { WeaponType } from "./WeaponType";
import { Warhead } from "./Warhead";
import { NotifyObjectTraitAdd } from "./trait/interface/NotifyObjectTraitAdd";
import { RadarOnOffEvent } from "./event/RadarOnOffEvent";
import { AresBountyAwardEvent } from "./event/AresBountyAwardEvent";
import { applyAresBountyAward, resolveAresBountyAward } from "@/extensions/ares/AresBounty";
import { EventType } from "./event/EventType";
import { Coords } from "./Coords";
import { parseAresAnimationDamage } from "@/extensions/ares/AresAnimationDamage";
import {
    AresAnimationDamageRuntime,
    type AresAnimationDamageDelivery,
} from "@/extensions/ares/AresAnimationDamageRuntime";
import { AresLaserFenceRuntime } from "@/extensions/ares/AresLaserFences";
import { AresMakeInfantryService } from "@/extensions/ares/AresMakeInfantry";
export enum GameStatus {
    NotStarted = 0,
    Started = 1,
    Ended = 2
}
export type CampaignOutcomeKind = "win" | "lose" | "force-end";
export interface CampaignGameResult {
    outcome: CampaignOutcomeKind;
    victory: boolean;
    scripted: boolean;
    house?: any;
    houseName?: string;
    nextScenario?: string;
    altNextScenario?: string;
    endOfGame: boolean;
    skipScore: boolean;
}
type PendingCampaignOutcome = {
    kind: CampaignOutcomeKind;
    house?: any;
};
export class Game {
    public updatableObjects = new Set<any>();
    /**
     * Reused snapshot for update traversal.  Updating an object may spawn or
     * remove other objects, so iterating the Set directly would change the
     * established one-tick mutation semantics.  Reusing the backing array
     * preserves the snapshot while avoiding one O(N) allocation per turn.
     */
    private readonly updatableObjectsSnapshot: any[] = [];
    public constructionWorkers = new Map<any, ConstructionWorker>();
    public currentTick = 0;
    public currentTime = 0;
    public countdownTimer = new CountdownTimer();
    public _onEnd = new EventDispatcher<Game, void>();
    public afterTickCallbacks: Array<() => void> = [];
    public events = new GameEventBus();
    public readonly aresMakeInfantryService: AresMakeInfantryService;
    private readonly aresAnimationDamageRuntime = new AresAnimationDamageRuntime({
        getPlayerIndex: (player: any) => {
            const players = this.playerList?.getAll?.() ?? [];
            const index = players.indexOf(player);
            return index === -1 ? undefined : index;
        },
    });
    public readonly aresLaserFenceRuntime: AresLaserFenceRuntime;
    public traits = new Traits();
    public debugText = new BoxedVar("");
    public world: any;
    public map: any;
    public rules: any;
    public art: any;
    public ai: any;
    public id: any;
    public startTimestamp: any;
    public prng: any;
    public gameOpts: any;
    public gameModeType: any;
    public playerList: any;
    public unitSelection: any;
    public alliances: any;
    public desiredSpeed: BoxedVar<number>;
    public speed: BoxedVar<number>;
    public nextObjectId: any;
    public objectFactory: any;
    public botManager: any;
    public triggers = new TriggerManager();
    public readonly teamRuntime = new TeamRuntime();
    /** Ares SecretLab payout runtime; rolls from the shared PRNG. */
    public aresSecretLabService = new AresSecretLabService(this);
    public localPlayer: any;
    public mapShroudTrait: any;
    public crateGeneratorTrait: any;
    public status: GameStatus;
    public lastGameEndCheck: number | undefined;
    public campaignMode: boolean = false;
    public campaignSession?: CampaignSession;
    public campaignOutcome?: CampaignGameResult;
    public campaignResult?: CampaignGameResult;
    public pendingCampaignOutcome?: PendingCampaignOutcome;
    public triggerOutcome: any;
    public nextScenario: string = "";
    public altNextScenario: string = "";
    public endOfGame: boolean = false;
    public skipScore: boolean = false;
    public oneTimeOnly: boolean = false;
    public ignoreGlobalAITriggers: boolean = false;
    public fixedAlliance: boolean = false;
    private triggersInitialized: boolean = false;
    public sellTrait: any;
    public stalemateDetectTrait: any;
    get onEnd() {
        return this._onEnd.asEvent();
    }
    constructor(world: any, map: any, rules: any, art: any, ai: any, id: any, startTimestamp: any, gameOpts: any, gameModeType: any, playerList: any, unitSelection: any, alliances: any, nextObjectId: any, objectFactory: any, botManager: any) {
        this.world = world;
        this.map = map;
        this.rules = rules;
        this.art = art;
        this.ai = ai;
        this.id = id;
        this.startTimestamp = startTimestamp;
        this.prng = Prng.factory(id, startTimestamp);
        this.gameOpts = gameOpts;
        this.gameModeType = gameModeType;
        this.playerList = playerList;
        this.unitSelection = unitSelection;
        this.alliances = alliances;
        this.desiredSpeed = new BoxedVar(GameSpeed.computeGameSpeed(gameOpts.gameSpeed));
        this.speed = new BoxedVar(this.desiredSpeed.value);
        this.nextObjectId = nextObjectId;
        this.objectFactory = objectFactory;
        this.botManager = botManager;
        this.campaignMode = isCampaignGameOpts(gameOpts);
        this.campaignSession = getCampaignSession(gameOpts);
        this.aresLaserFenceRuntime = new AresLaserFenceRuntime();
        this.aresLaserFenceRuntime.attach(this);
        this.aresMakeInfantryService = new AresMakeInfantryService(this);
        this.events.subscribe(EventType.BuildingCapture, (event: any) => {
            this.handleAresSecretLabCapture(event?.building);
        });
        this.unitSelection?.setEventSink?.((unit) => {
            if (this.localPlayer &&
                unit.owner === this.localPlayer &&
                unit.isDestroyed !== true &&
                unit.isDisposed !== true &&
                unit.isSpawned !== false &&
                !unit.limboData &&
                unit.rules?.selectable !== false) {
                this.events.dispatch(new ObjectSelectedEvent(unit, this.localPlayer));
            }
        });
        this.events.subscribe(EventType.TriggerAnim, (event: any) => {
            this.aresMakeInfantryService.handleTriggerAnimation(event);
            this.registerAresAnimationDamage(event);
        });
        this.events.subscribe(EventType.WarheadDetonate, (event: any) => {
            this.registerAresAnimationDamage({
                name: event.explodeAnim,
                tile: event.centerTile,
                position: event.position,
                elevation: event.elevation,
                zone: event.zone,
                sourcePlayer: event.sourcePlayer,
                sourceObject: event.sourceObject,
            });
        });
    }
    addPlayer(player: any) {
        this.playerList.addPlayer(player);
        this.constructionWorkers.set(player, this.createConstructionWorker(player));
    }
    configureCampaign(mapFile: any, session?: CampaignSession, campaignMode: boolean = this.campaignMode): void {
        this.campaignMode = Boolean(campaignMode || mapFile?.isCampaign || isCampaignGameOpts(this.gameOpts));
        this.campaignSession = {
            ...(this.campaignSession ?? {}),
            ...(session ?? {}),
        };
        const mapNextScenario = String(mapFile?.nextScenario ?? "").trim();
        const mapAltNextScenario = String(mapFile?.altNextScenario ?? "").trim();
        this.nextScenario = mapNextScenario || String(this.campaignSession?.nextScenario ?? "");
        this.altNextScenario = mapAltNextScenario || String(this.campaignSession?.altNextScenario ?? "");
        this.endOfGame = Boolean(mapFile?.endOfGame || this.campaignSession?.endOfGame);
        this.skipScore = Boolean(mapFile?.skipScore || this.campaignSession?.skipScore);
        this.oneTimeOnly = Boolean(mapFile?.oneTimeOnly || this.campaignSession?.oneTimeOnly);
        this.ignoreGlobalAITriggers = Boolean(mapFile?.ignoreGlobalAITriggers || this.campaignSession?.ignoreGlobalAITriggers);
        this.fixedAlliance = Boolean(mapFile?.specialFlags?.fixedAlliance || this.campaignSession?.fixedAlliance);
        this.alliances?.setFixedAlliance(this.fixedAlliance);
    }
    /**
     * Ares pays a secret lab on capture. The payout rolls from the shared PRNG,
     * so it is canonical state and must be hashed; a lab whose authoring does
     * not enable `GenerateOnCapture` is left as an ordinary capturable building.
     */
    handleAresSecretLabCapture(building: any): void {
        const rules = this.rules?.general?.secretLabRules;
        if (!rules || !building || building.isDestroyed) {
            return;
        }
        if (building.rules?.secretLab !== true) {
            return;
        }
        if (!rules.generateOnCapture) {
            return;
        }
        if (!this.aresSecretLabService.isEligible(rules, building, building.owner)) {
            return;
        }
        this.aresSecretLabService.grant(rules, building, building.owner);
    }
    getPlayerByHouseName(name: string): any {        const normalized = this.normalizeOwnerIdentity(name);
        return this.playerList.getAll().find((player: any) =>
            this.normalizeOwnerIdentity(player.houseName) === normalized ||
            this.normalizeOwnerIdentity(player.mapHouse?.name) === normalized ||
            this.normalizeOwnerIdentity(player.mapHouse?.sectionName) === normalized ||
            this.normalizeOwnerIdentity(player.name) === normalized);
    }
    resolveMapOwner(owner: any): any {
        if (owner && typeof owner === "object") {
            return owner.playerListIndex !== undefined || owner.isCombatant || owner.isNeutral || owner.isObserver
                ? owner
                : undefined;
        }
        const raw = String(owner ?? "").trim();
        const normalized = this.normalizeOwnerIdentity(raw);
        if (!normalized) {
            return this.getCivilianPlayer();
        }
        const byHouse = this.getPlayerByHouseName(raw);
        if (byHouse) {
            return byHouse;
        }
        for (const player of this.playerList.getAll()) {
            const country = player.country;
            if (country && (this.normalizeOwnerIdentity(country.id) === normalized ||
                this.normalizeOwnerIdentity(country.name) === normalized)) {
                return player;
            }
            if (this.normalizeOwnerIdentity(player.houseIndex) === normalized ||
                (player.mapHouse && (this.normalizeOwnerIdentity(player.mapHouse.country) === normalized ||
                    this.normalizeOwnerIdentity(player.mapHouse.index) === normalized))) {
                return player;
            }
            const rules = country as any;
            if ((rules && (this.normalizeOwnerIdentity(rules.networkIndex) === normalized ||
                this.normalizeOwnerIdentity(rules.listIndex) === normalized))) {
                return player;
            }
        }
        const neutralAliases = new Set(["neutral", "special", "civilian", "none", "@@neutral@@", "<none>", "-1", "-2"]);
        if (neutralAliases.has(normalized)) {
            return this.getCivilianPlayer();
        }
        return undefined;
    }
    setObjectTechLevel(typeIdentifier: unknown, techLevel: unknown): void {
        const setter = this.rules?.setObjectTechLevelOverride;
        if (typeof setter !== "function") {
            throw new Error("Object tech level overrides are unavailable");
        }
        setter.call(this.rules, typeIdentifier, techLevel);
    }

    enableProductionForHouse(house: any): boolean {
        const player = this.resolveMapOwner(house);
        if (!player?.production?.setProductionEnabled) {
            return false;
        }
        player.production.setProductionEnabled(true);
        return true;
    }
    getPlayer(index: number) {
        return this.playerList.getPlayerAt(index);
    }
    getPlayerByName(name: string) {
        return this.playerList.getPlayerByName(name);
    }
    getAiPlayerName(aiPlayer: any) {
        let index: number;
        index = typeof aiPlayer === "number" ? aiPlayer : this.gameOpts.aiPlayers.indexOf(aiPlayer);
        return `@@AI${index + 1}@@`;
    }
    getPlayerNumber(player: any) {
        return this.playerList.getPlayerNumber(player);
    }
    getCombatants() {
        return this.playerList.getCombatants();
    }
    getCivilianPlayer() {
        return this.playerList.getCivilian();
    }
    getAllPlayers() {
        return this.playerList.getAll();
    }
    getNonNeutralPlayers() {
        return this.playerList.getNonNeutral();
    }
    areFriendly(obj1: any, obj2: any) {
        return obj1.owner === obj2.owner || this.alliances.areAllied(obj1.owner, obj2.owner);
    }
    getWorld() {
        return this.world;
    }
    createConstructionWorker(player: any) {
        return new ConstructionWorker(player, this.rules, this.art, this.map, this);
    }
    getConstructionWorker(player: any) {
        const worker = this.constructionWorkers.get(player);
        if (!worker) {
            throw new Error(`No construction worker found for player "${player.name}"`);
        }
        return worker;
    }
    getUnitSelection() {
        return this.unitSelection;
    }
    init(localPlayer: any) {
        this.localPlayer = localPlayer;
        this.createMapObjects();
        if (!this.campaignMode) {
            this.createPlayerInitialUnits();
        }
        this.map.terrain.computeAllPassabilityGraphs();
        this.mapShroudTrait.init(this);
        this.crateGeneratorTrait.init(this);
        this.playerList.getAll().forEach((player: any) => {
            if (!player.startLocationPoint) {
                player.startLocationPoint = this.map.getStartingLocation?.(player.startLocation);
            }
            if (!this.campaignMode || player.mapHouse?.credits === undefined) {
                player.credits = this.gameOpts.credits;
            }
        });
        if (this.rules.mpDialogSettings.alliesAllowed && !this.campaignMode) {
            this.createInitialTeams();
        }
    }
    start() {
        this.status = GameStatus.Started;
        this.currentTick = 0;
        this.currentTime = 0;
        this.botManager.init(this);
        this.triggers.init(this);
        this.triggersInitialized = true;
        for (const [id, value] of Object.entries(this.campaignSession?.globalVariables ?? {})) {
            this.triggers.toggleGlobalVariable(id, Boolean(value));
        }
        if (this.campaignSession?.alternateNextScenario !== undefined) {
            this.triggers.toggleGlobalVariable("1", Boolean(this.campaignSession.alternateNextScenario));
        }
    }
    createInitialTeams() {
        for (let teamId = 0; teamId < this.gameOpts.maxSlots; teamId++) {
            const teamMembers = [...this.gameOpts.humanPlayers, ...this.gameOpts.aiPlayers]
                .filter((player: any) => player?.teamId === teamId && player.countryId !== OBS_COUNTRY_ID)
                .map((player: any) => isHumanPlayerInfo(player) ? player.name : this.getAiPlayerName(player));
            if (teamMembers.length > 1) {
                for (let i = 0; i < teamMembers.length - 1; i++) {
                    for (let j = i + 1; j < teamMembers.length; j++) {
                        const player1 = this.getPlayerByName(teamMembers[i]);
                        const player2 = this.getPlayerByName(teamMembers[j]);
                        const alliance = this.alliances.setAlliance(player1, player2, AllianceStatus.Formed);
                        this.onAllianceChange(alliance, player1, true);
                    }
                }
            }
        }
    }
    createMapObjects() {
        const noHarvesters = this.rules.general.harvesterUnit.every((unitName: string) => !isBetween(this.rules.getObject(unitName, ObjectType.Vehicle).techLevel, 0, this.rules.mpDialogSettings.techLevel));
        const mapObjects = this.map.getInitialMapObjects();
        this.createInitialMapTerrains(mapObjects.terrains, noHarvesters);
        this.createInitialMapOverlays(mapObjects.overlays, noHarvesters);
        this.createInitialMapSmudges(mapObjects.smudges);
        this.createInitialMapTechnos(mapObjects.technos);
        this.aresLaserFenceRuntime.reconcile(this);
    }
    createInitialMapTerrains(terrains: any[], noHarvesters: boolean) {
        for (const terrain of terrains) {
            const name = terrain.name;
            if (!this.validateMapObjectRulesAndArt(name, ObjectType.Terrain)) {
                continue;
            }
            const tile = this.map.tiles.getByMapCoords(terrain.rx, terrain.ry);
            if (!tile) {
                console.warn(`Invalid map object location (${terrain.rx},${terrain.ry})`, terrain);
                continue;
            }
            const terrainRules = this.rules.getObject(name, ObjectType.Terrain);
            if (noHarvesters && terrainRules.spawnsTiberium) {
                continue;
            }
            const terrainObj = this.createObject(ObjectType.Terrain, name);
            this.spawnObject(terrainObj, tile);
        }
    }
    createInitialMapOverlays(overlays: any[], noHarvesters: boolean) {
        const bridgeSegments = new Map<any, number>();
        const bridgeObjects = new Map<any, any>();
        for (const overlay of overlays) {
            const overlayName = this.rules.getOverlayName(overlay.id);
            if (!this.validateMapObjectRulesAndArt(overlayName, ObjectType.Overlay)) {
                continue;
            }
            let overlayObj = this.createObject(ObjectType.Overlay, overlayName);
            overlayObj.overlayId = overlay.id;
            overlayObj.value = overlay.value;
            let tileX = overlay.rx;
            let tileY = overlay.ry;
            if (overlayObj.isBridge() && overlayObj.isHighBridge()) {
                overlayObj.position.tileElevation = 4;
                tileX += overlayObj.isXBridge() ? 0 : -1;
                tileY += overlayObj.isXBridge() ? -1 : 0;
            }
            const tile = this.map.tiles.getByMapCoords(tileX, tileY);
            if (!tile) {
                console.warn(`Invalid map object location (${tileX},${tileY})`, overlay);
                overlayObj.dispose();
                continue;
            }
            if (overlayObj.rules.tiberium) {
                const tibType = OreOverlayTypes.getOverlayTibType(overlay.id);
                const newOverlayId = OreSpread.calculateOverlayId(tibType, tile);
                if (newOverlayId !== undefined && newOverlayId !== overlay.id) {
                    overlayObj.dispose();
                    overlayObj = this.createObject(ObjectType.Overlay, this.rules.getOverlayName(newOverlayId));
                    overlayObj.overlayId = newOverlayId;
                    overlayObj.value = overlay.value;
                }
            }
            if (BridgeOverlayTypes.isLowBridge(overlay.id)) {
                if (!BridgeOverlayTypes.isBridgePlaceholder(overlay.id)) {
                    bridgeSegments.set(tile, overlay.value);
                    if (overlay.value === 1) {
                        bridgeObjects.set(tile, overlayObj);
                    }
                    else {
                        overlayObj.dispose();
                    }
                }
            }
            else {
                if (overlayObj.isTiberium()) {
                    const tibType = OreOverlayTypes.getOverlayTibType(overlayObj.overlayId);
                    if (![OverlayTibType.Ore, OverlayTibType.Gems, OverlayTibType.Vinifera].includes(tibType)) {
                        console.warn(`Found unsupported TS tiberium overlay ${overlayObj.overlayId} @${tile.rx},${tile.ry}. Skipping.`);
                        continue;
                    }
                    if (this.map.getObjectsOnTile(tile).find((obj: any) => obj.isTerrain())) {
                        overlayObj.dispose();
                        continue;
                    }
                }
                if (noHarvesters && overlayObj.isTiberium()) {
                    overlayObj.dispose();
                }
                else {
                    this.spawnObject(overlayObj, tile);
                }
            }
        }
        for (const [tile, bridgeObj] of bridgeObjects) {
            const isXBridge = bridgeObj.isXBridge();
            const prevTile = this.map.tiles.getByMapCoords(tile.rx + (isXBridge ? 0 : -1), tile.ry + (isXBridge ? -1 : 0));
            const nextTile = this.map.tiles.getByMapCoords(tile.rx + (isXBridge ? 0 : 1), tile.ry + (isXBridge ? 1 : 0));
            if (prevTile && nextTile && (bridgeSegments.get(prevTile) === 0 || bridgeSegments.get(nextTile) === 2)) {
                bridgeObj.value = 0;
                this.spawnObject(bridgeObj, prevTile);
            }
            else {
                bridgeObj.dispose();
                console.warn(`Invalid bridge segment @${tile.rx},${tile.ry}. Skipping.`);
            }
        }
        const lowBridgeHeadTiles = [...bridgeObjects.keys()].filter((tile: any) => this.map.bridges.getPieceAtTile(tile)?.headType !== BridgeHeadType.None);
        const highBridgeHeadTiles = this.map.bridges.findMapHighBridgeHeadTiles();
        const bridgeSpecs = this.map.bridges.findBridgeSpecsForHeadTiles([...lowBridgeHeadTiles, ...highBridgeHeadTiles]);
        for (const spec of bridgeSpecs) {
            for (const piece of this.map.bridges.findBridgePieces(spec)) {
                piece.obj.bridgeTrait.bridgeSpec = spec;
            }
        }
        const allBridgeTiles = bridgeSpecs
            .map((spec: any) => this.map.bridges.findAllBridgeTiles(spec))
            .flat();
        const placeholderId = BridgeOverlayTypes.bridgePlaceholderIds[0];
        const placeholderName = this.rules.getOverlayName(placeholderId);
        for (const tile of allBridgeTiles) {
            const placeholder = this.createObject(ObjectType.Overlay, placeholderName);
            placeholder.overlayId = placeholderId;
            this.spawnObject(placeholder, tile);
        }
    }
    createInitialMapSmudges(smudges: any[]) {
        for (const smudge of smudges) {
            const name = smudge.name;
            const tile = this.map.tiles.getByMapCoords(smudge.rx, smudge.ry);
            if (!tile) {
                console.warn(`Invalid map object location (${smudge.rx},${smudge.ry})`, smudge);
                continue;
            }
            const smudgeObj = this.createObject(ObjectType.Smudge, name);
            this.spawnObject(smudgeObj, tile);
        }
    }
    createInitialMapTechnos(technos: any[]) {
        const tags = this.map.getTags();
        for (const techno of technos) {
            const name = techno.name;
            if (!this.validateMapObjectRulesAndArt(name, techno.type)) {
                continue;
            }
            const tile = this.map.tiles.getByMapCoords(techno.rx, techno.ry);
            if (!tile) {
                console.warn(`Invalid map object location (${techno.rx},${techno.ry})`, techno);
                continue;
            }
            const owner = this.resolveMapOwner(techno.owner);
            if (!owner) {
                console.warn(`Invalid owner "${techno.owner}" for map object`, techno);
                continue;
            }
            const obj = this.createObject(techno.type, name);
            if (techno.tag) {
                obj.tag = tags.find((tag: any) => tag.id === techno.tag);
            }
            obj.healthTrait.health = (techno.health / 256) * 100;
            let shouldDestroy = false;
            if (!obj.healthTrait.health) {
                if (!obj.isBuilding() || !obj.rules.leaveRubble) {
                    obj.dispose();
                    continue;
                }
                shouldDestroy = true;
            }
            if (techno.isInfantry() || techno.isVehicle() || techno.isAircraft()) {
                obj.direction = ((-techno.direction / 256) * 360 + 360) % 360;
                if (techno.isInfantry()) {
                    obj.position.subCell = techno.subCell;
                }
                let onBridge = false;
                if (techno.onBridge) {
                    if (tile.onBridgeLandType === undefined) {
                        console.warn(`Cannot place unit "${techno.name}" on a bridge because no bridge was found at ${tile.rx}, ${tile.ry}`);
                    }
                    else {
                        onBridge = true;
                    }
                }
                obj.onBridge = onBridge;
                obj.zone = getZoneType(onBridge ? tile.onBridgeLandType : tile.landType);
                if (onBridge) {
                    obj.position.tileElevation += this.map.tileOccupation.getBridgeOnTile(tile)?.tileElevation ?? 0;
                }
                if (techno.veterancy) {
                    obj.veteranTrait?.setRelativeXP(techno.veterancy);
                }
            }
            else {
                obj.poweredTrait?.setTurnedOn(techno.poweredOn);
            }
            this.changeObjectOwner(obj, owner);
            this.spawnObject(obj, tile);
            if (shouldDestroy) {
                this.destroyObject(obj, undefined, true);
            }
        }
    }
    validateMapObjectRulesAndArt(name: string, type: ObjectType): boolean {
        if (!this.rules.hasObject(name, type)) {
            // Retail defaults types that are declared in the type list but
            // carry no ini section (CALA02/CALOND02 on official co-op maps).
            if (!this.rules.ensureMapObjectDefaults?.(name, type)) {
                console.warn(`Map object '${name}' has no rules section. Skipping.`);
                return false;
            }
        }
        if (!this.art.hasObject(name, type)) {
            this.art.registerDefaultedArt?.(name, type);
            if (!this.art.hasObject(name, type)) {
                console.warn(`Map object '${name}' has no art section. Skipping.`);
                return false;
            }
        }
        return true;
    }
    createPlayerInitialUnits() {
        if (this.campaignMode) {
            return;
        }
        const countries = this.playerList.getCombatants().map((player: any) => player.country);
        const availableUnits = [...this.rules.infantryRules.values(), ...this.rules.vehicleRules.values()].filter((unit: any) => unit.allowedToStartInMultiplayer &&
            !unit.naval &&
            unit.techLevel !== -1 &&
            unit.techLevel <= this.rules.mpDialogSettings.techLevel &&
            !this.rules.general.baseUnit.includes(unit.name) &&
            countries.some((country: any) => unit.isAvailableTo(country) && unit.hasOwner(country)));
        for (const player of this.playerList.getCombatants()) {
            const startLoc = this.map.getStartingLocation?.(player.startLocation) ?? player.startLocationPoint;
            if (!startLoc) {
                throw new Error(`No starting location found for player ${player.name}`);
            }
            const startTile = this.map.tiles.getByMapCoords(startLoc.x, startLoc.y);
            const mcvName = this.rules.general.baseUnit.find((unitName: string) => {
                const unit = this.rules.getObject(unitName, ObjectType.Vehicle);
                return unit.isAvailableTo(player.country) && unit.hasOwner(player.country);
            });
            if (!mcvName) {
                throw new Error("No suitable MCV found for player country " + player.country?.name);
            }
            const mcvRules = this.rules.getObject(mcvName, ObjectType.Vehicle);
            const mcv = this.createUnitForPlayer(mcvRules, player);
            this.spawnObject(mcv, startTile);
            const startingUnits = StartingUnitsGenerator.generate(this.gameOpts.unitCount, [...this.rules.vehicleRules.keys()], availableUnits, player.country);
            if (this.gameModeType === GameModeType.Unholy) {
                startingUnits.push(...this.rules.general.baseUnit
                    .filter((unitName: string) => unitName !== mcvName)
                    .map((unitName: string) => ({
                    name: unitName,
                    type: ObjectType.Vehicle,
                    count: 1,
                })));
            }
            const spawnTiles: any[] = [];
            let useSpawnTiles = false;
            const tileFinder = new CardinalTileFinder(this.map.tiles, this.map.mapBounds, startTile, 4, 4, (tile: any) => !this.map
                .getGroundObjectsOnTile(tile)
                .find((obj: any) => !(obj.isSmudge() || (obj.isOverlay() && obj.isTiberium()))) &&
                this.map.terrain.getPassableSpeed(tile, SpeedType.Foot, false, false) > 0);
            const tileFinderMap = new Map<any, any>();
            let tileIndex = 0;
            for (const { name, type, count } of startingUnits) {
                let remaining = count;
                while (remaining > 0) {
                    let tile;
                    if (!useSpawnTiles) {
                        tile = tileFinder.getNextTile();
                        if (tile) {
                            spawnTiles.push(tile);
                        }
                        else {
                            useSpawnTiles = true;
                        }
                    }
                    if (useSpawnTiles && spawnTiles.length) {
                        const baseTile = spawnTiles[tileIndex];
                        let finder = tileFinderMap.get(baseTile);
                        if (!finder) {
                            finder = new CardinalTileFinder(this.map.tiles, this.map.mapBounds, baseTile, 1, 0, (tile: any) => !this.map
                                .getGroundObjectsOnTile(tile)
                                .find((obj: any) => !(obj.isSmudge() || (obj.isOverlay() && obj.isTiberium()))) &&
                                this.map.terrain.getPassableSpeed(tile, SpeedType.Foot, false, false) > 0);
                            tileFinderMap.set(baseTile, finder);
                        }
                        tileIndex = (tileIndex + 1) % spawnTiles.length;
                        tile = finder.getNextTile();
                    }
                    if (tile) {
                        const unitRules = this.rules.getObject(name, type);
                        if (type === ObjectType.Vehicle) {
                            const unit = this.createUnitForPlayer(unitRules, player);
                            this.applyInitialVeteran(unit, player);
                            this.spawnObject(unit, tile);
                            remaining--;
                        }
                        else if (type === ObjectType.Infantry) {
                            for (const subCell of Infantry.SUB_CELLS.slice(0, remaining)) {
                                const unit = this.createUnitForPlayer(unitRules, player);
                                unit.position.subCell = subCell;
                                this.applyInitialVeteran(unit, player);
                                this.spawnObject(unit, tile);
                                remaining--;
                            }
                        }
                        else {
                            throw new Error("Should not reach this line");
                        }
                    }
                    else {
                        remaining--;
                    }
                }
            }
        }
    }
    applyInitialVeteran(unit: any, player: any) {
        if (unit.veteranTrait) {
            if (this.rules.general.veteran.initialVeteran) {
                unit.veteranTrait.setVeteranLevel(VeteranLevel.Elite);
            }
            else if (player.country.hasVeteranUnit(unit.type, unit.name)) {
                unit.veteranTrait.setVeteranLevel(VeteranLevel.Veteran);
            }
        }
    }
    startAresMakeInfantryFromInfDeathAnim(victim: any, animationName: string, killer?: any): any {
        return this.aresMakeInfantryService.startInfDeathAnimation(
            victim,
            animationName,
            killer?.obj ?? killer,
            killer?.player,
            killer?.obj,
        );
    }

    startAresMakeInfantryFromDeathAnims(victim: any, animationName: string, killer?: any): any {
        return this.aresMakeInfantryService.startDeathAnims(
            victim,
            animationName,
            killer?.obj ?? killer,
            killer?.player,
            killer?.obj,
        );
    }

    createObject(type: ObjectType, name: string) {
        return this.objectFactory.create(type, name, this.rules, this.art);
    }
    createUnitForPlayer(unitRules: any, player: any) {
        if (![ObjectType.Aircraft, ObjectType.Vehicle, ObjectType.Infantry].includes(unitRules.type)) {
            throw new Error(`Attempted to create an invalid unit type "${unitRules.type}"`);
        }
        const unit = this.createObject(unitRules.type, unitRules.name);
        this.changeObjectOwner(unit, player);
        unit.purchaseValue = this.sellTrait.computePurchaseValue(unit.rules, player);
        return unit;
    }
    createProjectile(projectileName: string, fromObject: any, weapon: any, target: any, isShrapnel: boolean) {
        const projectile = this.createObject(ObjectType.Projectile, projectileName);
        projectile.fromWeapon = weapon;
        projectile.fromObject = fromObject;
        projectile.fromPlayer = fromObject.owner;
        projectile.target = target;
        projectile.isShrapnel = isShrapnel;
        return projectile;
    }
    createLooseProjectile(weaponName: string, fromPlayer: any, target: any) {
        const weaponRules = this.rules.getWeapon(weaponName);
        const projectileName = weaponRules.projectile;
        const projectileRules = this.rules.getProjectile(projectileName);
        const warheadRules = this.rules.getWarhead(weaponRules.warhead);
        const weapon = {
            minRange: 0,
            projectileRules: projectileRules,
            range: Number.POSITIVE_INFINITY,
            rules: weaponRules,
            speed: Weapon.computeSpeed(weaponRules, projectileRules),
            type: WeaponType.Primary,
            warhead: new Warhead(warheadRules),
        };
        const projectile = this.createObject(ObjectType.Projectile, projectileName);
        projectile.fromWeapon = weapon;
        projectile.fromObject = undefined;
        projectile.fromPlayer = fromPlayer;
        projectile.target = target;
        return projectile;
    }
    /** Register a renderer-facing animation event with the deterministic runtime. */
    private registerAresAnimationDamage(event: any): void {
        const name = event?.name;
        const tile = event?.tile ?? event?.centerTile;
        if (!name || !tile) return;

        let animationArt: any;
        try {
            animationArt = this.art?.getAnimation?.(name);
        }
        catch {
            return;
        }
        const definition = parseAresAnimationDamage(name, animationArt?.art);
        if (!definition || definition.damage <= 0) return;

        const elevation = Number.isFinite(event.elevation)
            ? event.elevation
            : tile.z ?? 0;
        const position = event.position ?? Coords.tile3dToWorld(
            tile.rx + 0.5,
            tile.ry + 0.5,
            tile.z + elevation,
        );
        const zone = event.zone ?? this.map?.getTileZone?.(tile) ?? ZoneType.Ground;
        this.aresAnimationDamageRuntime.spawn({
            definition,
            tile,
            position,
            elevation,
            zone,
            sourcePlayer: event.sourcePlayer,
            sourceObject: event.sourceObject,
        });
    }

    private updateAresAnimationDamage(): void {
        this.aresAnimationDamageRuntime.update({
            applyAresAnimationDamageArea: (request) => this.applyAresAnimationDamageArea(request),
        });
    }

    /**
     * Deliver one standalone Ares [Animation] damage step through the normal
     * Warhead detonation path. The runtime owns animation lifetime and frame
     * timing; this method owns the shared area filtering and combat effects.
     */
    applyAresAnimationDamageArea(request: AresAnimationDamageDelivery): void {
        if (!request.tile || !request.damage) return;

        const delivery = this.resolveAresAnimationDamageDelivery(
            request.definition,
            undefined,
            request.sourcePlayer,
        );
        if (!delivery) return;

        delivery.warhead.detonate(
            this as any,
            request.damage,
            request.tile,
            request.elevation ?? 0,
            request.position ?? Coords.tile3dToWorld(
                request.tile.rx + 0.5,
                request.tile.ry + 0.5,
                request.tile.z + (request.elevation ?? 0),
            ),
            request.zone ?? ZoneType.Ground,
            CollisionType.None,
            this.createTarget(undefined, request.tile),
            delivery.weaponInfo,
            false,
            undefined,
            undefined,
            false,
            undefined,
            true,
        );
    }

    /**
     * Deliver one attached Ares [Animation] damage step. AttachEffect keeps
     * the target-specific lifetime and accumulator, while the actual hit is
     * still resolved by the same Warhead/Weapon implementation as standalone
     * animation damage.
     */
    applyAresAnimationDamage(request: {
        target: any;
        animation: {
            name: string;
            warhead?: string;
            weapon?: string;
        };
        damage: number;
        sourcePlayer?: any;
    }): void {
        const target = request.target;
        if (!target || target.isDestroyed || target.isDisposed || target.isCrashing ||
            !target.isSpawned || !target.position?.worldPosition) {
            return;
        }

        const centerTile = target.isBuilding?.() ? target.centerTile : target.tile;
        if (!centerTile) return;
        const delivery = this.resolveAresAnimationDamageDelivery(
            request.animation,
            target,
            request.sourcePlayer ?? target.owner,
        );
        if (!delivery) return;

        delivery.warhead.detonate(
            this as any,
            request.damage,
            centerTile,
            target.tileElevation ?? 0,
            target.position.worldPosition,
            target.zone ?? ZoneType.Ground,
            CollisionType.None,
            this.createTarget(target, centerTile),
            delivery.weaponInfo,
            false,
            undefined,
        );
    }

    private resolveAresAnimationDamageDelivery(
        animation: {
            name: string;
            warhead?: string;
            weapon?: string;
        },
        target?: any,
        sourcePlayer?: any,
    ): { warhead: Warhead; weaponInfo: any } | undefined {
        try {
            let warheadName = animation.warhead;
            let weaponInfo: any = {
                player: sourcePlayer,
                obj: undefined,
                weapon: undefined,
            };

            if (animation.weapon) {
                const weaponRules = this.rules.getWeapon(animation.weapon);
                warheadName = weaponRules.warhead;
                if (warheadName === Warhead.SPECIAL_WARHEAD_NAME) {
                    if (!target) return undefined;
                    warheadName = Weapon.findSpecialWarheadName(weaponRules, target, this.rules);
                }
                const projectileRules = this.rules.getProjectile(weaponRules.projectile);
                const animationWeapon = {
                    gameObject: undefined,
                    projectileRules,
                    rules: weaponRules,
                    type: WeaponType.Primary,
                };
                // Ares 2.0 documents that Weapon= animation damage has no
                // player owner. Keep that distinction from direct Warhead=.
                weaponInfo = { player: undefined, obj: undefined, weapon: animationWeapon };
            }
            else if (!warheadName) {
                warheadName = animation.name.toLocaleLowerCase("en-US") === "inviso"
                    ? this.rules.combatDamage.c4Warhead
                    : this.rules.combatDamage.flameDamage2 ?? this.rules.combatDamage.c4Warhead;
            }

            if (!warheadName) return undefined;
            return {
                warhead: new Warhead(this.rules.getWarhead(warheadName)),
                weaponInfo,
            };
        }
        catch (error) {
            console.warn(`Ares animation damage for "${animation.name}" was skipped:`, error);
            return undefined;
        }
    }
    createSuperWeapon(name: string, owner: any, isReady: boolean = false) {
        const rules = this.rules.getSuperWeapon(name);
        return new SuperWeapon(name, rules, owner, isReady);
    }
    createTarget(obj: any, tile: any, bridgeMode: TargetBridgeMode = TargetBridgeMode.Auto) {
        return new Target(obj, tile, this.map.tileOccupation, bridgeMode);
    }
    isValidTarget(obj: any): boolean {
        if (obj) {
            if (!obj.isSpawned || obj.isCrashing) {
                return false;
            }
            if (!(obj.rules.legalTarget || (obj.isBuilding() && obj.rules.hospital))) {
                return false;
            }
            if (obj.isBuilding() && obj.rules.invisibleInGame) {
                return false;
            }
        }
        return true;
    }
    spawnObject(obj: any, tile: any) {
        if (obj.isTechno() && obj.limboData) {
            throw new Error(`Object ${obj.name}#${obj.id} is in limbo. Use unlimboObject instead or clear limboData first`);
        }
        this.doSpawnObject(obj, tile);
    }
    unspawnObject(obj: any) {
        if (obj.isTechno() && obj.owner) {
            obj.owner.removeOwnedObject(obj);
        }
        this.doUnspawnObject(obj);
    }
    limboObject(obj: any, limboData: any) {
        obj.limboData = limboData;
        this.doUnspawnObject(obj);
    }
    restoreSpawnedObject(obj: any, tile: any): void {
        if (obj.isSpawned) {
            return;
        }
        obj.position.tile = tile;
        if (obj.isBuilding()) {
            const center = obj.art.foundationCenter;
            const centerX = tile.rx + center.x;
            const centerY = tile.ry + center.y;
            obj.centerTile = this.map.tiles.getByMapCoords(centerX, centerY) ?? this.map.tiles.getPlaceholderTile(centerX, centerY);
        }
        this.world.spawnObject(obj);
        if (obj.cachedTraits.tick.length || obj.isProjectile() || obj.isDebris() || obj.isTechno()) {
            this.updatableObjects.add(obj);
        }
        if (obj.isTechno()) {
            this.map.technosByTile.add(obj);
        }
        if (!obj.isProjectile() && !obj.isDebris()) {
            this.map.tileOccupation.occupyTileRange(tile, obj);
        }
        if (obj.art.canHideThings) {
            this.map.tileOcclusion.addOccluder(obj);
        }
        obj.isSpawned = true;
    }
    restoreUnspawnedObject(obj: any): void {
        if (!obj.isSpawned) {
            return;
        }
        const tile = obj.tile;
        if (!obj.isProjectile() && !obj.isDebris()) {
            this.map.tileOccupation.unoccupyTileRange(tile, obj);
        }
        if (obj.art.canHideThings) {
            this.map.tileOcclusion.removeOccluder(obj);
        }
        if (obj.isTechno()) {
            this.unitSelection.cleanupUnit(obj);
            this.map.technosByTile.remove(obj);
        }
        this.world.removeObject(obj);
        this.updatableObjects.delete(obj);
        obj.isSpawned = false;
    }
    unlimboObject(obj: any, tile: any, skipSelection: boolean = false) {
        const limboData = obj.limboData;
        if (!limboData) {
            throw new Error(`Object ${obj.name}#${obj.id} has no limboData attached`);
        }
        obj.limboData = undefined;
        this.doSpawnObject(obj, tile);
        const selection = this.getUnitSelection();
        if (limboData.selected && !skipSelection) {
            selection.addToSelection(obj);
        }
        if (limboData.controlGroup !== undefined) {
            selection.addUnitsToGroup(limboData.controlGroup, [obj], false);
        }
    }
    private doSpawnObject(obj: any, tile: any) {
        obj.position.tile = tile;
        if (obj.isBuilding()) {
            const center = obj.art.foundationCenter;
            const centerX = tile.rx + center.x;
            const centerY = tile.ry + center.y;
            obj.centerTile = this.map.tiles.getByMapCoords(centerX, centerY) ?? this.map.tiles.getPlaceholderTile(centerX, centerY);
        }
        this.world.spawnObject(obj);
        if (obj.cachedTraits.tick.length || obj.isProjectile() || obj.isDebris() || obj.isTechno()) {
            this.updatableObjects.add(obj);
        }
        if (obj.isTechno()) {
            this.map.technosByTile.add(obj);
        }
        if (!obj.isProjectile() && !obj.isDebris()) {
            this.map.tileOccupation.occupyTileRange(tile, obj);
        }
        if (obj.art.canHideThings) {
            this.map.tileOcclusion.addOccluder(obj);
        }
        obj.onSpawn(this);
        this.traits.filter(NotifySpawn).forEach((trait: NotifySpawn) => {
            trait[NotifySpawn.onSpawn](obj, this);
        });
        this.events.dispatch(new ObjectSpawnEvent(obj));
    }
    private doUnspawnObject(obj: any) {
        const tile = obj.tile;
        if (!obj.isProjectile() && !obj.isDebris()) {
            this.map.tileOccupation.unoccupyTileRange(tile, obj);
        }
        if (obj.art.canHideThings) {
            this.map.tileOcclusion.removeOccluder(obj);
        }
        if (obj.isTechno()) {
            this.unitSelection.cleanupUnit(obj);
            this.map.technosByTile.remove(obj);
        }
        this.world.removeObject(obj);
        this.updatableObjects.delete(obj);
        obj.onUnspawn(this);
        this.traits.filter(NotifyUnspawn).forEach((trait: NotifyUnspawn) => {
            trait[NotifyUnspawn.onUnspawn](obj, this);
        });
        this.events.dispatch(new ObjectUnspawnEvent(obj));
    }
    destroyObject(obj: any, killer?: any, silent: boolean = false, skipEvents: boolean = false) {
        if (!obj.aresInfDeathAnimationHandled && !obj.aresMakeInfantryServiceHandling && this.aresMakeInfantryService) {
            const pending = this.aresMakeInfantryService.startFromObjectDeath(obj, killer);
            if (pending && (obj.isDestroyed || obj.isDisposed)) {
                return;
            }
        }
        // Multiple effects can legitimately converge on the same target
        // before the next object-update pass.  Destruction is a terminal
        // operation, so a stale second request must be idempotent instead of
        // crashing the simulation or awarding the kill twice.
        if (obj.isDestroyed || obj.isDisposed) {
            return;
        }
        if (obj.isTechno()) {
            const originalOwner = obj.mindControllableTrait?.getOriginalOwner() ?? obj.owner;
            const killerPlayer = killer?.player;
            if (killerPlayer && (obj.isBuilding() || originalOwner?.isCombatant?.())) {
                killerPlayer.addUnitsKilled?.(obj.type, 1);
                if (originalOwner && killerPlayer !== originalOwner && !this.alliances.areAllied(killerPlayer, originalOwner)) {
                    killerPlayer.score += obj.rules.points;
                }
            }
            if (originalOwner && !originalOwner.isNeutral) {
                originalOwner.addUnitsLost(obj.type, 1);
            }
        }
        const bountyAward = resolveAresBountyAward(this, killer, obj);
        if (bountyAward) {
            const bountyTransaction = applyAresBountyAward(bountyAward);
            // Antares records the authored signed bounty for presentation,
            // while the credit ledger applies the clamped transaction delta.
            // Keep those two values distinct when a negative bounty exceeds
            // the killer's available credits.
            if (bountyTransaction.display && bountyTransaction.amount !== 0) {
                const position = obj.position?.worldPosition?.clone?.() ?? obj.position?.worldPosition;
                this.events.dispatch(new AresBountyAwardEvent(
                    bountyTransaction.player,
                    bountyTransaction.source,
                    bountyTransaction.target,
                    bountyTransaction.amount,
                    position,
                ));
            }
        }
        obj.isDestroyed = true;
        if (obj.healthTrait) {
            obj.healthTrait.health = 0;
        }
        obj.onDestroy(this, killer, silent);
        this.traits.filter(NotifyDestroy).forEach((trait: NotifyDestroy) => {
            trait[NotifyDestroy.onDestroy](obj, this, killer);
        });
        const killAttribution = createAresKillAttribution(killer);
        const recipients = resolveAresVeterancyRecipients(killAttribution, this);
        const dispatched = new Set<any>();
        for (const recipient of recipients) {
            if (dispatched.has(recipient.object)) continue;
            dispatched.add(recipient.object);
            recipient.object?.traits?.filter(NotifyTargetDestroy).forEach((trait: NotifyTargetDestroy) => {
                trait[NotifyTargetDestroy.onDestroy](killer?.obj, obj, killer?.weapon, this, killAttribution);
            });
        }
        this.events.dispatch(new ObjectDestroyEvent(obj, killer, skipEvents));
        if (killer?.player && killer.player.isAi !== true && killer.player.isObserver !== true) {
            this.events.dispatch(new ObjectDiscoveredEvent(obj, killer.player));
        }
        if (obj.isBuilding() && obj.rules.leaveRubble && obj.deathType !== DeathType.Temporal) {
            obj.owner.removeOwnedObject(obj);
            this.unitSelection.cleanupUnit(obj);
            const tiles = this.map.tileOccupation.calculateTilesForGameObject(obj.tile, obj);
            this.map.terrain.invalidateTiles(tiles);
            if (obj.art.canHideThings) {
                this.map.tileOcclusion.removeOccluder(obj);
            }
            this.updatableObjects.delete(obj);
            obj.onUnspawn(this);
            this.traits.filter(NotifyUnspawn).forEach((trait: NotifyUnspawn) => {
                trait[NotifyUnspawn.onUnspawn](obj, this);
            });
            this.events.dispatch(new ObjectUnspawnEvent(obj));
        }
        else if (obj.isSpawned) {
            this.unspawnObject(obj);
        }
        else if (obj.isTechno() && obj.owner) {
            if (!obj.limboData) {
                throw new Error(`Object with ID "${obj.id}" should be in limbo but has no limboData`);
            }
            obj.owner.removeOwnedObject(obj);
        }
        obj.dispose();
    }
    getObjectById(id: number) {
        return this.world.getObjectById(id);
    }
    changeObjectOwner(obj: any, newOwner: any) {
        const oldOwner = obj.owner;
        if (oldOwner) {
            oldOwner.removeOwnedObject(obj);
        }
        newOwner.addOwnedObject(obj);
        if (oldOwner && oldOwner !== newOwner) {
            this.traits.filter(NotifyOwnerChange).forEach((trait: NotifyOwnerChange) => {
                trait[NotifyOwnerChange.onChange](obj, oldOwner, this);
            });
            obj.onOwnerChange(oldOwner, this);
            this.events.dispatch(new ObjectOwnerChangeEvent(obj, oldOwner));
            if (oldOwner === this.localPlayer && obj.owner !== this.localPlayer) {
                this.unitSelection.removeFromSelection([obj]);
                this.unitSelection.removeUnitsFromGroup([obj]);
            }
        }
    }
    addObjectTrait(obj: any, trait: any) {
        obj.addTrait(trait);
        this.traits.filter(NotifyObjectTraitAdd).forEach((t: NotifyObjectTraitAdd) => {
            t[NotifyObjectTraitAdd.onAdd](obj, trait, this);
        });
    }
    onAllianceChange(alliance: any, initiator: any, formed: boolean) {
        this.events.dispatch(new AllianceChangeEvent(alliance, formed ? AllianceEventType.Formed : AllianceEventType.Broken, initiator));
        this.traits.filter(NotifyAllianceChange).forEach((trait: NotifyAllianceChange) => {
            trait[NotifyAllianceChange.onChange](alliance, formed, this);
        });
    }
    update() {
        if (this.status === GameStatus.NotStarted) {
            return;
        }
        this.botManager.update(this);
        if (this.status !== GameStatus.Ended) {
            if (this.lastGameEndCheck === undefined || this.currentTime - this.lastGameEndCheck >= 1000) {
                this.checkGameEndConditions();
                this.lastGameEndCheck = this.currentTime;
            }
        }
        this.updatableObjectsSnapshot.length = 0;
        for (const obj of this.updatableObjects) {
            this.updatableObjectsSnapshot.push(obj);
        }
        try {
            for (let index = 0; index < this.updatableObjectsSnapshot.length; index++) {
                const obj = this.updatableObjectsSnapshot[index];
                if (obj.isSpawned) {
                    obj.update(this);
                }
            }
        }
        finally {
            this.updatableObjectsSnapshot.length = 0;
        }
        this.aresMakeInfantryService.update();
        this.updateAresAnimationDamage();
        this.playerList.getCombatants().forEach((player: any) => {
            player.cheerCooldownTicks = Math.max(0, player.cheerCooldownTicks - 1);
        });
        this.traits.filter(NotifyTick).forEach((trait: NotifyTick) => {
            trait[NotifyTick.onTick](this);
        });
        if (this.localPlayer && !this.localPlayer.isObserver && !this.localPlayer.defeated) {
            const selectedUnits = this.unitSelection.getSelectedUnits();
            if (selectedUnits.length === 1) {
                const unit = selectedUnits[0];
                if (unit.isTechno() && unit.owner !== this.localPlayer) {
                    const shroud = this.mapShroudTrait.getPlayerShroud(this.localPlayer);
                    const tiles = this.map.tileOccupation.calculateTilesForGameObject(unit.tile, unit);
                    const isVisible = tiles.find((tile: any) => !shroud.isShrouded(tile, unit.tileElevation));
                    if (!isVisible) {
                        this.unitSelection.deselectAll();
                        this.unitSelection.cleanupUnit(unit);
                    }
                }
            }
        }
        for (const callback of this.afterTickCallbacks) {
            callback();
        }
        this.afterTickCallbacks.length = 0;
        this.triggers.update(this);
        this.completePendingCampaignOutcome();
        this.countdownTimer.update(this);
        this.currentTick++;
        this.currentTime += 1000 / GameSpeed.BASE_TICKS_PER_SECOND;
    }
    afterTick(callback: () => void) {
        this.afterTickCallbacks.push(callback);
    }
    isCampaignGlobalVariableEnabled(index: string | number): boolean {
        const id = String(index);
        if (this.triggersInitialized && typeof this.triggers?.getGlobalVariable === "function") {
            return this.triggers.getGlobalVariable(id);
        }
        const variables = this.campaignSession?.globalVariables;
        if (id === "1" && this.campaignSession?.alternateNextScenario !== undefined) {
            return Boolean(this.campaignSession.alternateNextScenario);
        }
        return Boolean(variables?.[id] ?? variables?.[Number(id)]);
    }
    hasScriptedCampaignOutcome(): boolean {
        if (!this.campaignMode) {
            return false;
        }
        const triggers = this.map?.getTriggers?.() ?? [];
        return triggers.some((trigger: any) => trigger.actions?.some((action: any) => {
            const type = typeof action.type === "string" ? action.type.toLocaleLowerCase("en-US") : action.type;
            return type === 1 || type === 2 || type === 69 ||
                type === "win" || type === "lose" || type === "forceend" || type === "force-end";
        }));
    }
    checkGameEndConditions() {
        if (this.campaignMode && this.pendingCampaignOutcome) {
            this.completePendingCampaignOutcome();
            if (this.pendingCampaignOutcome || this.campaignOutcome) {
                return;
            }
        }
        if (this.campaignOutcome || (this.campaignMode && this.hasScriptedCampaignOutcome())) {
            return;
        }
        this.updateDefeatedPlayers(this.playerList.getCombatants());
        const shouldEnd = (this.localPlayer?.defeated && !this.localPlayer.isObserver) ||
            (!this.alliances.getHostilePlayers().length &&
                this.gameOpts.humanPlayers.length + this.gameOpts.aiPlayers.filter((p: any) => !!p).length > 1);
        if (shouldEnd) {
            const noHostilePlayers = !this.alliances.getHostilePlayers().length;
            if (this.campaignMode && !this.localPlayer?.defeated && noHostilePlayers &&
                this.triggers.hasAllowWinHold?.(this.localPlayer, this)) {
                this.win();
            }
            else {
                this.end();
            }
        }
    }
    private getSelectedNextScenario(): string {
        return this.isCampaignGlobalVariableEnabled("1") && this.altNextScenario
            ? this.altNextScenario
            : this.nextScenario;
    }
    setCampaignOutcome(kind: CampaignOutcomeKind, house?: any): CampaignGameResult | undefined {
        if (this.campaignResult) {
            return this.campaignResult;
        }
        const target = house === undefined ? this.localPlayer : this.resolveMapOwner(house);
        const local = this.localPlayer;
        const localIsTarget = !target || target === local;
        const localHasAlliedTarget = Boolean(target && local && this.alliances.areAllied(local, target));
        let victory: boolean;
        if (kind === "force-end") {
            victory = !local?.defeated;
        }
        else if (localIsTarget || localHasAlliedTarget) {
            victory = kind === "win";
        }
        else {
            victory = kind === "lose";
        }
        let victoryHouse: any;
        if (kind === "win" && (localIsTarget || localHasAlliedTarget)) {
            victoryHouse = target;
        }
        else if (kind === "lose" && !localIsTarget && !localHasAlliedTarget) {
            victoryHouse = local;
        }
        if (this.campaignMode && victoryHouse && this.triggers.hasAllowWinHold?.(victoryHouse, this)) {
            this.pendingCampaignOutcome = { kind, house: target };
            return undefined;
        }
        const result: CampaignGameResult = {
            outcome: kind,
            victory,
            scripted: true,
            house: target,
            houseName: target?.houseName ?? target?.name,
            nextScenario: this.getSelectedNextScenario(),
            altNextScenario: this.altNextScenario,
            endOfGame: this.endOfGame,
            skipScore: this.skipScore,
        };
        this.pendingCampaignOutcome = undefined;
        this.triggerOutcome = undefined;
        this.campaignOutcome = result;
        this.campaignResult = result;
        return result;
    }
    completePendingCampaignOutcome(): void {
        if (!this.campaignMode || !this.pendingCampaignOutcome || this.campaignResult ||
            this.status === GameStatus.Ended) {
            return;
        }
        const pending = this.pendingCampaignOutcome;
        if (this.setCampaignOutcome(pending.kind, pending.house)) {
            this.end();
        }
    }
    win(house?: any): void {
        if (!this.campaignMode) {
            this.end();
            return;
        }
        if (this.setCampaignOutcome("win", house)) {
            this.end();
        }
    }
    lose(house?: any): void {
        if (!this.campaignMode) {
            this.end();
            return;
        }
        if (this.setCampaignOutcome("lose", house)) {
            this.end();
        }
    }
    forceEnd(house?: any): void {
        if (!this.campaignMode) {
            this.end();
            return;
        }
        if (this.setCampaignOutcome("force-end", house)) {
            this.end();
        }
    }
    getCampaignResult(): CampaignGameResult | undefined {
        return this.campaignResult;
    }
    getCampaignState(): any {
        return {
            session: this.campaignSession,
            nextScenario: this.nextScenario,
            altNextScenario: this.altNextScenario,
            endOfGame: this.endOfGame,
            skipScore: this.skipScore,
            oneTimeOnly: this.oneTimeOnly,
            ignoreGlobalAITriggers: this.ignoreGlobalAITriggers,
            fixedAlliance: this.fixedAlliance,
            result: this.campaignResult,
        };
    }
    end(result?: CampaignOutcomeKind | { outcome?: CampaignOutcomeKind; house?: any }) {
        if (this.campaignMode && !this.campaignResult) {
            const authoredOutcome = this.triggerOutcome;
            if (authoredOutcome && !result) {
                const kind: CampaignOutcomeKind = authoredOutcome.outcome === "won" ? "win" : "lose";
                const target = authoredOutcome.player ?? authoredOutcome.playerIndex;
                if (!this.setCampaignOutcome(kind, target)) {
                    return;
                }
            }
            else if (!result && this.pendingCampaignOutcome) {
                const pending = this.pendingCampaignOutcome;
                if (!this.setCampaignOutcome(pending.kind, pending.house)) {
                    return;
                }
            }
            if (result) {
                const kind = typeof result === "string" ? result : result.outcome;
                if (kind && !this.setCampaignOutcome(kind, typeof result === "string" ? undefined : result.house)) {
                    return;
                }
            }
            else if (this.status !== GameStatus.Ended && !this.campaignResult) {
                this.campaignResult = {
                    outcome: "force-end",
                    victory: !this.localPlayer?.defeated,
                    scripted: this.hasScriptedCampaignOutcome(),
                    nextScenario: this.getSelectedNextScenario(),
                    altNextScenario: this.altNextScenario,
                    endOfGame: this.endOfGame,
                    skipScore: this.skipScore,
                };
                this.campaignOutcome = this.campaignResult;
            }
        }
        if (this.status !== GameStatus.Ended) {
            this.status = GameStatus.Ended;
            this._onEnd.dispatch(this, undefined);
        }
    }
    updateDefeatedPlayers(players: any[]) {
        if (this.campaignOutcome || (this.campaignMode && this.pendingCampaignOutcome) ||
            (this.campaignMode && this.hasScriptedCampaignOutcome())) {
            return;
        }
        const isStalemate = this.stalemateDetectTrait?.isStale() && this.stalemateDetectTrait.getCountdownTicks() === 0;
        const shortGame = this.gameOpts.shortGame;
        players.forEach((player: any) => {
            let isDefeated: boolean;
            if (isStalemate) {
                isDefeated = true;
            }
            else {
                let hasAssets: boolean;
                if (shortGame) {
                    const hasSignificantBuilding = [...player.getOwnedObjectsByType(ObjectType.Building, true)].some((obj: any) => !obj.rules.insignificant);
                    hasAssets = hasSignificantBuilding || player.getOwnedObjects(true).some((obj: any) => this.rules.general.baseUnit.includes(obj.name));
                }
                else {
                    hasAssets = player.getOwnedObjects(true).some((obj: any) => !obj.rules.insignificant && !obj.limboData?.inTransport);
                }
                isDefeated = !hasAssets;
            }
            if (isDefeated) {
                player.defeated = true;
                const hasHumanConflict = this.alliances.getHostilePlayers().some((pair: any) => !pair.first.isAi || !pair.second.isAi);
                if (hasHumanConflict) {
                    player.isObserver = true;
                }
                this.removeAllPlayerAssets(player);
                this.events.dispatch(new PlayerDefeatedEvent(player));
                if (hasHumanConflict) {
                    this.mapShroudTrait.getPlayerShroud(player)?.revealAll();
                    const wasRadarDisabled = player.radarTrait.isDisabled();
                    player.radarTrait.setDisabled(false);
                    if (wasRadarDisabled) {
                        this.events.dispatch(new RadarOnOffEvent(player, true));
                    }
                }
            }
        });
    }
    removeAllPlayerAssets(player: any) {
        player.getOwnedObjects().forEach((obj: any) => {
            if (!obj.isDestroyed) {
                if (obj.isBuilding() && obj.rules.returnable && obj.rules.needsEngineer && !obj.garrisonTrait) {
                    this.changeObjectOwner(obj, this.getCivilianPlayer());
                }
                else if (!(obj.isBuilding() && obj.wallTrait)) {
                    this.destroyObject(obj, undefined, true);
                }
            }
        });
        player.getOwnedObjects(true).forEach((obj: any) => {
            if (!obj.isDestroyed) {
                if (obj.limboData?.inTransport || (obj.isBuilding() && obj.wallTrait)) {
                    this.changeObjectOwner(obj, this.getCivilianPlayer());
                }
                else {
                    this.destroyObject(obj, undefined, true);
                }
            }
        });
    }
    redistributeAllPlayerAssets(player: any): boolean {
        if (player.isObserver) {
            return false;
        }
        if (!(this.rules.mpDialogSettings.mustAlly && !this.rules.mpDialogSettings.allyChangeAllowed)) {
            return false;
        }
        const allies = this.alliances.getAllies(player).filter((p: any) => !p.isAi && !p.defeated);
        if (allies.length > 0) {
            const topAlly = [...allies].sort((a: any, b: any) => b.score - a.score)[0];
            for (const obj of player.getOwnedObjects(true)) {
                this.changeObjectOwner(obj, topAlly);
            }
            const creditsPerAlly = Math.floor(player.credits / allies.length);
            const remainder = player.credits % allies.length;
            for (const ally of allies) {
                ally.credits += creditsPerAlly;
            }
            allies[0].credits += remainder;
            return true;
        }
        return false;
    }
    generateRandomInt(min: number, max: number): number {
        return this.prng.generateRandomInt(min, max);
    }
    generateRandom(): number {
        return this.prng.generateRandom();
    }
    normalizeOwnerIdentity(value: any): string {
        return String(value ?? "").trim().toLocaleLowerCase("en-US");
    }
    getHash(): number {
        const prngHash = this.prng.getHash();
        const objects = this.world.getAllObjects().slice().sort((a: any, b: any) => a.id - b.id);
        return fnv32a([
            prngHash & 0xff,
            (prngHash >>> 8) & 0xff,
            (prngHash >>> 16) & 0xff,
            (prngHash >>> 24) & 0xff,
            this.currentTick,
            this.nextObjectId.value,
            this.countdownTimer.getHash(),
            ...objects.map((obj: any) => obj.getHash()),
            ...this.playerList.getAll().map((player: any) => player.getHash()),
            this.alliances.getHash(),
            this.alliances.isFixedAlliance?.() === true ? 1 : 0,
            this.unitSelection?.getHash?.() ?? 0,
            // Standalone Ares animation damage keeps its own frame clock and
            // pending-damage accumulators outside the object graph.
            this.aresAnimationDamageRuntime.getHash(),
            this.aresLaserFenceRuntime.getHash(),
            this.aresMakeInfantryService.getHash(),
            this.aresSecretLabService?.getHash?.() ?? 0,
            this.triggers?.getHash?.() ?? 0,
            this.teamRuntime?.getHash?.() ?? 0,
            this.rules?.getObjectTechLevelOverrideHash?.() ?? 0,
            ...this.traits.getAll().map((trait: any) => trait.getHash?.() ?? 0),
        ]);
    }
    debugGetState() {
        return {
            currentTick: this.currentTick,
            lastRandom: this.prng.getLastRandom(),
            nextObjectId: this.nextObjectId.value,
            objects: this.world.getAllObjects().map((obj: any) => obj.debugGetState()),
            players: this.playerList.getAll().map((player: any) => player.debugGetState()),
            alliances: this.alliances.debugGetState(),
            laserFences: this.aresLaserFenceRuntime.captureState(),
            objectTechLevels: this.rules?.captureObjectTechLevelOverrideState?.(),
            traits: this.traits.getAll().reduce((acc: any, trait: any) => {
                const state = trait.debugGetState?.();
                if (state !== undefined) {
                    acc[trait.constructor.name] = state;
                }
                return acc;
            }, {}),
        };
    }
    dispose() {
        this.world.getAllObjects().forEach((obj: any) => obj.dispose());
        this.playerList.getAll().forEach((player: any) => player.dispose());
        this.constructionWorkers.forEach((worker: any) => worker.dispose());
        this.botManager.dispose();
        this.aresMakeInfantryService.dispose();
        this.aresSecretLabService?.dispose?.();
        this.aresLaserFenceRuntime.dispose();
        this.triggers.dispose();
        this.map.dispose();
        this.traits.dispose();
    }
}
