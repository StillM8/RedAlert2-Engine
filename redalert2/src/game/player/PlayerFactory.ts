import { Player } from '@/game/Player';
import { Country } from '@/game/Country';
import { PowerTrait } from './trait/PowerTrait';
import { RadarTrait } from './trait/RadarTrait';
import { Production } from './production/Production';
import { SuperWeaponsTrait } from './trait/SuperWeaponsTrait';
import { SharedDetectDisguiseTrait } from './trait/SharedDetectDisguiseTrait';
export interface CombatantFactoryOptions {
    houseName?: string;
    houseIndex?: number;
    mapHouse?: any;
    credits?: number;
    techLevel?: number;
    productionEnabled?: boolean;
    aiTriggersEnabled?: boolean;
    startLocation?: { x: number; y: number };
    isCombatant?: boolean;
}
export class PlayerFactory {
    private rules: any;
    private gameOpts: any;
    private allAvailableObjects: any;
    private theater?: string;
    constructor(
        rules: any,
        gameOpts: any,
        allAvailableObjects: any,
        theater?: string,
        private campaignMode: boolean = false,
    ) {
        this.rules = rules;
        this.gameOpts = gameOpts;
        this.allAvailableObjects = allAvailableObjects;
        this.theater = theater;
    }
    createCombatant(id: any, country: any, team: any, color: any, isAi: boolean, aiDifficulty: any, customBotId?: string, options: CombatantFactoryOptions = {}): Player {
        let player = new Player(id, country, team, color, options.isCombatant === true);
        player.isAi = isAi;
        player.aiDifficulty = aiDifficulty;
        player.customBotId = customBotId;
        player.houseName = options.houseName;
        player.houseIndex = options.houseIndex;
        player.mapHouse = options.mapHouse;
        player.techLevel = options.techLevel;
        player.aiTriggersEnabled = options.aiTriggersEnabled ?? !this.campaignMode;
        if (options.startLocation) {
            player.startLocationPoint = options.startLocation;
        }
        if (options.credits !== undefined) {
            player.credits = options.credits;
        }
        player.powerTrait = new PowerTrait(player);
        player.traits.add(player.powerTrait);
        player.radarTrait = new RadarTrait();
        player.traits.add(player.radarTrait);
        player.superWeaponsTrait = new SuperWeaponsTrait();
        player.traits.add(player.superWeaponsTrait);
        player.production = Production.factory(
            player,
            this.rules,
            this.gameOpts,
            this.allAvailableObjects,
            this.theater,
            options.productionEnabled ?? true,
            options.techLevel,
        );
        player.sharedDetectDisguiseTrait = new SharedDetectDisguiseTrait();
        return player;
    }
    createObserver(id: any, rules: any): Player {
        let player = new Player(id, undefined, undefined, rules.colors.get("LightGrey"));
        player.radarTrait = new RadarTrait();
        player.traits.add(player.radarTrait);
        player.radarTrait.setDisabled(false);
        return player;
    }
    createNeutral(rules: any, id: any): Player {
        const neutralCountryRule = rules.getNeutralCountry();
        let country = new Country(neutralCountryRule);
        let player = new Player(id, country, undefined, rules.colors.get("LightGrey"));
        player.powerTrait = new PowerTrait(player);
        player.traits.add(player.powerTrait);
        return player;
    }
}
