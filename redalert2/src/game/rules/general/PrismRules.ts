export class PrismRules {
    public type: string = '';
    public supportHeight: number = 0;
    public supportMax: number = 0;
    public supportModifier: number = 1;
    public supportDelay: number = 0;
    public supportDuration: number = 0;
    readIni(ini: any): PrismRules {
        this.type = ini.getString("PrismType");
        this.supportHeight = ini.getNumber("PrismSupportHeight");
        this.supportMax = ini.getNumber("PrismSupportMax");
        this.supportModifier = ini.getNumber("PrismSupportModifier", 1);
        this.supportDelay = ini.getNumber("PrismSupportDelay");
        this.supportDuration = ini.getNumber("PrismSupportDuration");
        return this;
    }
}
