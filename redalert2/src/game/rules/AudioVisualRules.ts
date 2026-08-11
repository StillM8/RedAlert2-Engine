export class AudioVisualRules {
    private ini: any;
    private ambientChangeRate: number = 0;
    private ambientChangeStep: number = 0;
    private behind: string = '';
    private bridgeExplosions: string[] = [];
    private chronoBeamColor: number[] = [];
    private chronoBlast: string = '';
    private chronoBlastDest: string = '';
    private chronoPlacement: string = '';
    private chronoSparkle1: string = '';
    private conditionRed: number = 0;
    private conditionYellow: number = 0;
    private creditTicks: string[] = [];
    private extraAircraftLight: number = 0;
    private extraInfantryLight: number = 0;
    private extraUnitLight: number = 0;
    private fireNames: string[] = [];
    private flyerHelper: string = '';
    private gravity: number = 0;
    private idleActionFrequency: number = 0;
    private impactLandSound?: string;
    private impactWaterSound?: string;
    private infantryExplode: string = '';
    private flamingInfantry: string = '';
    private infantryHeadPop: string = '';
    private infantryNuked: string = '';
    private infantryVirus: string = '';
    private infantryMutate: string = '';
    private infantryBrute: string = '';
    private ironCurtainInvokeAnim: string = '';
    private messageDuration: number = 10;
    private metallicDebris: string[] = [];
    private nukeTakeOff: string = '';
    private deadBodies: string[] = [];
    private wake: string = '';
    private parachute: string = '';
    private moveFlash: string = '';
    private warpOut: string = '';
    private warpAway: string = '';
    private weaponNullifyAnim: string = '';
    private weatherConClouds: string[] = [];
    private weatherConBoltExplosion: string = '';
    private weatherConBolts: string[] = [];
    /** Ares Firestorm presentation defaults from Antares 3.0p1. */
    public firestormActiveAnim: string = 'GAFSDF_A';
    public firestormIdleAnim: string = 'FSIDLE';
    public firestormGroundAnim: string = 'FSGRND';
    public firestormAirAnim: string = 'FSAIR';
    /** Ares global fallback for TechnoType Bounty.Display. */
    public bountyDisplay = false;
    readIni(ini: any, generalIni?: any): AudioVisualRules {
        this.ini = ini;
        // YR's rulesmd.ini omits many [AudioVisual] keys that RA2's rules.ini
        // defines — the original YR binary hardcodes their defaults. Every
        // fallback below is the exact value from retail RA2 rules.ini; without
        // them, code paths like the move-order flash crash on an empty name.
        const str = (key: string, fallback = ''): string => ini.getString(key) || generalIni?.getString(key) || fallback;
        const arr = (key: string, fallback: string[] = []): string[] => {
            const value = ini.getArray(key);
            return value && value.length ? value : fallback;
        };
        this.ambientChangeRate = ini.getNumber("AmbientChangeRate");
        this.ambientChangeStep = ini.getNumber("AmbientChangeStep");
        this.behind = str("Behind", "BEHIND");
        this.bridgeExplosions = arr("BridgeExplosions", ["TWLT026", "TWLT036", "TWLT050", "TWLT070"]);
        this.chronoBeamColor = ini.getNumberArray("ChronoBeamColor");
        this.chronoBlast = str("ChronoBlast", "CHRONOFD");
        this.chronoBlastDest = str("ChronoBlastDest", "CHRONOTG");
        this.chronoPlacement = str("ChronoPlacement", "CHRONOAR");
        this.chronoSparkle1 = str("ChronoSparkle1", "CHRONOSK");
        this.conditionRed = ini.getNumber("ConditionRed");
        this.conditionYellow = ini.getNumber("ConditionYellow");
        this.creditTicks = ini.getArray("CreditTicks");
        this.extraAircraftLight = ini.getNumber("ExtraAircraftLight");
        this.extraInfantryLight = ini.getNumber("ExtraInfantryLight");
        this.extraUnitLight = ini.getNumber("ExtraUnitLight");
        const damageFireTypes = str("DamageFireTypes", "FIRE01,FIRE02,FIRE03");
        this.fireNames = damageFireTypes.split(/\.|,/).filter((e) => e !== "");
        this.flyerHelper = ini.getString("FlyerHelper");
        this.gravity = ini.getNumber("Gravity");
        this.idleActionFrequency = 60 * ini.getNumber("IdleActionFrequency");
        this.impactLandSound = ini.getString("ImpactLandSound") || undefined;
        this.impactWaterSound = ini.getString("ImpactWaterSound") || undefined;
        this.infantryExplode = str("InfantryExplode", "S_BANG34");
        this.flamingInfantry = str("FlamingInfantry", "FLAMEGUY");
        this.infantryHeadPop = str("InfantryHeadPop", "YURIDIE");
        this.infantryNuked = str("InfantryNuked", "NUKEDIE");
        this.infantryVirus = str("InfantryVirus", "VIRUSD");
        this.infantryMutate = str("InfantryMutate", "GENDEATH");
        this.infantryBrute = str("InfantryBrute", "BRUTDIE");
        this.ironCurtainInvokeAnim = str("IronCurtainInvokeAnim", "IRONBLST");
        this.messageDuration = ini.getNumber("MessageDuration", 10);
        this.metallicDebris = arr("MetallicDebris", ["DBRIS1LG", "DBRIS2LG", "DBRIS3LG", "DBRIS4LG", "DBRIS5LG", "DBRIS6LG", "DBRIS7LG", "DBRIS8LG", "DBRIS9LG", "DBRS10LG", "DBRIS1SM", "DBRIS2SM", "DBRIS3SM", "DBRIS4SM", "DBRIS5SM", "DBRIS6SM", "DBRIS7SM", "DBRIS8SM", "DBRIS9SM", "DBRS10SM"]);
        this.nukeTakeOff = str("NukeTakeOff", "NUKETO");
        this.deadBodies = arr("DeadBodies", ["DEATH_A", "DEATH_B", "DEATH_C", "DEATH_D", "DEATH_E", "DEATH_F"]);
        this.wake = str("Wake", "WAKE1");
        this.parachute = str("Parachute", "PARACH");
        this.moveFlash = str("MoveFlash", "RING");
        this.warpOut = str("WarpOut", "WARPOUT");
        this.warpAway = str("WarpAway", "WARPAWAY");
        this.weaponNullifyAnim = str("WeaponNullifyAnim", "IRONFX");
        this.weatherConClouds = arr("WeatherConClouds", ["WCCLOUD1", "WCCLOUD2", "WCCLOUD3"]);
        this.weatherConBoltExplosion = str("WeatherConBoltExplosion", "EXPLOLB");
        this.weatherConBolts = arr("WeatherConBolts", ["WCLBOLT1", "WCLBOLT2", "WCLBOLT3"]);
        this.bountyDisplay = ini.getBool("BountyDisplay");
        this.firestormActiveAnim = str("FirestormActiveAnim", "GAFSDF_A");
        this.firestormIdleAnim = str("FirestormIdleAnim", "FSIDLE");
        this.firestormGroundAnim = str("FirestormGroundAnim", "FSGRND");
        this.firestormAirAnim = str("FirestormAirAnim", "FSAIR");
        return this;
    }
}
