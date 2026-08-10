import { SuperWeaponType } from '../type/SuperWeaponType';
import { parseAresSuperWeaponDefinition, parseSuperWeaponType, type AresSuperWeaponDefinition } from '@/extensions/ares/AresSuperWeapons';
export class SuperWeaponRules {
    public index: number;
    public disableableFromShell: boolean;
    public isPowered: boolean;
    public name: string;
    public preClick: boolean;
    public preDependent?: SuperWeaponType;
    public postClick: boolean;
    public range: number;
    public rechargeTime: number;
    public showTimer: boolean;
    public sidebarImage: string;
    public type?: SuperWeaponType;
    /** Raw Type= value; custom Ares handlers must not be coerced to vanilla. */
    public typeId?: string;
    public ares?: AresSuperWeaponDefinition;
    public uiName: string;
    public weaponType?: string;
    constructor(index: number) {
        this.index = index;
    }
    readIni(ini: any): this {
        this.disableableFromShell = ini.getBool("DisableableFromShell");
        this.isPowered = ini.getBool("IsPowered", true);
        this.name = ini.name;
        this.preClick = ini.getBool("PreClick");
        const preDependentId = ini.getString("PreDependent") || undefined;
        this.preDependent = parseSuperWeaponType(preDependentId);
        this.postClick = ini.getBool("PostClick");
        this.range = ini.getNumber("Range");
        this.rechargeTime = ini.getNumber("RechargeTime", 5);
        this.showTimer = ini.getBool("ShowTimer");
        this.sidebarImage = ini.getString("SidebarImage").toLowerCase();
        this.typeId = ini.getString("Type") || undefined;
        this.type = parseSuperWeaponType(this.typeId);
        this.ares = parseAresSuperWeaponDefinition(ini);
        this.uiName = ini.getString("UIName");
        this.weaponType = ini.getString("WeaponType") || undefined;
        return this;
    }
}
