import { ObjectType } from '@/engine/type/ObjectType';
import { SideType } from '@/game/SideType';
interface CountryRules {
    id: string;
    side: SideType;
    sideId: string;
    name: string;
    uiName: string;
    uiTooltip?: string;
    presentationId?: string;
    flag?: string;
    loadScreen?: string;
    loadScreenPalette?: string;
    multiplay: boolean;
    isMultiplayerPassive: boolean;
    veteranAircraft: string[];
    veteranInfantry: string[];
    veteranUnits: string[];
    getCountry(id: string): CountryRules;
}
export class Country {
    private rules: CountryRules;
    static factory(id: string, rules: CountryRules): Country {
        return new this(rules.getCountry(id));
    }
    constructor(rules: CountryRules) {
        this.rules = rules;
    }
    get id(): string {
        return this.rules.id;
    }
    get side(): SideType {
        return this.rules.side;
    }
    get sideId(): string {
        return this.rules.sideId;
    }
    get uiName(): string {
        return this.rules.uiName;
    }
    get uiTooltip(): string | undefined {
        return this.rules.uiTooltip;
    }
    get presentationId(): string | undefined {
        return this.rules.presentationId;
    }
    get flag(): string | undefined {
        return this.rules.flag;
    }
    get loadScreen(): string | undefined {
        return this.rules.loadScreen;
    }
    get loadScreenPalette(): string | undefined {
        return this.rules.loadScreenPalette;
    }
    get isMultiplayerPassive(): boolean {
        return this.rules.isMultiplayerPassive;
    }
    get name(): string {
        return this.rules.name;
    }
    isPlayable(): boolean {
        return this.rules.multiplay && !this.rules.isMultiplayerPassive;
    }
    hasVeteranUnit(type: ObjectType, name: string): boolean {
        let veteranUnits: string[];
        switch (type) {
            case ObjectType.Aircraft:
                veteranUnits = this.rules.veteranAircraft;
                break;
            case ObjectType.Infantry:
                veteranUnits = this.rules.veteranInfantry;
                break;
            case ObjectType.Vehicle:
                veteranUnits = this.rules.veteranUnits;
                break;
            default:
                throw new Error(`Unsupported object type "${ObjectType[type]}"`);
        }
        return veteranUnits.includes(name);
    }
}
