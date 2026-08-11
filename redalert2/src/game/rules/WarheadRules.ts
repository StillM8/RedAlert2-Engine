import { InfDeathType } from '../gameobject/infantry/InfDeathType';
import { ArmorRegistry, parseAresWarheadVerses, type ArmorVersusBehavior } from '@/extensions/ares/AresArmor';
import { parseAresAttachEffectDefinition, type AresAttachEffectDefinition } from '@/extensions/ares/AresAttachEffect';
export class WarheadRules {
    private rules: any;
    private verses: Map<number, number>;
    public armorVersusBehavior: Map<number, ArmorVersusBehavior>;
    /** Optional Ares AttachEffect delivered by this Warhead on hit. */
    public aresAttachEffect?: AresAttachEffectDefinition;
    public affectsAllies!: boolean;
    public affectsEnemies!: boolean;
    /** Ares warhead effect gates. */
    public effectsRequireDamage!: boolean;
    public effectsRequireVerses!: boolean;
    public airstrike!: boolean;
    public psychedelic!: boolean;
    public animList!: string[];
    public bombDisarm!: boolean;
    public bullets!: boolean;
    public causesDelayKill!: boolean;
    public cellSpread!: number;
    public conventional!: boolean;
    public culling!: boolean;
    public delayKillAtMax!: number;
    public delayKillFrames!: number;
    public electricAssault!: boolean;
    public emEffect!: boolean;
    /** Ares EMP frame counter contribution. */
    public empDuration!: number;
    /** Ares EMP counter cap; -1 is the legacy set-unless-longer mode. */
    public empCap!: number;
    public isLocomotor!: boolean;
    public infDeath!: InfDeathType;
    public ivanBomb!: boolean;
    public makesDisguise!: boolean;
    public mindControl!: boolean;
    public nukeMaker!: boolean;
    public paralyzes!: number;
    public parasite!: boolean;
    public percentAtMax!: number;
    public proneDamage!: number;
    public psychicDamage!: boolean;
    public radiation!: boolean;
    public rocker!: boolean;
    public sonic!: boolean;
    public temporal!: boolean;
    /** Ares KillDriver: replace vehicle damage with driver removal/neutralization. */
    public killDriver!: boolean;
    /** Antares extension; fraction of maximum health at which the driver may die. */
    public killDriverBelowPercent!: number;
    /** Antares extension; chance in the normalized 0..1 range. */
    public killDriverChance!: number;
    /** Antares extension; OwnerHouseKind selector. */
    public killDriverOwner!: string;
    /** Antares extension; parsed for diagnostics until veterancy reset is integrated. */
    public killDriverRemoveVeterancy!: boolean;
    public wallAbsoluteDestroyer!: boolean;
    public wall!: boolean;
    public wood!: boolean;
    constructor(rules: any, armorRegistry: ArmorRegistry = new ArmorRegistry()) {
        this.rules = rules;
        this.verses = new Map();
        this.armorVersusBehavior = new Map();
        this.parse();
        const parsed = parseAresWarheadVerses(rules, armorRegistry);
        this.verses = parsed.verses;
        this.armorVersusBehavior = parsed.behavior;
        const hasAresAttachEffectFields = [...rules.entries.keys()].some((key: string) =>
            key.trim().toLocaleLowerCase("en-US").startsWith("attacheffect."));
        this.aresAttachEffect = hasAresAttachEffectFields
            ? parseAresAttachEffectDefinition(rules)
            : undefined;
    }
    get name(): string {
        return this.rules.name;
    }
    private parse(): void {
        this.affectsAllies = this.rules.getBool("AffectsAllies", true);
        this.affectsEnemies = this.rules.getBool("AffectsEnemies", true);
        this.effectsRequireDamage = this.rules.getBool("EffectsRequireDamage", false);
        this.effectsRequireVerses = this.rules.getBool("EffectsRequireVerses", true);
        this.airstrike = this.rules.getBool("Airstrike");
        this.psychedelic = this.rules.getBool("Psychedelic");
        this.animList = this.rules.getArray("AnimList");
        this.bombDisarm = this.rules.getBool("BombDisarm");
        this.bullets = this.rules.getBool("Bullets");
        this.causesDelayKill = this.rules.getBool("CausesDelayKill");
        this.cellSpread = this.rules.getNumber("CellSpread");
        this.conventional = this.rules.getBool("Conventional");
        this.culling = this.rules.getBool("Culling");
        this.delayKillAtMax = this.rules.getNumber("DelayKillAtMax");
        this.delayKillFrames = this.rules.getNumber("DelayKillFrames");
        this.electricAssault = this.rules.getBool("ElectricAssault");
        this.emEffect = this.rules.getBool("EMEffect");
        this.empDuration = Math.trunc(this.rules.getNumber("EMP.Duration"));
        this.empCap = Math.trunc(this.rules.getNumber("EMP.Cap", -1));
        this.isLocomotor = this.rules.getBool("IsLocomotor");
        this.infDeath = this.rules.getEnumNumeric("InfDeath", InfDeathType, InfDeathType.None);
        this.ivanBomb = this.rules.getBool("IvanBomb");
        this.makesDisguise = this.rules.getBool("MakesDisguise");
        this.mindControl = this.rules.getBool("MindControl");
        this.nukeMaker = this.rules.getBool("NukeMaker");
        this.paralyzes = this.rules.getNumber("Paralyzes");
        this.parasite = this.rules.getBool("Parasite");
        this.percentAtMax = this.rules.getNumber("PercentAtMax", 1);
        this.proneDamage = this.rules.getFixed("ProneDamage", 1);
        this.psychicDamage = this.rules.getBool("PsychicDamage");
        this.radiation = this.rules.getBool("Radiation");
        this.rocker = this.rules.getBool("Rocker");
        this.sonic = this.rules.getBool("Sonic");
        this.temporal = this.rules.getBool("Temporal");
        this.killDriver = this.rules.getBool("KillDriver");
        this.killDriverBelowPercent = this.rules.getNumber("KillDriver.KillBelowPercent", 1);
        this.killDriverChance = this.rules.getNumber("KillDriver.Chance", 1);
        this.killDriverOwner = this.rules.getString("KillDriver.Owner", "special");
        this.killDriverRemoveVeterancy = this.rules.getBool("KillDriver.RemoveVeterancy");
        this.wallAbsoluteDestroyer = this.rules.getBool("WallAbsoluteDestroyer");
        this.wall = this.rules.getBool("Wall");
        this.wood = this.rules.getBool("Wood");
    }
}
