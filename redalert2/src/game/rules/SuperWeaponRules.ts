import { SuperWeaponType } from '../type/SuperWeaponType';
import { parseAresSuperWeaponDefinition, parseSuperWeaponType, type AresSuperWeaponDefinition } from '@/extensions/ares/AresSuperWeapons';
import { ARES_DEFAULT_CAMEO_PALETTE, normalizeAresCameoPalette } from '@/extensions/ares/AresPcxCameos';
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
    public sidebarPalette: string = ARES_DEFAULT_CAMEO_PALETTE;
    public type?: SuperWeaponType;
    /** Raw Type= value; custom Ares handlers must not be coerced to vanilla. */
    public typeId?: string;
    public ares?: AresSuperWeaponDefinition;
    public uiName: string;
    public weaponType?: string;
    public nukePayload?: string;
    public nukePayloadConfigured: boolean = false;
    public nukeSiloLaunch?: boolean;
    constructor(index: number) {
        this.index = index;
    }
    readIni(ini: any, general?: any, combatDamage?: any): this {
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
        this.sidebarPalette = normalizeAresCameoPalette(ini.getString("SidebarPalette"));
        this.typeId = ini.getString("Type") || undefined;
        this.type = parseSuperWeaponType(this.typeId);
        this.ares = parseAresSuperWeaponDefinition(ini);
        const type = this.typeId?.toLocaleLowerCase("en-US");
        if (this.ares && type === "psychicdominator") {
            if (!this.ares.swRange?.length) this.ares.swRange = [general?.dominatorCaptureRange ?? 1];
            this.ares.swDamage ??= general?.dominatorDamage ?? 1000;
            this.ares.swWarhead ??= general?.dominatorWarhead || "DominatorWH";
            this.ares.dominatorFirstAnim ??= general?.dominatorFirstAnim || "PDFXCLD";
            this.ares.dominatorSecondAnim ??= general?.dominatorSecondAnim || "PDFXLOC";
            this.ares.dominatorFireAtPercentage ??= general?.dominatorFireAtPercentage ?? 20;
            this.ares.dominatorControlAnim ??= combatDamage?.permaControlledAnimationType || undefined;
        }
        if (this.ares && type === "forceshield") {
            if (!this.ares.swRange?.length) this.ares.swRange = [general?.forceShieldRadius ?? 4];
            this.ares.swAnimation ??= general?.forceShieldInvokeAnim || "FORCSHLD";
            this.ares.protectDuration ??= general?.forceShieldDuration ?? 500;
            this.ares.protectPowerOutage ??= general?.forceShieldBlackoutDuration ?? 1000;
            this.ares.protectPlayFadeSoundTime ??= general?.forceShieldPlayFadeSoundTime ?? 0;
        }
        this.uiName = ini.getString("UIName");
        this.weaponType = ini.getString("WeaponType") || undefined;
        if (this.type === SuperWeaponType.MultiMissile) {
            this.nukePayloadConfigured = this.ares?.nukePayload !== undefined;
            this.nukePayload = this.ares?.nukePayload ?? "NukePayload";
            this.nukeSiloLaunch = this.ares?.nukeSiloLaunch ?? true;
            if (this.ares) {
                this.ares.nukePayload = this.nukePayload;
                this.ares.nukeSiloLaunch = this.nukeSiloLaunch;
            }
        }
        return this;
    }
}
