import { ObjectType } from '@/engine/type/ObjectType';
import { SideType } from '@/game/SideType';
import type { CountryId, SideId, SideDescriptor } from '@/extensions/ares/AresSides';
interface CountryRules {
    id: CountryId;
    side: SideType;
    sideId: SideId;
    sideDefinition: SideDescriptor;
    name: string;
    uiName: string;
    uiTooltip?: string;
    presentationId?: string;
    flag?: string;
    loadScreenTextName?: string;
    loadScreenTextSpecialName?: string;
    loadScreenTextBrief?: string;
    loadScreenTextColor?: string;
    loadScreen?: string;
    loadScreenPalette?: string;
    loadingTheme?: string;
    parachuteAnim?: string;
    multiplay: boolean;
    isMultiplayerPassive: boolean;
    canBeDriven: boolean;
    givesBounty: boolean;
    legacySideFallback: boolean;
    order: number;
    networkIndex: number;
    listIndex: number;
    veteranAircraft: string[];
    veteranInfantry: string[];
    veteranUnits: string[];
}
interface CountryRulesLookup {
    getCountry(id: string): CountryRules;
}
export class Country {
    private rules: CountryRules;
    static factory(id: string, rules: CountryRulesLookup): Country {
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
    get sideDefinition(): SideDescriptor {
        return this.rules.sideDefinition
            ? { ...this.rules.sideDefinition }
            : { id: this.rules.sideId, legacySide: this.rules.side, order: 0 };
    }
    get legacySideFallback(): boolean {
        return this.rules.legacySideFallback;
    }
    get order(): number {
        return this.rules.order;
    }
    get networkIndex(): number {
        return this.rules.networkIndex;
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
    get loadScreenTextName(): string | undefined {
        return this.rules.loadScreenTextName;
    }
    get loadScreenTextSpecialName(): string | undefined {
        return this.rules.loadScreenTextSpecialName;
    }
    get loadScreenTextBrief(): string | undefined {
        return this.rules.loadScreenTextBrief;
    }
    get loadScreenTextColor(): string | undefined {
        return this.rules.loadScreenTextColor;
    }
    get loadScreen(): string | undefined {
        return this.rules.loadScreen;
    }
    get loadScreenPalette(): string | undefined {
        return this.rules.loadScreenPalette;
    }
    get loadingTheme(): string | undefined {
        return this.rules.loadingTheme;
    }
    get parachuteAnim(): string | undefined {
        return this.rules.parachuteAnim;
    }
    get isMultiplayerPassive(): boolean {
        return this.rules.isMultiplayerPassive;
    }
    get canBeDriven(): boolean {
        return this.rules.canBeDriven;
    }
    get givesBounty(): boolean {
        return this.rules.givesBounty;
    }
    get name(): string {
        return this.rules.name;
    }
    isPlayable(): boolean {
        return this.rules.multiplay && !this.rules.isMultiplayerPassive && this.rules.listIndex >= 0;
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
