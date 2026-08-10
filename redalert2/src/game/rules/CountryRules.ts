import { SideType } from "@/game/SideType";
import { AresSideRegistry } from "@/extensions/ares/AresSides";
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
    private id: string;
    public name!: string;
    public uiName!: string;
    private uiTooltip: string;
    public side!: SideType;
    public sideId!: string;
    public listIndex = 100;
    public randomSelectionWeight = 1;
    public multiplay: boolean;
    private multiplayPassive: boolean;
    private veteranAircraft: string[];
    private veteranInfantry: string[];
    private veteranUnits: string[];
    constructor(id: string) {
        this.id = id;
    }
    readIni(ini: any, sideRegistry: AresSideRegistry = AresSideRegistry.fromIni({ getSection: () => undefined })): CountryRules {
        this.name = ini.name;
        this.uiName = ini.getString("UIName");
        this.uiTooltip = ini.getString("UITooltip") || tooltipMap.get(this.name);
        const sideStr = ini.getString("Side");
        if (!sideStr) {
            throw new Error(`Missing Side for country "${this.name}"`);
        }
        const sideDescriptor = sideRegistry.resolve(sideStr);
        if (!sideDescriptor) {
            throw new Error(`Unknown side "${sideStr}" for country "${this.name}"`);
        }
        this.sideId = sideDescriptor.id;
        this.side = sideRegistry.toLegacySide(sideDescriptor.id);
        this.multiplay = ini.getBool("Multiplay");
        this.listIndex = ini.getNumber("ListIndex", 100);
        this.randomSelectionWeight = ini.getNumber("RandomSelectionWeight", 1);
        this.multiplayPassive = ini.getBool("MultiplayPassive");
        this.veteranAircraft = ini.getArray("VeteranAircraft");
        this.veteranInfantry = ini.getArray("VeteranInfantry");
        this.veteranUnits = ini.getArray("VeteranUnits");
        return this;
    }
}
