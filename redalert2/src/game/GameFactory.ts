import { Rules } from './rules/Rules';
import { Art } from './art/Art';
import { IniFile } from '../data/IniFile';
import { Country } from './Country';
import { ObjectFactory } from './gameobject/ObjectFactory';
import { World } from './World';
import { GameMap } from './GameMap';
import { GameOpts } from './gameopts/GameOpts';
import { OBS_COUNTRY_ID, RANDOM_COUNTRY_ID, RANDOM_COLOR_ID, RANDOM_START_POS } from './gameopts/constants';
import { isNotNullOrUndefined } from '../util/typeGuard';
import { Alliances } from './Alliances';
import { PlayerList } from './PlayerList';
import { UnitSelection } from './gameobject/selection/UnitSelection';
import { BoxedVar } from '../util/BoxedVar';
import { PlayerFactory } from './player/PlayerFactory';
import { PowerTrait } from './trait/PowerTrait';
import { SellTrait } from './trait/SellTrait';
import { RadarTrait } from './trait/RadarTrait';
import { ProductionTrait } from './trait/ProductionTrait';
import { MapShroudTrait } from './trait/MapShroudTrait';
import { Game } from './Game';
import { MapRadiationTrait } from './trait/MapRadiationTrait';
import { ActionFactory } from './action/ActionFactory';
import { ActionFactoryReg } from './action/ActionFactoryReg';
import { SuperWeaponsTrait } from './trait/SuperWeaponsTrait';
import { SharedDetectDisguiseTrait } from './trait/SharedDetectDisguiseTrait';
import { SharedDetectCloakTrait } from './trait/SharedDetectCloakTrait';
import { CrateGeneratorTrait } from './trait/CrateGeneratorTrait';
import { StalemateDetectTrait } from './trait/StalemateDetectTrait';
import { GameOptSanitizer } from './gameopts/GameOptSanitizer';
import { GameOptRandomGen } from './gameopts/GameOptRandomGen';
import { MapLightingTrait } from './trait/MapLightingTrait';
import { Prng } from './Prng';
import { Ai } from './ai/Ai';
import { BotFactory } from './bot/BotFactory';
import { BotManager } from './BotManager';
import { getCampaignSession, isCampaignGameOpts, isHumanPlayerInfo } from './gameopts/GameOpts';
import type { CampaignSession } from './gameopts/GameOpts';
import { TheaterType } from '@/engine/TheaterType';
interface GameMode {
    type: number;
}
interface GameModeRegistry {
    getById(modeId: number): GameMode;
}
interface PlayerInfo {
    countryId: string;
    colorId: string;
    startPos: number;
    name?: string;
}
interface HumanPlayerInfo extends PlayerInfo {
    name: string;
}
interface AiPlayerInfo extends PlayerInfo {
    difficulty: string;
    customBotId?: string;
}
interface GameCreationOptions {
    artOverrides?: IniFile;
    specialFlags: string[];
}
interface StartingLocations {
    [key: number]: any;
}
interface MultiplayerCountry {
    id: string;
    name: string;
}
interface CampaignPlayerOptions {
    name: string;
    country: Country;
    house: any;
    isAi: boolean;
    startLocation?: { x: number; y: number };
    startIndex?: number;
}
export class GameFactory {
    static create(gameOptions: GameCreationOptions, mapData: any, baseRules: IniFile, baseArt: IniFile, aiConfig: any, modRules: IniFile, additionalRules: IniFile[], randomSeed1: number | string, randomSeed2: number, gameOpts: GameOpts, gameModeRegistry: GameModeRegistry, skipStalemate: boolean, botConfig: any, debugFlags: any, speedCheat: any, debugBotIndex?: any, actionLogger?: any): Game {
        const mapFile = gameOptions as any;
        const campaignSession = getCampaignSession(gameOpts);
        const campaignMode = isCampaignGameOpts(gameOpts) || Boolean(mapFile.isCampaign || campaignSession);
        const mergedRules: IniFile = baseRules.clone().mergeWith(modRules);
        for (const additionalRule of additionalRules) {
            mergedRules.mergeWith(additionalRule);
        }
        mergedRules.mergeWith(mapFile);
        const mergedArt: IniFile = baseArt.clone().mergeWith(mapFile.artOverrides ?? new IniFile());
        const rules: Rules = new Rules(mergedRules, debugFlags);
        const art: Art = new Art(rules, mergedArt, gameOptions, debugFlags);
        const ai: Ai = new Ai(aiConfig);
        if (mapFile.specialFlags) {
            rules.applySpecialFlags(mapFile.specialFlags as any);
        }
        if (!campaignMode) {
            GameOptSanitizer.sanitize(gameOpts, rules);
        }
        const multiplayerCountries: MultiplayerCountry[] = rules.getMultiplayerCountries();
        const multiplayerColors: string[] = [...rules.getMultiplayerColors().values()] as any;
        const prng: Prng = Prng.factory(randomSeed1, randomSeed2);
        const gameMap: GameMap = new GameMap(mapFile, mapData, rules, prng.generateRandomInt.bind(prng));
        const world: World = new World();
        const gameMode: GameMode = gameModeRegistry.getById(gameOpts.gameMode as any);
        const playerList: PlayerList = new PlayerList();
        const alliances: Alliances = new Alliances(playerList);
        const unitSelection: UnitSelection = new UnitSelection();
        const tickCounter: BoxedVar<number> = new BoxedVar<number>(1);
        const objectFactory: ObjectFactory = new ObjectFactory(gameMap.tiles, gameMap.tileOccupation, gameMap.bridges, tickCounter, playerList);
        const actionFactory: ActionFactory = new ActionFactory();
        const botFactory: BotFactory = new BotFactory(botConfig);
        const botManager: BotManager = BotManager.factory(actionFactory, botFactory, debugBotIndex, actionLogger);
        const game: Game = new Game(world, gameMap, rules, art, ai, randomSeed1, randomSeed2, gameOpts, gameMode.type, playerList, unitSelection, alliances, tickCounter, objectFactory, botManager);
        game.configureCampaign(mapFile, campaignSession, campaignMode);
        new ActionFactoryReg().register(actionFactory, game, undefined);
        this.setupGameTraits(game, rules, gameMap, alliances, gameOpts, skipStalemate, speedCheat);
        const productionTrait: ProductionTrait = game.traits.get(ProductionTrait) as ProductionTrait;
        const theaterType = gameMap.getTheaterType();
        const theaterName = theaterType !== undefined
            ? TheaterType[theaterType]
            : undefined;
        const theater = theaterName && theaterName !== "None"
            ? theaterName
            : undefined;
        const playerFactory: PlayerFactory = new PlayerFactory(
            rules,
            gameOpts,
            productionTrait.getAvailableObjects(),
            theater,
            campaignMode,
        );
        if (campaignMode) {
            this.createCampaignPlayers(game, mapFile, rules, playerFactory, campaignSession);
        }
        else {
            const randomGen: GameOptRandomGen = GameOptRandomGen.factory(randomSeed1, randomSeed2);
            const generatedColors: Map<PlayerInfo, string> = randomGen.generateColors(gameOpts) as any;
            const generatedCountries: Map<PlayerInfo, string> = randomGen.generateCountries(gameOpts, rules) as any;
            const generatedStartLocations: Map<PlayerInfo, number> = randomGen.generateStartLocations(gameOpts, gameMap.startingLocations as any);
            const allPlayers: (HumanPlayerInfo | AiPlayerInfo)[] = [
                ...gameOpts.humanPlayers,
                ...gameOpts.aiPlayers
            ].filter(isNotNullOrUndefined) as any;
            this.createPlayers(game, allPlayers, playerFactory, multiplayerCountries, multiplayerColors, rules, generatedCountries, generatedColors, generatedStartLocations);
        }
        game.addPlayer(playerFactory.createNeutral(rules, "@@NEUTRAL@@"));
        alliances.setFixedAlliance(Boolean(mapFile.specialFlags?.fixedAlliance));
        this.applyCampaignAlliances(game, mapFile);
        return game;
    }
    private static createCampaignPlayers(game: Game, mapFile: any, rules: Rules, playerFactory: PlayerFactory, session?: CampaignSession): void {
        const houses = Array.isArray(mapFile.houses) ? mapFile.houses : [];
        const basicPlayer = String(mapFile.player ?? "").trim();
        const basicPlayerIndex = /^\d+$/.test(basicPlayer) ? Number(basicPlayer) : undefined;
        const requestedPlayerHouse = String(session?.playerHouse ?? "").trim();
        const requestedPlayerName = String(session?.playerName ?? game.gameOpts.humanPlayers?.[0]?.name ?? basicPlayer).trim();
        const alternate = this.useAlternateStart(session);
        let humanAssigned = false;
        if (houses.length) {
            for (const house of houses) {
                const resolved = this.resolveCampaignCountry(house.country || house.name, house.name, rules, house.actsLike);
                if (resolved.neutral || !resolved.country) {
                    continue;
                }
                const houseName = String(house.name ?? house.sectionName ?? "");
                const requestedHouseMatch = requestedPlayerHouse && (
                    this.normalizeIdentity(requestedPlayerHouse) === this.normalizeIdentity(houseName) ||
                    this.normalizeIdentity(requestedPlayerHouse) === this.normalizeIdentity(house.country) ||
                    this.normalizeIdentity(requestedPlayerHouse) === this.normalizeIdentity(house.index)
                );
                const basicHouseMatch = basicPlayer && (
                    this.normalizeIdentity(basicPlayer) === this.normalizeIdentity(houseName) ||
                    this.normalizeIdentity(basicPlayer) === this.normalizeIdentity(house.country) ||
                    house.index === basicPlayerIndex
                );
                const isHuman = !humanAssigned && (
                    Boolean(house.playerControl) ||
                    basicHouseMatch ||
                    (!basicPlayer && Boolean(requestedHouseMatch))
                );
                const startIndex = this.resolveCampaignStartIndex(house, mapFile, isHuman, alternate);
                const startLocation = mapFile.startingLocationsByWaypoint?.get(startIndex) ??
                    mapFile.getWaypointLocation?.(startIndex) ??
                    mapFile.startingLocations?.[startIndex];
                const color = this.resolveCampaignColor(house.color, rules, house.index);
                const name = isHuman ? requestedPlayerName || houseName : houseName;
                const player = playerFactory.createCombatant(
                    name,
                    resolved.country,
                    startIndex,
                    color,
                    !isHuman,
                    isHuman ? undefined : house.iq,
                    undefined,
                    {
                        houseName,
                        houseIndex: house.index,
                        mapHouse: house,
                        isCombatant: true,
                        credits: house.credits,
                        techLevel: house.techLevel ?? rules.mpDialogSettings.techLevel,
                        productionEnabled: house.productionEnabled === true,
                        startLocation,
                    },
                );
                game.addPlayer(player);
                if (isHuman) {
                    humanAssigned = true;
                }
            }
        }
        if (!game.getNonNeutralPlayers().length) {
            const allPlayers: (HumanPlayerInfo | AiPlayerInfo)[] = [
                ...game.gameOpts.humanPlayers,
                ...game.gameOpts.aiPlayers,
            ].filter(isNotNullOrUndefined) as any;
            const multiplayerCountries = rules.getMultiplayerCountries();
            const colors = [...rules.getMultiplayerColors().values()];
            for (const info of allPlayers) {
                const isHuman = isHumanPlayerInfo(info);
                const countryInfo = multiplayerCountries[info.countryId];
                if (!countryInfo) {
                    continue;
                }
                const startIndex = info.startPos >= 0 ? info.startPos : 0;
                const startLocation = mapFile.startingLocationsByWaypoint?.get(startIndex) ?? mapFile.startingLocations?.[startIndex];
                const player = playerFactory.createCombatant(
                    isHuman ? info.name : game.getAiPlayerName(info),
                    Country.factory(countryInfo.id, rules as any),
                    startIndex,
                    colors[info.colorId] ?? colors[0],
                    !isHuman,
                    isHuman ? undefined : (info as AiPlayerInfo).difficulty,
                    (info as AiPlayerInfo).customBotId,
                    {
                        startLocation,
                        productionEnabled: false,
                        isCombatant: true,
                        techLevel: rules.mpDialogSettings.techLevel,
                    },
                );
                game.addPlayer(player);
            }
        }
    }
    private static applyCampaignAlliances(game: Game, mapFile: any): void {
        for (const house of mapFile.houses ?? []) {
            const owner = game.getPlayerByHouseName?.(house.name);
            if (!owner) {
                continue;
            }
            for (const allyName of house.allies ?? []) {
                const ally = game.resolveMapOwner?.(allyName);
                if (!ally || ally === owner || ally.isNeutral || owner.isNeutral || game.alliances.areAllied(owner, ally)) {
                    continue;
                }
                const alliance = game.alliances.forceAlliance(owner, ally);
                game.onAllianceChange(alliance, owner, true);
            }
        }
    }
    private static resolveCampaignCountry(value: any, houseName: any, rules: Rules, actsLike?: any): { country?: Country; neutral: boolean } {
        const candidates = [value, actsLike, houseName]
            .filter((candidate) => candidate !== undefined && candidate !== null)
            .map((candidate) => String(candidate).trim())
            .filter(Boolean);
        const neutralAliases = new Set(["neutral", "special", "civilian", "none", "@@neutral@@", "<none>"]);
        if (candidates.some((candidate) => neutralAliases.has(candidate.toLocaleLowerCase("en-US")))) {
            return { neutral: true };
        }
        for (const candidate of candidates) {
            try {
                const countryId = rules.getCountry(candidate).id;
                return { country: Country.factory(countryId, rules as any), neutral: false };
            }
            catch {
            }
            const countries = rules.getMultiplayerCountries();
            const match = countries.find((country: any) =>
                this.normalizeIdentity(country.id) === this.normalizeIdentity(candidate) ||
                this.normalizeIdentity(country.name) === this.normalizeIdentity(candidate) ||
                this.normalizeIdentity(country.sideId) === this.normalizeIdentity(candidate) ||
                this.normalizeIdentity(country.side) === this.normalizeIdentity(candidate) ||
                this.normalizeIdentity(country.uiName) === this.normalizeIdentity(candidate));
            if (match) {
                return { country: Country.factory(match.id, rules as any), neutral: false };
            }
            if (/^\d+$/.test(candidate)) {
                const byIndex = countries[Number(candidate)];
                if (byIndex) {
                    return { country: Country.factory(byIndex.id, rules as any), neutral: false };
                }
            }
        }
        return { neutral: false };
    }
    private static resolveCampaignColor(value: any, rules: Rules, houseIndex: number): any {
        const colors = rules.colors;
        const requested = String(value ?? "").trim();
        const color = requested ? colors.get(requested) ?? [...colors.entries()].find(([name]) => this.normalizeIdentity(name) === this.normalizeIdentity(requested))?.[1] : undefined;
        if (color) {
            return color;
        }
        const values = [...colors.values()];
        return values[houseIndex % Math.max(1, values.length)];
    }
    private static resolveCampaignStartIndex(house: any, mapFile: any, isHuman: boolean, alternate: boolean): number {
        const candidates = isHuman
            ? [alternate ? house.altHomeCell : house.homeCell, house.startCell, house.startPos]
            : [house.homeCell, house.altHomeCell, house.startCell, house.startPos];
        const waypointNumbers = new Set<number>([
            ...(mapFile.waypoints ?? []).map((waypoint: any) => waypoint.number),
            ...(mapFile.startingLocationsByWaypoint?.keys?.() ?? []),
        ]);
        const hasLocation = (candidate: any): candidate is number =>
            Number.isSafeInteger(candidate) && candidate >= 0 &&
            (waypointNumbers.has(candidate) || (candidate < 8 && mapFile.startingLocations?.[candidate] !== undefined));
        for (const candidate of candidates) {
            if (hasLocation(candidate)) {
                return candidate;
            }
        }
        const basicCell = isHuman
            ? (alternate ? mapFile.altHomeCell : mapFile.homeCell)
            : undefined;
        if (hasLocation(basicCell)) {
            return basicCell;
        }
        if (hasLocation(house.index)) {
            return house.index;
        }
        return [...waypointNumbers].sort((left, right) => left - right)[0] ?? 0;
    }
    private static useAlternateStart(session?: CampaignSession): boolean {
        if (!session) {
            return false;
        }
        if (session.alternateStartLocation !== undefined) {
            return Boolean(session.alternateStartLocation);
        }
        const variables = session.globalVariables;
        return Boolean(variables?.["0"] ?? variables?.[0]);
    }
    private static normalizeIdentity(value: any): string {
        return String(value ?? "").trim().toLocaleLowerCase("en-US");
    }
    private static setupGameTraits(game: Game, rules: Rules, gameMap: GameMap, alliances: Alliances, gameOpts: GameOpts, skipStalemate: boolean, speedCheat: any): void {
        game.traits.add(new PowerTrait());
        const sellTrait: SellTrait = new SellTrait(game, rules.general);
        game.sellTrait = sellTrait;
        game.traits.add(sellTrait);
        game.traits.add(new RadarTrait());
        const productionTrait: ProductionTrait = new ProductionTrait(rules, speedCheat);
        game.traits.add(productionTrait);
        const mapShroudTrait: MapShroudTrait = new MapShroudTrait(gameMap, alliances);
        game.mapShroudTrait = mapShroudTrait;
        game.traits.add(mapShroudTrait);
        const mapRadiationTrait: MapRadiationTrait = new MapRadiationTrait(gameMap);
        (game as any).mapRadiationTrait = mapRadiationTrait;
        game.traits.add(mapRadiationTrait);
        const mapLightingTrait: MapLightingTrait = new MapLightingTrait(rules.audioVisual as any, gameMap.getLighting());
        (game as any).mapLightingTrait = mapLightingTrait;
        game.traits.add(mapLightingTrait);
        game.traits.add(new SuperWeaponsTrait());
        game.traits.add(new SharedDetectDisguiseTrait());
        game.traits.add(new SharedDetectCloakTrait());
        const crateGeneratorTrait: CrateGeneratorTrait = new CrateGeneratorTrait(gameOpts.cratesAppear);
        game.crateGeneratorTrait = crateGeneratorTrait;
        game.traits.add(crateGeneratorTrait);
        if (!skipStalemate) {
            const stalemateDetectTrait: StalemateDetectTrait = new StalemateDetectTrait();
            game.stalemateDetectTrait = stalemateDetectTrait;
            game.traits.add(stalemateDetectTrait);
        }
    }
    private static createPlayers(game: Game, allPlayers: (HumanPlayerInfo | AiPlayerInfo)[], playerFactory: PlayerFactory, multiplayerCountries: MultiplayerCountry[], multiplayerColors: string[], rules: Rules, generatedCountries: Map<PlayerInfo, string>, generatedColors: Map<PlayerInfo, string>, generatedStartLocations: Map<PlayerInfo, number>): void {
        allPlayers.forEach((playerInfo: HumanPlayerInfo | AiPlayerInfo) => {
            let playerName: string;
            let isAi: boolean;
            let aiDifficulty: string | undefined;
            let customBotId: string | undefined;
            if (isHumanPlayerInfo(playerInfo)) {
                playerName = playerInfo.name;
                isAi = false;
            }
            else {
                playerName = game.getAiPlayerName(playerInfo);
                isAi = true;
                aiDifficulty = (playerInfo as any).difficulty;
                customBotId = (playerInfo as any).customBotId;
            }
            if (playerInfo.countryId === (OBS_COUNTRY_ID as any)) {
                game.addPlayer(playerFactory.createObserver(playerName, rules));
                return;
            }
            const resolvedCountryId: string = generatedCountries.get(playerInfo) ?? playerInfo.countryId;
            const resolvedColorId: string = generatedColors.get(playerInfo) ?? playerInfo.colorId;
            const resolvedStartPos: number = generatedStartLocations.get(playerInfo) ?? playerInfo.startPos;
            this.validateResolvedValues(resolvedCountryId, resolvedColorId, resolvedStartPos);
            const countryEntry = multiplayerCountries[parseInt(resolvedCountryId)];
            if (!countryEntry) {
                throw new Error(`Unknown multiplayer country index "${resolvedCountryId}"`);
            }
            // The lobby/network still carries the deterministic multiplayer
            // index. Resolve it to the stable content-defined country ID
            // before constructing player state.
            const country: Country = Country.factory(countryEntry.id, rules as any);
            const color: string = multiplayerColors[parseInt(resolvedColorId)];
            const player = playerFactory.createCombatant(playerName, country, resolvedStartPos, color, isAi, aiDifficulty, customBotId);
            game.addPlayer(player);
        });
    }
    private static validateResolvedValues(countryId: string, colorId: string, startPos: number): void {
        if (countryId === (RANDOM_COUNTRY_ID as any)) {
            throw new Error("Random country should have been resolved by now");
        }
        if (colorId === (RANDOM_COLOR_ID as any)) {
            throw new Error("Random color should have been resolved by now");
        }
        if (startPos === (RANDOM_START_POS as any)) {
            throw new Error("Random start location should have been resolved by now");
        }
    }
}
