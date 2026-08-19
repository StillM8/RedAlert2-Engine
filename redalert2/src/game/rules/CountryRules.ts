import { SideType } from "@/game/SideType";
import { AresSideRegistry, type CountryId, type SideId, type SideDescriptor } from "@/extensions/ares/AresSides";
const tooltipMap = new Map<string, string>([
    ["Americans", "STT:PlayerSideAmerica"],
    ["Alliance", "STT:PlayerSideKorea"],
    ["French", "STT:PlayerSideFrance"],
    ["Germans", "STT:PlayerSideGermany"],
    ["British", "STT:PlayerSideBritain"],
    ["Africans", "STT:PlayerSideLibya"],
    ["Arabs", "STT:PlayerSideIraq"],
    ["Confederation", "STT:PlayerSideCuba"],
    ["Russians", "STT:PlayerSideRussia"],
]);
export class CountryRules {
    /** Stable content-defined identity; never use the lobby array index here. */
    public readonly id: CountryId;
    public name!: string;
    public uiName!: string;
    public uiTooltip?: string;
    public side!: SideType;
    public sideId!: SideId;
    public sideDefinition!: SideDescriptor;
    /** Compatibility adapter for legacy simulation/UI consumers. */
    public legacySideFallback = false;
    public presentationId?: string;
    public flag?: string;
    public loadScreenTextName?: string;
    public loadScreenTextSpecialName?: string;
    public loadScreenTextBrief?: string;
    public loadScreenTextColor?: string;
    public loadScreen?: string;
    public loadScreenPalette?: string;
    public loadingTheme?: string;
    /** Country-level Ares parachute default, falling back to the side. */
    public parachuteAnim?: string;
    public listIndex = 100;
    /** Authored [Countries] order, used as the deterministic fallback order. */
    public order = 0;
    /** Legacy/network country index retained as an adapter, not the identity. */
    public networkIndex = -1;
    public randomSelectionWeight = 1;
    /** Ares country-level override for whether neutral-owned units can be reclaimed. */
    public canBeDriven = false;
    /** Ares country-level gate for whether destroying this country's objects awards bounty. */
    public givesBounty = true;
    public multiplay: boolean;
    private multiplayPassive: boolean;
    private veteranAircraft: string[];
    private veteranInfantry: string[];
    private veteranUnits: string[];
    constructor(id: string) {
        this.id = id;
    }
    readIni(
        ini: any,
        sideRegistry: AresSideRegistry = AresSideRegistry.fromIni({ getSection: () => undefined }),
        metadata?: { order?: number; networkIndex?: number },
    ): CountryRules {
        this.name = ini.name || this.id;
        this.uiName = ini.getString("UIName");
        this.uiTooltip = ini.getString("MenuText.Status") || ini.getString("UITooltip") || tooltipMap.get(this.name);
        const sideStr = ini.getString("Side");
        if (!sideStr) {
            throw new Error(`Missing Side for country "${this.name}"`);
        }
        const sideDescriptor = sideRegistry.resolve(sideStr);
        if (!sideDescriptor) {
            throw new Error(`Unknown side "${sideStr}" for country "${this.name}"`);
        }
        this.sideId = sideDescriptor.id;
        this.sideDefinition = { ...sideDescriptor };
        const legacySide = sideRegistry.resolveLegacySide(sideDescriptor.id);
        this.legacySideFallback = legacySide === undefined;
        this.side = legacySide ?? SideType.Civilian;
        this.presentationId = ini.getString("Presentation") || sideDescriptor.presentationId;
        this.flag = ini.getString("File.Flag") || ini.getString("Flag") || undefined;
        this.loadScreenTextName = ini.getString("LoadScreenText.Name") || undefined;
        this.loadScreenTextSpecialName = ini.getString("LoadScreenText.SpecialName") || undefined;
        this.loadScreenTextBrief = ini.getString("LoadScreenText.Brief") || undefined;
        this.loadScreenTextColor = ini.getString("LoadScreenText.Color") || undefined;
        this.loadScreen = ini.getString("File.LoadScreen") || ini.getString("LoadingScreen") || ini.getString("LoadScreen") || undefined;
        this.loadScreenPalette = ini.getString("File.LoadScreenPAL") || ini.getString("LoadingScreenPalette") || ini.getString("LoadScreenPalette") || undefined;
        this.loadingTheme = ini.getString("LoadingTheme") || undefined;
        this.parachuteAnim = ini.getString("Parachute.Anim") || sideDescriptor.parachuteAnim || undefined;
        this.multiplay = ini.getBool("Multiplay");
        this.listIndex = ini.getNumber("ListIndex", 100);
        this.order = metadata?.order ?? this.order;
        this.networkIndex = metadata?.networkIndex ?? this.networkIndex;
        this.randomSelectionWeight = ini.getNumber("RandomSelectionWeight", 1);
        this.multiplayPassive = ini.getBool("MultiplayPassive");
        // Ares defaults this to the country's passive-neutral status. An
        // explicit override is needed by Mental Omega's Neutral/Special
        // country definitions.
        this.canBeDriven = ini.has("CanBeDriven")
            ? ini.getBool("CanBeDriven")
            : this.multiplayPassive;
        this.givesBounty = ini.has("GivesBounty") ? ini.getBool("GivesBounty") : true;
        this.veteranAircraft = ini.getArray("VeteranAircraft");
        this.veteranInfantry = ini.getArray("VeteranInfantry");
        this.veteranUnits = ini.getArray("VeteranUnits");
        return this;
    }
    get isMultiplayerPassive(): boolean {
        return this.multiplayPassive;
    }
}
