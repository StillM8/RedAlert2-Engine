export class CrewRules {
    public alliedCrew: string = '';
    public alliedSurvivorDivisor: number = 0;
    /** Percentage fallback used by Ares Survivor.*PilotChance=-1. */
    public crewEscape: number = 0;
    public sovietCrew: string = '';
    public sovietSurvivorDivisor: number = 0;
    public survivorRate: number = 0;
    readIni(ini: any): CrewRules {
        this.alliedCrew = ini.getString("AlliedCrew");
        this.alliedSurvivorDivisor = ini.getNumber("AlliedSurvivorDivisor");
        this.crewEscape = ini.getNumber("CrewEscape");
        this.sovietCrew = ini.getString("SovietCrew");
        this.sovietSurvivorDivisor = ini.getNumber("SovietSurvivorDivisor");
        this.survivorRate = ini.getNumber("SurvivorRate");
        return this;
    }
}
